import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { client, samplePdf, startTestApp } from './helpers.js';

let t;
let owner;
before(async () => {
  t = await startTestApp();
  owner = client(t.base);
  await owner('/api/auth/registro', { method: 'POST', body: { name: 'Vera Cinco', email: 'vera@example.com', password: 'clave-v05-larga' } });
});
after(async () => t.stop());

async function newEnvelope(recipients, opts = {}) {
  const created = await (await owner(`/api/sobres?title=${encodeURIComponent(opts.title || 'Prueba')}`, { method: 'POST', body: await samplePdf() })).json();
  const res = await owner(`/api/sobres/${created.id}`, {
    method: 'PUT',
    body: {
      title: opts.title || 'Prueba',
      recipients: recipients.map((r, i) => ({ key: `k${i}`, ...r })),
      fields: opts.fields || recipients.map((_, i) => ({ recipientKey: `k${i}`, type: 'signature', page: 1, x: 0.1, y: 0.1 + i * 0.1, w: 0.3, h: 0.06 })),
    },
  });
  assert.equal(res.status, 200, await res.clone().text());
  if (opts.send !== false) assert.equal((await owner(`/api/sobres/${created.id}/enviar`, { method: 'POST', headers: { 'idempotency-key': `k-${created.id}` } })).status, 200);
  return created.id;
}

test('contactos: se guardan solos al enviar, sin duplicar, y se gestionan', async () => {
  await newEnvelope([{ name: 'Ana Contacto', email: 'ana@example.com' }, { name: 'Copia Uno', email: 'copia@example.com', role: 'cc' }]);
  const id2 = await newEnvelope([{ name: 'Ana C. Pérez', email: 'ana@example.com' }]);
  // El reintento idempotente del envío no cuenta dos veces.
  await owner(`/api/sobres/${id2}/enviar`, { method: 'POST', headers: { 'idempotency-key': `k-${id2}` } });
  await newEnvelope([{ name: 'Borrador Nunca', email: 'borrador@example.com' }], { send: false });

  let list = (await (await owner('/api/contactos')).json()).data;
  assert.deepEqual(list.map((c) => c.email).sort(), ['ana@example.com', 'copia@example.com']);
  const ana = list.find((c) => c.email === 'ana@example.com');
  assert.equal(ana.uses, 2);
  assert.equal(ana.name, 'Ana C. Pérez', 'se actualiza con el último nombre usado');

  const search = (await (await owner('/api/contactos?q=COPIA')).json()).data;
  assert.equal(search.length, 1);
  assert.equal((await (await owner('/api/contactos?q=%25')).json()).data.length, 0, 'los comodines se escapan');

  const created = await owner('/api/contactos', { method: 'POST', body: { name: 'Manual', email: 'MANUAL@example.com' } });
  assert.equal(created.status, 201);
  const manual = await created.json();
  assert.equal(manual.email, 'manual@example.com');
  assert.equal((await owner('/api/contactos', { method: 'POST', body: { name: 'x', email: 'no-es-email' } })).status, 400);
  assert.equal((await owner(`/api/contactos/${manual.id}`, { method: 'PUT', body: { name: 'Manual', email: 'ana@example.com' } })).status, 409);
  assert.equal((await owner(`/api/contactos/${manual.id}`, { method: 'PUT', body: { name: 'Manual Editado', email: 'manual2@example.com' } })).status, 200);

  // Aislamiento entre cuentas
  const other = client(t.base);
  await other('/api/auth/registro', { method: 'POST', body: { name: 'Otro', email: 'otro-ct@example.com', password: 'clave-otro-larga' } });
  assert.equal((await (await other('/api/contactos')).json()).data.length, 0);
  assert.equal((await other(`/api/contactos/${manual.id}`, { method: 'DELETE' })).status, 404);

  assert.equal((await owner(`/api/contactos/${manual.id}`, { method: 'DELETE' })).status, 200);
  list = (await (await owner('/api/contactos')).json()).data;
  assert.equal(list.length, 2);
  assert.equal((await owner('/app/contactos')).status, 200);
});

test('contactos por API v1', async () => {
  const { key } = await (await owner('/api/claves', { method: 'POST', body: { name: 'ct' } })).json();
  const h = { authorization: `Bearer ${key}` };
  const res = await fetch(`${t.base}/api/v1/contacts?q=ana`, { headers: h });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data[0].email, 'ana@example.com');
  const post = await fetch(`${t.base}/api/v1/contacts`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Api', email: 'api-ct@example.com' }) });
  assert.equal(post.status, 201);
  const spec = await (await fetch(`${t.base}/openapi.json`)).json();
  assert.ok(spec.paths['/contacts'] && spec.paths['/contacts/{id}']);
  assert.match(await (await fetch(`${t.base}/llms.txt`)).text(), /\/contacts/);
});
