import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { sealFingerprint, verifySeal } from '../src/pdf/verify.js';
import { createWebhook, signPayload } from '../src/services/webhooks.js';
import { PNG, client, codeFrom, linkFrom, outbox, samplePdf, startTestApp } from './helpers.js';

let t;
let owner;
let apiKey;
let receiver;
const received = [];

before(async () => {
  t = await startTestApp();
  owner = client(t.base);
  await owner('/api/auth/registro', { method: 'POST', body: { name: 'Dev API', email: 'dev@example.com', password: 'clave-dev-segura' } });
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
});
after(async () => {
  await new Promise((r) => receiver.close(r));
  await t.stop();
});

const v1 = (path, { method = 'GET', body, key = apiKey, headers = {} } = {}) => fetch(`${t.base}/api/v1${path}`, {
  method,
  headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
});

async function waitFor(fn, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

test('claves de API: crear desde el panel, autenticar y rechazar sin clave', async () => {
  const res = await owner('/api/claves', { method: 'POST', body: { name: 'Integración de prueba' } });
  assert.equal(res.status, 201);
  apiKey = (await res.json()).key;
  assert.match(apiKey, /^ds_live_/);
  assert.equal((await v1('/me', { key: null })).status, 401);
  assert.equal((await v1('/me', { key: 'ds_live_inventada' })).status, 401);
  const me = await (await v1('/me')).json();
  assert.equal(me.email, 'dev@example.com');
  const index = await (await fetch(`${t.base}/api/v1`)).json();
  assert.match(index.llms_txt, /llms\.txt$/);
});

test('webhook con secreto y protección contra URLs privadas', async () => {
  const strict = { ...t.ctx, config: { ...t.config, allowPrivateWebhooks: false } };
  await assert.rejects(createWebhook(strict, 'x', { url: 'http://example.com/hook' }), /https/);
  await assert.rejects(createWebhook(strict, 'x', { url: 'https://127.0.0.1/hook' }), /red privada/);
  await assert.rejects(createWebhook(strict, 'x', { url: 'https://localhost/hook' }), /red privada/);
  const res = await v1('/webhooks', { method: 'POST', body: { url: `http://127.0.0.1:${receiver.address().port}/hook` } });
  assert.equal(res.status, 201);
  const hook = await res.json();
  assert.match(hook.secret, /^whsec_/);
  t.hookSecret = hook.secret;
  const bad = await v1('/webhooks', { method: 'POST', body: { url: 'https://ejemplo.com', events: ['no.existe'] } });
  assert.equal(bad.status, 400);
});

test('crear y enviar un sobre en una llamada, idempotente y con campos automáticos', async () => {
  const body = {
    title: 'Contrato por API',
    document_base64: (await samplePdf()).toString('base64'),
    recipients: [{ name: 'Fede Firmante', email: 'fede@example.com' }, { name: 'Copia', email: 'copia-api@example.com', role: 'cc' }],
  };
  const first = await v1('/envelopes', { method: 'POST', body, headers: { 'idempotency-key': 'api-1' } });
  assert.equal(first.status, 201, await first.clone().text());
  const env = await first.json();
  assert.equal(env.status, 'sent');
  assert.equal(env.recipients.length, 2);
  const again = await v1('/envelopes', { method: 'POST', body, headers: { 'idempotency-key': 'api-1' } });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).id, env.id, 'misma clave, mismo sobre');
  assert.equal((await outbox(t.pool, 'invite', 'fede@example.com')).length, 1, 'una sola invitación');
  const { rows } = await t.pool.query('SELECT type, page FROM fields WHERE envelope_id = $1 ORDER BY type', [env.id]);
  assert.deepEqual(rows.map((r) => [r.type, r.page]), [['date', 2], ['signature', 2]], 'firma y fecha al pie de la última página');
  t.envId = env.id;

  const invalid = await v1('/envelopes', { method: 'POST', body: { ...body, document_base64: 'no es un pdf!!' } });
  assert.equal(invalid.status, 400);
  const before = (await t.pool.query('SELECT count(*)::int AS n FROM envelopes')).rows[0].n;
  const noSig = await v1('/envelopes', { method: 'POST', body: { ...body, fields: [{ recipient: 0, type: 'text', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.03 }] } });
  assert.equal(noSig.status, 400);
  assert.equal((await t.pool.query('SELECT count(*)::int AS n FROM envelopes')).rows[0].n, before, 'un error no deja borradores huérfanos');
});

