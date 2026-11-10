import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { runRenewalNotices } from '../src/services/contracts.js';
import { INDUSTRIES } from '../src/web/industries.js';
import { HELP_PATHS } from '../src/web/resources.js';
import { PNG, client, codeFrom, linkFrom, outbox, samplePdf, startTestApp } from './helpers.js';

let t;
let owner;
before(async () => {
  t = await startTestApp();
  owner = client(t.base);
  await owner('/api/auth/registro', { method: 'POST', body: { name: 'Siete', email: 'siete@example.com', password: 'clave-v07-larga', plan: 'empresa' } });
});

const F = (o) => ({ recipientKey: 's', page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.06, ...o });
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Crea, envía y firma un sobre de un firmante; devuelve su id cuando quedó completado. */
async function completed(email, title = 'Contrato v07') {
  const { id } = await (await owner(`/api/sobres?title=${encodeURIComponent(title)}`, { method: 'POST', body: await samplePdf() })).json();
  await owner(`/api/sobres/${id}`, { method: 'PUT', body: { title, recipients: [{ key: 's', name: 'Firma Siete', email }], fields: [F({ type: 'signature' })] } });
  assert.equal((await owner(`/api/sobres/${id}/enviar`, { method: 'POST', headers: { 'idempotency-key': `c-${id}` } })).status, 200);
  const signer = client(t.base);
  const token = linkFrom((await outbox(t.pool, 'invite', email)).at(-1));
  await signer(`/api/firmar/${token}/codigo`, { method: 'POST' });
  const code = codeFrom((await outbox(t.pool, 'otp', email)).at(-1));
  const { session } = await (await signer(`/api/firmar/${token}/verificar`, { method: 'POST', body: { code } })).json();
  assert.equal((await signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, consent: true, values: {} } })).status, 200);
  for (let i = 0; i < 50; i += 1) {
    const { envelope } = await (await owner(`/api/sobres/${id}`)).json();
    if (envelope.status === 'completed') return id;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('el sobre no se completó');
}
after(async () => t.stop());

test('generador de firma, centro de ayuda y soluciones nuevas: publicados, enlazados y en el sitemap', async () => {
  const gen = await fetch(`${t.base}/generador-de-firma`);
  assert.equal(gen.status, 200);
  const html = await gen.text();
  assert.match(html, /signature-generator\.js/);
  assert.match(html, /"@type":"WebApplication"/);

  for (const p of HELP_PATHS) assert.equal((await fetch(`${t.base}${p}`)).status, 200, p);
  assert.equal((await fetch(`${t.base}/ayuda/no-existe`)).status, 404);

  for (const slug of ['seguros', 'ciencias-de-la-vida', 'experiencia-del-cliente', 'pymes', 'grandes-empresas']) {
    assert.ok(INDUSTRIES[slug], slug);
    assert.equal((await fetch(`${t.base}/soluciones/${slug}`)).status, 200, slug);
  }
  const solutions = await (await fetch(`${t.base}/soluciones`)).text();
  for (const slug of Object.keys(INDUSTRIES)) assert.match(solutions, new RegExp(`/soluciones/${slug}"`));

  const home = await (await fetch(`${t.base}/`)).text();
  for (const href of ['/ayuda', '/generador-de-firma', '/soluciones/seguros', '/soluciones/pymes']) assert.ok(home.includes(`href="${href}"`), href);

  const sitemap = await (await fetch(`${t.base}/sitemap.xml`)).text();
  for (const p of ['/generador-de-firma', '/ayuda', '/ayuda/como-firmar', '/soluciones/grandes-empresas']) assert.ok(sitemap.includes(`${p}</loc>`), p);
});

