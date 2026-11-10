import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { monthlyUsage, runScheduler } from '../src/services/envelopes.js';
import { PNG, client, codeFrom, linkFrom, outbox, samplePdf, startTestApp } from './helpers.js';

let t;
let owner;
let ownerId;
before(async () => {
  t = await startTestApp();
  owner = client(t.base);
  await owner('/api/auth/registro', { method: 'POST', body: { name: 'Fer Funciones', email: 'fer@example.com', password: 'clave-funciones-1' } });
  ownerId = (await (await owner('/api/me')).json()).user.id;
});
after(async () => t.stop());

const accessFrom = (text) => text.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})\b/)[1];

async function newEnvelope(email, opts = {}) {
  const created = await (await owner(`/api/sobres?title=${encodeURIComponent(opts.title || 'Prueba')}`, { method: 'POST', body: await samplePdf() })).json();
  const res = await owner(`/api/sobres/${created.id}`, {
    method: 'PUT',
    body: {
      title: opts.title || 'Prueba', language: opts.language, expire_days: opts.expire_days, reminder_days: opts.reminder_days,
      recipients: [{ key: 's', name: 'Sergio Firmante', email }],
      fields: [{ recipientKey: 's', type: 'signature', page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.06 }, { recipientKey: 's', type: 'date', page: 1, x: 0.5, y: 0.1, w: 0.2, h: 0.03 }],
    },
  });
  assert.equal(res.status, 200, await res.clone().text());
  if (opts.send !== false) assert.equal((await owner(`/api/sobres/${created.id}/enviar`, { method: 'POST', headers: { 'idempotency-key': `k-${created.id}` } })).status, 200);
  return created.id;
}

async function signWith(signer, token, email) {
  assert.equal((await signer(`/api/firmar/${token}/codigo`, { method: 'POST' })).status, 200);
  const code = codeFrom((await outbox(t.pool, 'otp', email)).at(-1));
  const { session } = await (await signer(`/api/firmar/${token}/verificar`, { method: 'POST', body: { code } })).json();
  return signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, consent: true } });
}

test('código de acceso anti-phishing: firmar sin tocar el enlace', async () => {
  await newEnvelope('acceso@example.com');
  const invite = (await outbox(t.pool, 'invite', 'acceso@example.com'))[0];
  const code = accessFrom(invite);
  const signer = client(t.base);
  assert.equal((await signer(`/api/firmar/${code}`)).status, 200, 'con guiones');
  assert.equal((await signer(`/api/firmar/${code.replace(/-/g, '').toLowerCase()}`)).status, 200, 'sin guiones y en minúsculas');
  assert.equal((await signer('/api/firmar/BBBB-CCCC-DDDD')).status, 404, 'código inventado');
  assert.equal((await signWith(signer, code.replace(/-/g, ''), 'acceso@example.com')).status, 200);
  assert.equal((await signer(`/api/firmar/${code}`)).status, 410, 'el código también es de un solo uso');
  assert.equal((await client(t.base)('/acceder')).status, 200);
});

test('idioma del sobre: emails y pantalla en inglés', async () => {
  await newEnvelope('english@example.com', { language: 'en' });
  const { rows: [mail] } = await t.pool.query(`SELECT subject FROM emails WHERE to_email = 'english@example.com' AND kind = 'invite'`);
  assert.match(mail.subject, /asked you to sign/);
  const token = linkFrom((await outbox(t.pool, 'invite', 'english@example.com'))[0]);
  const info = await (await client(t.base)(`/api/firmar/${token}`)).json();
  assert.equal(info.language, 'en');
  const bad = await owner('/api/sobres', { method: 'POST', body: await samplePdf() });
  const draft = (await bad.json()).id;
  const res = await owner(`/api/sobres/${draft}`, { method: 'PUT', body: { title: 'x', reminder_days: 4, recipients: [], fields: [] } });
  assert.equal(res.status, 400, 'frecuencia de recordatorio inválida');
});