test('webhooks firmados al firmar y al completar; descarga del PDF sellado por API', async () => {
  const signer = client(t.base);
  const token = linkFrom((await outbox(t.pool, 'invite', 'fede@example.com'))[0]);
  assert.equal((await signer(`/api/firmar/${token}`)).status, 200);
  await signer(`/api/firmar/${token}/codigo`, { method: 'POST' });
  const code = codeFrom((await outbox(t.pool, 'otp', 'fede@example.com'))[0]);
  const { session } = await (await signer(`/api/firmar/${token}/verificar`, { method: 'POST', body: { code } })).json();
  const signed = await signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, consent: true } });
  assert.equal(signed.status, 200);

  const completed = await waitFor(() => received.find((r) => r.headers['docsure-event'] === 'envelope.completed'));
  assert.ok(completed, 'llegó envelope.completed');
  const [, ts, sig] = completed.headers['docsure-signature'].match(/^t=(\d+),v1=([a-f0-9]{64})$/);
  assert.equal(sig, signPayload(t.hookSecret, ts, completed.body), 'firma HMAC válida');
  const event = JSON.parse(completed.body);
  assert.equal(event.data.envelope.id, t.envId);
  assert.equal(event.data.envelope.status, 'completed');
  for (const type of ['envelope.sent', 'recipient.viewed', 'recipient.signed']) {
    assert.ok(received.some((r) => r.headers['docsure-event'] === type), `llegó ${type}`);
  }

  const detail = await (await v1(`/envelopes/${t.envId}`)).json();
  assert.equal(detail.status, 'completed');
  assert.ok(detail.links.final_pdf);
  const pdf = Buffer.from(await (await v1(`/envelopes/${t.envId}/document?version=final`)).arrayBuffer());
  assert.equal(verifySeal(pdf, sealFingerprint(t.config.sealP12, t.config.sealPassword)).intact, true);
  const list = await (await v1('/envelopes?status=completed')).json();
  assert.ok(list.data.some((e) => e.id === t.envId));
});

test('conexión de agente: autorizar con un clic y recibir la clave una sola vez', async () => {
  const start = await (await v1('/agent/connect', { method: 'POST', key: null, body: { client_name: 'Claude Code' } })).json();
  assert.match(start.user_code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.match(start.verification_url, /\/app\/conectar\?codigo=/);
  const pending = await v1('/agent/token', { method: 'POST', key: null, body: { device_code: start.device_code } });
  assert.equal(pending.status, 428);
  assert.equal((await pending.json()).code, 'authorization_pending');

  const info = await (await owner(`/api/agente?codigo=${start.user_code}`)).json();
  assert.equal(info.clientName, 'Claude Code');
  assert.equal((await owner('/api/agente', { method: 'POST', body: { codigo: start.user_code, aprobar: true } })).status, 200);
  assert.equal((await owner('/api/agente', { method: 'POST', body: { codigo: start.user_code, aprobar: true } })).status, 409, 'el código no se reutiliza');

  const ok = await v1('/agent/token', { method: 'POST', key: null, body: { device_code: start.device_code } });
  assert.equal(ok.status, 200);
  const { api_key: agentKey } = await ok.json();
  const twice = await v1('/agent/token', { method: 'POST', key: null, body: { device_code: start.device_code } });
  assert.equal(twice.status, 400, 'la clave se entrega una sola vez');
  assert.equal((await (await v1('/me', { key: agentKey })).json()).email, 'dev@example.com');

  const denied = await (await v1('/agent/connect', { method: 'POST', key: null, body: {} })).json();
  await owner('/api/agente', { method: 'POST', body: { codigo: denied.user_code, aprobar: false } });
  assert.equal((await v1('/agent/token', { method: 'POST', key: null, body: { device_code: denied.device_code } })).status, 403);

  const keys = await (await owner('/api/claves')).json();
  const agent = keys.data.find((k) => k.created_via === 'agente');
  assert.equal((await owner(`/api/claves/${agent.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await v1('/me', { key: agentKey })).status, 401, 'una clave revocada deja de funcionar');
});

test('documentación para personas y para IAs', async () => {
  const docs = await fetch(`${t.base}/desarrolladores`);
  assert.equal(docs.status, 200);
  assert.match(await docs.text(), /agent\/connect/);
  const llms = await (await fetch(`${t.base}/llms.txt`)).text();
  for (const s of ['/agent/connect', '/agent/token', 'DOCSURE_API_KEY', 'POST', 'DocSure-Signature', 'Idempotency-Key']) assert.ok(llms.includes(s), s);
  const spec = await (await fetch(`${t.base}/openapi.json`)).json();
  assert.equal(spec.openapi, '3.1.0');
  assert.ok(spec.paths['/envelopes'].post);
});
