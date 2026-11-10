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

const waitFor = async (fn, what) => {
  for (let i = 0; i < 60; i += 1) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no ocurrió: ${what}`);
};

test('automatizaciones: validación, mover a carpeta, copia firmada con enlace propio, aviso al rechazar y pausa', async () => {
  const rule = (body) => owner('/api/automatizaciones', { method: 'POST', body });
  const { id: folderId } = await (await owner('/api/carpetas', { method: 'POST', body: { name: 'Alquileres' } })).json();
  assert.equal((await rule({ trigger: 'declined', action: 'send_copy', email: 'x@example.com' })).status, 400, 'copia solo al completarse');
  assert.equal((await rule({ trigger: 'completed', action: 'move_folder' })).status, 400, 'carpeta obligatoria');
  assert.equal((await rule({ trigger: 'completed', action: 'notify', email: 'no-es-email' })).status, 400, 'email válido');
  assert.equal((await rule({ trigger: 'nunca', action: 'notify', email: 'x@example.com' })).status, 400, 'disparador válido');

  const move = await (await rule({ trigger: 'completed', title_contains: 'alquiler', action: 'move_folder', folder_id: folderId })).json();
  const copy = await (await rule({ trigger: 'completed', action: 'send_copy', email: 'copia@example.com', name: 'Copia al estudio' })).json();
  await rule({ trigger: 'declined', action: 'notify', email: 'aviso@example.com' });
  assert.equal(move.folder_name, 'Alquileres');
  assert.equal(copy.name, 'Copia al estudio');

  const a = await completed('auto1@example.com', 'Alquiler depto 3B');
  await waitFor(async () => (await (await owner(`/api/sobres/${a}`)).json()).envelope.folder_id === folderId, 'mover a carpeta');
  const copies = await waitFor(async () => { const m = await outbox(t.pool, 'copy', 'copia@example.com'); return m.length === 1 && m; }, 'copia enviada');
  const token = copies[0].match(/\/documento\/([A-Za-z0-9_-]+)/)[1];
  const pdf = await fetch(`${t.base}/documento/${token}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal((await pdf.arrayBuffer()).byteLength > 1000, true);

  // Otro título: no se mueve, pero la copia (sin condición) sí sale.
  const b = await completed('auto2@example.com', 'Contrato de servicios');
  await waitFor(async () => (await outbox(t.pool, 'copy', 'copia@example.com')).length === 2, 'segunda copia');
  assert.equal((await (await owner(`/api/sobres/${b}`)).json()).envelope.folder_id, null);

  // Enlace vencido: deja de funcionar.
  await t.pool.query("UPDATE document_links SET expires_at = now() - interval '1 minute'");
  assert.equal((await fetch(`${t.base}/documento/${token}/pdf`)).status, 404);

  // Pausada, no se ejecuta.
  assert.equal((await owner(`/api/automatizaciones/${copy.id}`, { method: 'PUT', body: { active: false } })).status, 200);
  await completed('auto3@example.com', 'Contrato pausado');
  await new Promise((r) => setTimeout(r, 800));
  assert.equal((await outbox(t.pool, 'copy', 'copia@example.com')).length, 2);
  const list = (await (await owner('/api/automatizaciones')).json()).data;
  assert.equal(list.find((r) => r.id === copy.id).runs, 2);
  assert.equal(list.find((r) => r.id === move.id).runs, 1);

  // Rechazo: aviso por email.
  const { id: d } = await (await owner('/api/sobres?title=Rechazo', { method: 'POST', body: await samplePdf() })).json();
  await owner(`/api/sobres/${d}`, { method: 'PUT', body: { title: 'Rechazo', recipients: [{ key: 's', name: 'Firma', email: 'rechaza@example.com' }], fields: [F({ type: 'signature' })] } });
  await owner(`/api/sobres/${d}/enviar`, { method: 'POST', headers: { 'idempotency-key': `r-${d}` } });
  const signer = client(t.base);
  const st = linkFrom((await outbox(t.pool, 'invite', 'rechaza@example.com')).at(-1));
  await signer(`/api/firmar/${st}/codigo`, { method: 'POST' });
  const { session } = await (await signer(`/api/firmar/${st}/verificar`, { method: 'POST', body: { code: codeFrom((await outbox(t.pool, 'otp', 'rechaza@example.com')).at(-1)) } })).json();
  assert.equal((await signer(`/api/firmar/${st}/rechazar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { reason: 'No corresponde' } })).status, 200);
  const notice = await waitFor(async () => (await outbox(t.pool, 'notice', 'aviso@example.com'))[0], 'aviso de rechazo');
  assert.match(notice, /fue rechazado/);

  // Otra cuenta no toca reglas ajenas.
  const other = client(t.base);
  await other('/api/auth/registro', { method: 'POST', body: { name: 'Ajena', email: 'ajena7@example.com', password: 'clave-ajena-larga' } });
  assert.equal((await other(`/api/automatizaciones/${copy.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await owner(`/api/automatizaciones/${copy.id}`, { method: 'DELETE' })).status, 200);
});