test('contratos: vencimiento validado, aviso de renovación una sola vez y listado de próximos vencimientos', async () => {
  const id = await completed('contrato@example.com');
  const put = (body) => owner(`/api/sobres/${id}/contrato`, { method: 'PUT', body });
  assert.equal((await put({ contract_end: '2026-02-30' })).status, 400, 'fecha imposible');
  assert.equal((await put({ contract_end: 'mañana' })).status, 400, 'formato');
  assert.equal((await put({ contract_end: day(10), renewal_notice_days: 45 })).status, 400, 'anticipación no permitida');
  const saved = await (await put({ contract_end: day(10), renewal_notice_days: 30 })).json();
  assert.equal(saved.contract_end, day(10));
  assert.equal(saved.renewal_notified_at, null);

  const list = (await (await owner('/api/vencimientos')).json()).data;
  const row = list.find((c) => c.id === id);
  assert.ok(row, 'aparece en próximos vencimientos');
  assert.equal(row.days_left, 10);

  assert.ok((await runRenewalNotices(t.ctx)) >= 1);
  const mails = await outbox(t.pool, 'renewal', 'siete@example.com');
  assert.equal(mails.length, 1);
  assert.match(mails[0], /Nueva versión/);
  await runRenewalNotices(t.ctx);
  assert.equal((await outbox(t.pool, 'renewal', 'siete@example.com')).length, 1, 'un solo aviso por fecha');
  const detail = await (await owner(`/api/sobres/${id}/contrato`)).json();
  assert.ok(detail.renewal_notified_at);

  // Cambiar la fecha vuelve a habilitar el aviso; una fecha lejana no avisa todavía.
  const later = await (await put({ contract_end: day(200), renewal_notice_days: 30 })).json();
  assert.equal(later.renewal_notified_at, null);
  await runRenewalNotices(t.ctx);
  assert.equal((await outbox(t.pool, 'renewal', 'siete@example.com')).length, 1);

  // Otra cuenta no ve ni modifica el contrato.
  const other = client(t.base);
  await other('/api/auth/registro', { method: 'POST', body: { name: 'Otra', email: 'otra7@example.com', password: 'clave-otra-larga' } });
  assert.equal((await other(`/api/sobres/${id}/contrato`)).status, 404);
  assert.equal((await other(`/api/sobres/${id}/contrato`, { method: 'PUT', body: { contract_end: null } })).status, 404);
});

test('contratos: versiones enlazadas y el contrato anterior sale de la lista cuando la nueva versión se envía', async () => {
  const v1 = await completed('version@example.com', 'Alquiler local');
  await owner(`/api/sobres/${v1}/contrato`, { method: 'PUT', body: { contract_end: day(20), renewal_notice_days: 30 } });
  const res = await owner(`/api/sobres/${v1}/nueva-version`, { method: 'POST' });
  assert.equal(res.status, 201);
  const v2 = await res.json();
  assert.equal(v2.version, 2);
  const { envelope, recipients, fields } = await (await owner(`/api/sobres/${v2.id}`)).json();
  assert.equal(envelope.status, 'draft');
  assert.equal(envelope.contract_end, day(20));
  assert.equal(recipients.length, 1);
  assert.equal(fields.length, 1);
  const { versions } = await (await owner(`/api/sobres/${v2.id}/contrato`)).json();
  assert.deepEqual(versions.map((v) => v.version), [1, 2]);
  assert.equal((await owner(`/api/sobres/${v2.id}/nueva-version`, { method: 'POST' })).status, 409, 'un borrador no versiona');

  const ids = async () => (await (await owner('/api/vencimientos')).json()).data.map((c) => c.id);
  assert.ok((await ids()).includes(v1), 'el borrador no reemplaza al vigente');
  assert.equal((await owner(`/api/sobres/${v2.id}/enviar`, { method: 'POST', headers: { 'idempotency-key': `v-${v2.id}` } })).status, 200);
  assert.ok(!(await ids()).includes(v1), 'enviada la nueva versión, el anterior sale de la lista');
  assert.ok((await ids()).includes(v2.id));

  const spec = await (await fetch(`${t.base}/openapi.json`)).json();
  for (const p of ['/envelopes/{id}/contract', '/envelopes/{id}/versions', '/contracts/expiring']) assert.ok(spec.paths[p], p);
});