test('recordatorios automáticos: uno por período, con enlace nuevo', async () => {
  const id = await newEnvelope('recordar@example.com', { reminder_days: 1 });
  const first = linkFrom((await outbox(t.pool, 'invite', 'recordar@example.com'))[0]);
  assert.equal((await runScheduler(t.ctx)).reminders, 0, 'todavía no corresponde');
  await t.pool.query(`UPDATE recipients SET last_notified_at = now() - interval '2 days' WHERE envelope_id = $1`, [id]);
  assert.equal((await runScheduler(t.ctx)).reminders, 1);
  assert.equal((await runScheduler(t.ctx)).reminders, 0, 'no se duplica');
  const reminders = await outbox(t.pool, 'reminder', 'recordar@example.com');
  assert.equal(reminders.length, 1);
  assert.equal((await client(t.base)(`/api/firmar/${first}`)).status, 404, 'el enlace anterior deja de funcionar');
  assert.equal((await client(t.base)(`/api/firmar/${linkFrom(reminders[0])}`)).status, 200);
});

test('vencimiento automático y extensión', async () => {
  const id = await newEnvelope('vence@example.com', { expire_days: 7 });
  const detail = await (await owner(`/api/sobres/${id}`)).json();
  const days = (new Date(detail.envelope.expires_at) - Date.now()) / 86400_000;
  assert.ok(days > 6.9 && days < 7.1, 'vence en 7 días');
  const ext = await owner(`/api/sobres/${id}/extender`, { method: 'POST', body: { days: 20 } });
  assert.equal(ext.status, 200);
  const extended = (new Date((await ext.json()).expires_at) - Date.now()) / 86400_000;
  assert.ok(extended > 19.9 && extended < 20.1);

  const token = linkFrom((await outbox(t.pool, 'invite', 'vence@example.com'))[0]);
  await t.pool.query(`UPDATE envelopes SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
  assert.equal((await runScheduler(t.ctx)).expired, 1);
  assert.equal((await (await owner(`/api/sobres/${id}`)).json()).envelope.status, 'expired');
  assert.equal((await client(t.base)(`/api/firmar/${token}`)).status, 404, 'enlaces anulados al vencer');
  assert.equal((await outbox(t.pool, 'expired', 'fer@example.com')).length, 1, 'aviso al remitente');
  assert.equal((await runScheduler(t.ctx)).expired, 0);
});

test('corregir: anula sin consumir cupo y crea un borrador idéntico', async () => {
  const id = await newEnvelope('corregir@example.com');
  const before = await monthlyUsage(t.pool, ownerId);
  const res = await owner(`/api/sobres/${id}/corregir`, { method: 'POST' });
  assert.equal(res.status, 200);
  const { id: draftId } = await res.json();
  assert.equal(await monthlyUsage(t.pool, ownerId), before - 1, 'el anulado deja de contar');
  assert.equal((await (await owner(`/api/sobres/${id}`)).json()).envelope.status, 'voided');
  const draft = await (await owner(`/api/sobres/${draftId}`)).json();
  assert.equal(draft.envelope.status, 'draft');
  assert.equal(draft.envelope.corrected_from, id);
  assert.equal(draft.recipients.length, 1);
  assert.equal(draft.fields.length, 2);
  assert.equal((await owner(`/api/sobres/${draftId}/corregir`, { method: 'POST' })).status, 409, 'un borrador no se corrige');
});

test('firma en persona: solo con la sesión del remitente', async () => {
  const id = await newEnvelope('persona@example.com');
  const { rows: [r] } = await t.pool.query('SELECT id FROM recipients WHERE envelope_id = $1', [id]);
  const start = await owner(`/api/sobres/${id}/destinatarios/${r.id}/en-persona`, { method: 'POST' });
  assert.equal(start.status, 200);
  const token = (await start.json()).url.split('/').pop();
  const stranger = client(t.base);
  assert.equal((await (await stranger(`/api/firmar/${token}`)).json()).inPerson, true);
  assert.equal((await stranger(`/api/firmar/${token}/presencial`, { method: 'POST' })).status, 403, 'otro dispositivo no puede');
  const { session } = await (await owner(`/api/firmar/${token}/presencial`, { method: 'POST' })).json();
  const signed = await owner(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, consent: true } });
  assert.equal(signed.status, 200);
  assert.equal((await (await owner(`/api/sobres/${id}`)).json()).envelope.status, 'completed');
  const events = (await t.pool.query('SELECT type FROM events WHERE envelope_id = $1', [id])).rows.map((e) => e.type);
  assert.ok(events.includes('in_person_verified'));
});

test('plantillas: guardar, usar y envío masivo con resultado por fila', async () => {
  await t.pool.query(`UPDATE users SET plan = 'empresa' WHERE id = $1`, [ownerId]);
  const id = await newEnvelope('plantilla@example.com', { send: false, title: 'Contrato tipo' });
  const saved = await owner('/api/plantillas', { method: 'POST', body: { envelopeId: id, name: 'Contrato tipo' } });
  assert.equal(saved.status, 201);
  const tpl = await saved.json();
  const list = await (await owner('/api/plantillas')).json();
  const item = list.data.find((x) => x.id === tpl.id);
  assert.deepEqual(item.roles.map((r) => r.label), ['Firmante 1']);
  assert.equal(item.field_count, 2);

  const wrong = await owner(`/api/plantillas/${tpl.id}/usar`, { method: 'POST', body: { recipients: [], send: true } });
  assert.equal(wrong.status, 400);
  const used = await owner(`/api/plantillas/${tpl.id}/usar`, { method: 'POST', body: { recipients: [{ name: 'Uno', email: 'uno@example.com' }], send: true } });
  assert.equal(used.status, 201);
  const usedEnv = await (await owner(`/api/sobres/${(await used.json()).id}`)).json();
  assert.equal(usedEnv.envelope.status, 'sent');
  assert.equal(usedEnv.fields.length, 2);

  const bulk = await owner(`/api/plantillas/${tpl.id}/masivo`, { method: 'POST', body: { rows: [{ name: 'A', email: 'a-bulk@example.com' }, { name: 'B', email: 'no-es-un-email' }, { name: 'C', email: 'c-bulk@example.com' }] } });
  assert.equal(bulk.status, 200);
  const out = await bulk.json();
  assert.equal(out.sent, 2);
  assert.deepEqual(out.results.map((r) => r.status), ['sent', 'error', 'sent']);
  assert.equal((await outbox(t.pool, 'invite', 'a-bulk@example.com')).length, 1);
  const drafts = (await t.pool.query(`SELECT count(*)::int AS n FROM envelopes WHERE owner_id = $1 AND status = 'draft' AND template_id = $2`, [ownerId, tpl.id])).rows[0].n;
  assert.equal(drafts, 0, 'las filas con error no dejan borradores');
});

test('marca propia: color, empresa y logo en emails y en la firma', async () => {
  const bad = await owner('/api/ajustes', { method: 'PUT', body: { name: 'Fer', brand_color: 'rojo' } });
  assert.equal(bad.status, 400);
  const ok = await owner('/api/ajustes', { method: 'PUT', body: { name: 'Fer Funciones', company: 'Acme SA', brand_color: '#AA3300' } });
  assert.equal((await ok.json()).brand_color, '#aa3300');
  const png = Buffer.from(PNG.split(',')[1], 'base64');
  const notImage = await owner('/api/ajustes/logo', { method: 'PUT', body: Buffer.from('hola'), headers: { 'content-type': 'image/png' } });
  assert.equal(notImage.status, 400);
  const logo = await fetch(`${t.base}/api/ajustes/logo`, { method: 'PUT', headers: { 'x-docsure': '1', 'content-type': 'image/png', cookie: await sessionCookie() }, body: png });
  assert.equal(logo.status, 200);
  const served = await fetch(`${t.base}/marca/${ownerId}`);
  assert.equal(served.headers.get('content-type'), 'image/png');
  await newEnvelope('marca@example.com');
  const { rows: [mail] } = await t.pool.query(`SELECT html FROM emails WHERE to_email = 'marca@example.com' AND kind = 'invite'`);
  assert.match(mail.html, /#aa3300/);
  assert.match(mail.html, new RegExp(`/marca/${ownerId}`));
  const token = linkFrom((await outbox(t.pool, 'invite', 'marca@example.com'))[0]);
  const info = await (await client(t.base)(`/api/firmar/${token}`)).json();
  assert.equal(info.brand.name, 'Acme SA');
  assert.equal(info.brand.color, '#aa3300');
});

async function sessionCookie() {
  const res = await fetch(`${t.base}/api/auth/ingresar`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-docsure': '1' }, body: JSON.stringify({ email: 'fer@example.com', password: 'clave-funciones-1' }) });
  return res.headers.get('set-cookie').split(';')[0];
}
