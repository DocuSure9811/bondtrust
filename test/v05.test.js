import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { PNG, client, codeFrom, linkFrom, outbox, samplePdf, startTestApp } from './helpers.js';

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
      fields: opts.fields || recipients.flatMap((r, i) => (r.role === 'cc' ? [] : [{ recipientKey: `k${i}`, type: 'signature', page: 1, x: 0.1, y: 0.1 + i * 0.1, w: 0.3, h: 0.06 }])),
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

async function signWith(signer, token, email) {
  assert.equal((await signer(`/api/firmar/${token}/codigo`, { method: 'POST' })).status, 200);
  const code = codeFrom((await outbox(t.pool, 'otp', email)).at(-1));
  const { session } = await (await signer(`/api/firmar/${token}/verificar`, { method: 'POST', body: { code } })).json();
  return { session, res: await signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, consent: true } }) };
}

test('varios documentos: agregar, quitar (corre los campos), firmar y certificado', async () => {
  const pdf = await samplePdf();
  const created = await (await owner('/api/sobres?title=Paquete&name=Contrato.pdf', { method: 'POST', body: pdf })).json();
  assert.deepEqual(created.documents.map((d) => d.name), ['Contrato']);
  const id = created.id;
  let res = await owner(`/api/sobres/${id}/documentos?name=Anexo%20A`, { method: 'POST', body: pdf });
  assert.equal(res.status, 201);
  res = await owner(`/api/sobres/${id}/documentos?name=Anexo%20B`, { method: 'POST', body: pdf });
  const added = await res.json();
  assert.equal(added.pageCount, 6);
  assert.deepEqual(added.documents.map((d) => [d.name, d.pages]), [['Contrato', 2], ['Anexo A', 2], ['Anexo B', 2]]);
  assert.equal((await owner(`/api/sobres/${id}/documentos?name=x`, { method: 'POST', body: Buffer.from('%PDF-roto') })).status, 400);

  const sig = (page) => ({ recipientKey: 's', type: 'signature', page, x: 0.1, y: 0.1, w: 0.3, h: 0.06 });
  assert.equal((await owner(`/api/sobres/${id}`, { method: 'PUT', body: { title: 'Paquete', recipients: [{ key: 's', name: 'Doc Firmante', email: 'docs@example.com' }], fields: [sig(1), sig(3), sig(4), sig(6)] } })).status, 200);
  // Quitar "Anexo A" (páginas 3-4): se borran sus campos y el de la página 6 pasa a la 4.
  const removed = await (await owner(`/api/sobres/${id}/documentos/1`, { method: 'DELETE' })).json();
  assert.deepEqual(removed.removed, { start: 3, count: 2 });
  const detail = await (await owner(`/api/sobres/${id}`)).json();
  assert.equal(detail.envelope.page_count, 4);
  assert.deepEqual(detail.fields.map((f) => f.page).sort(), [1, 4]);
  assert.deepEqual(detail.envelope.documents.map((d) => d.name), ['Contrato', 'Anexo B']);
  const original = Buffer.from(await (await owner(`/api/sobres/${id}/original.pdf`)).arrayBuffer());
  assert.equal((await PDFDocument.load(original)).getPageCount(), 4);
  assert.equal((await owner(`/api/sobres/${id}/documentos/5`, { method: 'DELETE' })).status, 404);

  assert.equal((await owner(`/api/sobres/${id}/enviar`, { method: 'POST', headers: { 'idempotency-key': `docs-${id}` } })).status, 200);
  assert.equal((await owner(`/api/sobres/${id}/documentos?name=tarde`, { method: 'POST', body: pdf })).status, 409, 'no se agregan documentos a un sobre enviado');
  assert.equal((await owner(`/api/sobres/${id}/documentos/0`, { method: 'DELETE' })).status, 409);

  const signer = client(t.base);
  const token = linkFrom((await outbox(t.pool, 'invite', 'docs@example.com'))[0]);
  const { session, res: signed } = await signWith(signer, token, 'docs@example.com');
  assert.equal(signed.status, 200);
  assert.ok(session);
  const { rows: [env] } = await t.pool.query('SELECT status, final_pdf FROM envelopes WHERE id = $1', [id]);
  assert.equal(env.status, 'completed');
  const final = await PDFDocument.load(env.final_pdf);
  assert.ok(final.getPageCount() >= 5, '4 páginas + certificado');
});

test('varios documentos: un solo documento no se puede quitar; límites', async () => {
  const pdf = await samplePdf();
  const { id } = await (await owner('/api/sobres?title=Uno', { method: 'POST', body: pdf })).json();
  assert.equal((await owner(`/api/sobres/${id}/documentos/0`, { method: 'DELETE' })).status, 400);
  for (let i = 0; i < 9; i += 1) assert.equal((await owner(`/api/sobres/${id}/documentos?name=d${i}`, { method: 'POST', body: pdf })).status, 201);
  assert.equal((await owner(`/api/sobres/${id}/documentos?name=once`, { method: 'POST', body: pdf })).status, 400, 'máximo 10');
});

test('varios documentos por API v1', async () => {
  const { key } = await (await owner('/api/claves', { method: 'POST', body: { name: 'docs' } })).json();
  const b64 = (await samplePdf()).toString('base64');
  const res = await fetch(`${t.base}/api/v1/envelopes`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'API docs', documents: [{ name: 'Uno', document_base64: b64 }, { name: 'Dos', document_base64: b64 }], recipients: [{ name: 'Api Docs', email: 'apidocs@example.com' }] }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  const body = await res.json();
  assert.equal(body.page_count, 4);
  assert.deepEqual(body.documents.map((d) => d.name), ['Uno', 'Dos']);
  const token = linkFrom((await outbox(t.pool, 'invite', 'apidocs@example.com'))[0]);
  const signer = client(t.base);
  const { rows: [f] } = await t.pool.query(`SELECT page FROM fields f JOIN recipients r ON r.id = f.recipient_id WHERE r.email = 'apidocs@example.com' AND f.type = 'signature'`);
  assert.equal(f.page, 4, 'la firma automática va en la última página del último documento');
  assert.equal((await signer(`/api/firmar/${token}/campos`, { headers: { 'x-sign-session': 'x' } })).status, 401, 'sin sesión no hay campos');
});
