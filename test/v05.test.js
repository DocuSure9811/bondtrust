import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { sealFingerprint, verifySeal } from '../src/pdf/verify.js';
import { PNG, client, codeFrom, linkFrom, outbox, samplePdf, startTestApp } from './helpers.js';

let t;
let owner;
before(async () => {
  t = await startTestApp();
  owner = client(t.base);
  await owner('/api/auth/registro', { method: 'POST', body: { name: 'Vera Cinco', email: 'vera@example.com', password: 'clave-v05-larga', plan: 'empresa' } });
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

// ---------- Campos: listas, formatos y condiciones ----------

const F = (o) => ({ recipientKey: 's', page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.03, ...o });
const COND_FIELDS = [
  F({ key: 'sig', type: 'signature', h: 0.06 }),
  F({ key: 'c', type: 'checkbox', label: 'Tiene DNI', y: 0.2, w: 0.03, h: 0.02 }),
  F({ key: 't', type: 'text', label: 'DNI', validation: 'id', y: 0.25, showIf: { key: 'c', equals: 'true' } }),
  F({ key: 's', type: 'select', label: 'Acepta', options: ['Sí', 'No', 'Sí'], y: 0.3 }),
  F({ key: 'u', type: 'text', label: 'Email alternativo', validation: 'email', y: 0.35, showIf: { key: 's', equals: 'No' } }),
];

async function condDraft(email, fields = COND_FIELDS) {
  const { id } = await (await owner('/api/sobres?title=Condicional', { method: 'POST', body: await samplePdf() })).json();
  const res = await owner(`/api/sobres/${id}`, { method: 'PUT', body: { title: 'Condicional', recipients: [{ key: 's', name: 'Cond Firmante', email }, { key: 'o', name: 'Otro', email: `otro-${email}` }], fields } });
  return { id, res };
}

async function openForSigning(email) {
  const signer = client(t.base);
  const token = linkFrom((await outbox(t.pool, 'invite', email)).at(-1));
  await signer(`/api/firmar/${token}/codigo`, { method: 'POST' });
  const code = codeFrom((await outbox(t.pool, 'otp', email)).at(-1));
  const { session } = await (await signer(`/api/firmar/${token}/verificar`, { method: 'POST', body: { code } })).json();
  const { fields } = await (await signer(`/api/firmar/${token}/campos`, { headers: { 'x-sign-session': session } })).json();
  const byLabel = Object.fromEntries(fields.filter((f) => f.label).map((f) => [f.label, f]));
  const sign = (values) => signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, consent: true, values } });
  return { byLabel, sign, fields, token, session, signer };
}

test('campos: validaciones del editor (listas, formatos, condiciones y ciclos)', async () => {
  const bad = async (fields, msg) => {
    const { res } = await condDraft('val@example.com', [F({ key: 'sig', type: 'signature' }), ...fields]);
    assert.equal(res.status, 400, msg);
    return (await res.json()).error;
  };
  await bad([F({ type: 'select', options: [] })], 'lista sin opciones');
  await bad([F({ type: 'text', validation: 'cuit' })], 'formato desconocido');
  await bad([F({ key: 'x', type: 'checkbox' }), F({ key: 'sig2', type: 'signature', showIf: { key: 'x', equals: 'true' } })], 'firma condicional');
  await bad([F({ key: 'a', type: 'text', showIf: { key: 'b', equals: 'x' } }), F({ key: 'b', type: 'text', showIf: { key: 'a', equals: 'y' } })], 'ciclo');
  await bad([F({ key: 'x', type: 'checkbox' }), F({ type: 'text', showIf: { key: 'x', equals: 'quizás' } })], 'casilla con valor inválido');
  await bad([F({ key: 'x', type: 'select', options: ['A'] }), F({ type: 'text', showIf: { key: 'x', equals: 'B' } })], 'opción inexistente');
  await bad([F({ key: 'x', type: 'checkbox', recipientKey: 'o' }), F({ key: 'sigo', type: 'signature', recipientKey: 'o' }), F({ type: 'text', showIf: { key: 'x', equals: 'true' } })], 'condición de otro firmante');
  await bad([F({ key: 'x', type: 'date' }), F({ type: 'text', showIf: { key: 'x', equals: 'hoy' } })], 'una fecha no controla');
  await bad([F({ type: 'text', showIf: { key: 'nada', equals: 'x' } })], 'condición a un campo inexistente');
});

test('campos condicionales: los ocultos no se exigen y los visibles se validan', async () => {
  const sig2 = F({ key: 'sigo', type: 'signature', recipientKey: 'o', y: 0.6 });
  const { id, res } = await condDraft('cond1@example.com', [...COND_FIELDS, sig2]);
  assert.equal(res.status, 200, await res.clone().text());
  const detail = await (await owner(`/api/sobres/${id}`)).json();
  const sel = detail.fields.find((f) => f.type === 'select');
  assert.deepEqual(sel.options, ['Sí', 'No'], 'opciones sin repetir');
  assert.ok(detail.fields.find((f) => f.label === 'DNI').cond_field_id, 'condición guardada');
  assert.equal((await owner(`/api/sobres/${id}/enviar`, { method: 'POST', headers: { 'idempotency-key': `c1-${id}` } })).status, 200);

  // Caso 1: casilla sin marcar y "Sí": DNI y email alternativo quedan ocultos.
  const a = await openForSigning('cond1@example.com');
  assert.equal(a.byLabel.DNI.cond_value, 'true');
  assert.equal((await a.sign({})).status, 400, 'la lista es obligatoria');
  assert.equal((await a.sign({ [a.byLabel.Acepta.id]: 'Quizás' })).status, 400, 'opción inexistente');
  assert.equal((await a.sign({ [a.byLabel.Acepta.id]: 'Sí', [a.byLabel.DNI.id]: 'ignorado' })).status, 200);
  const { rows } = await t.pool.query('SELECT label, value FROM fields WHERE envelope_id = $1 AND label <> \'\'', [id]);
  const v = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  assert.equal(v.Acepta, 'Sí');
  assert.equal(v.DNI, null, 'un campo oculto no guarda valor aunque lo manden');
  assert.equal(v['Email alternativo'], null);
  assert.equal(v['Tiene DNI'], 'false');

  // Caso 2: casilla marcada y "No": DNI y email alternativo pasan a ser obligatorios y con formato.
  const { id: id2 } = await condDraft('cond2@example.com');
  await owner(`/api/sobres/${id2}`, { method: 'PUT', body: { title: 'Condicional', recipients: [{ key: 's', name: 'Cond Dos', email: 'cond2@example.com' }], fields: COND_FIELDS } });
  assert.equal((await owner(`/api/sobres/${id2}/enviar`, { method: 'POST', headers: { 'idempotency-key': `c2-${id2}` } })).status, 200);
  const b = await openForSigning('cond2@example.com');
  const base = { [b.byLabel['Tiene DNI'].id]: true, [b.byLabel.Acepta.id]: 'No' };
  assert.equal((await b.sign(base)).status, 400, 'faltan los campos que aparecieron');
  const badDni = await b.sign({ ...base, [b.byLabel.DNI.id]: '12', [b.byLabel['Email alternativo'].id]: 'a@b.co' });
  assert.equal(badDni.status, 400);
  assert.match((await badDni.json()).error, /documento/);
  assert.equal((await b.sign({ ...base, [b.byLabel.DNI.id]: '30.111.222', [b.byLabel['Email alternativo'].id]: 'sin-arroba' })).status, 400);
  assert.equal((await b.sign({ ...base, [b.byLabel.DNI.id]: '30.111.222', [b.byLabel['Email alternativo'].id]: 'alt@example.com' })).status, 200);
  const { rows: [env] } = await t.pool.query('SELECT status FROM envelopes WHERE id = $1', [id2]);
  assert.equal(env.status, 'completed');

  // Plantilla y corrección conservan listas, formatos y condiciones.
  const tpl = await (await owner('/api/plantillas', { method: 'POST', body: { envelopeId: id2, name: 'Cond tpl' } })).json();
  const used = await (await owner(`/api/plantillas/${tpl.id}/usar`, { method: 'POST', body: { recipients: [{ name: 'Tpl Cond', email: 'tplcond@example.com' }] } })).json();
  const fromTpl = (await (await owner(`/api/sobres/${used.id}`)).json()).fields;
  assert.equal(fromTpl.filter((f) => f.cond_field_id).length, 2);
  assert.equal(fromTpl.find((f) => f.label === 'DNI').validation, 'id');
  const dniParent = fromTpl.find((f) => f.id === fromTpl.find((x) => x.label === 'DNI').cond_field_id);
  assert.equal(dniParent.label, 'Tiene DNI', 'la condición apunta al campo copiado');
  assert.equal((await owner(`/api/sobres/${used.id}/enviar`, { method: 'POST', headers: { 'idempotency-key': `tpl-${used.id}` } })).status, 200);
  const corrected = await (await owner(`/api/sobres/${used.id}/corregir`, { method: 'POST' })).json();
  const fromCorrection = (await (await owner(`/api/sobres/${corrected.id}`)).json()).fields;
  assert.equal(fromCorrection.filter((f) => f.cond_field_id).length, 2, 'la corrección conserva las condiciones');
  assert.deepEqual(fromCorrection.find((f) => f.type === 'select').options, ['Sí', 'No']);
});

test('campos condicionales por API v1', async () => {
  const { key } = await (await owner('/api/claves', { method: 'POST', body: { name: 'cond' } })).json();
  const b64 = (await samplePdf()).toString('base64');
  const res = await fetch(`${t.base}/api/v1/envelopes`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'API cond', document_base64: b64, recipients: [{ name: 'Api Cond', email: 'apicond@example.com' }],
      fields: [
        { recipient: 0, type: 'signature', page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.06 },
        { recipient: 0, key: 'plan', type: 'select', options: ['Mensual', 'Anual'], page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.03 },
        { recipient: 0, type: 'text', label: 'CUIT', validation: 'number', show_if: { field: 'plan', equals: 'Anual' }, page: 1, x: 0.1, y: 0.3, width: 0.3, height: 0.03 },
      ],
    }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  const a = await openForSigning('apicond@example.com');
  const plan = a.fields.find((f) => f.type === 'select');
  assert.equal((await a.sign({ [plan.id]: 'Anual' })).status, 400, 'con Anual el CUIT es obligatorio');
  assert.equal((await a.sign({ [plan.id]: 'Anual', [a.byLabel.CUIT.id]: '20301112223' })).status, 200);
  const spec = await (await fetch(`${t.base}/openapi.json`)).json();
  assert.ok(spec.components.schemas.Field.properties.show_if);
});

// ---------- Adjuntos del firmante ----------

test('adjuntos: subir, validar, reemplazar, anexar al PDF final y sello íntegro', async () => {
  const { id } = await (await owner('/api/sobres?title=Con%20adjuntos', { method: 'POST', body: await samplePdf() })).json();
  const fields = [
    F({ key: 'sig', type: 'signature', h: 0.06 }),
    F({ key: 'dni', type: 'attachment', label: 'DNI frente', y: 0.3, h: 0.04 }),
    F({ key: 'c', type: 'checkbox', label: 'Tengo constancia', y: 0.4, w: 0.03, h: 0.02 }),
    F({ key: 'extra', type: 'attachment', label: 'Constancia', y: 0.5, h: 0.04, showIf: { key: 'c', equals: 'true' } }),
  ];
  assert.equal((await owner(`/api/sobres/${id}`, { method: 'PUT', body: { title: 'Con adjuntos', recipients: [{ key: 's', name: 'Adj Firmante', email: 'adj@example.com' }], fields } })).status, 200);
  assert.equal((await owner(`/api/sobres/${id}/enviar`, { method: 'POST', headers: { 'idempotency-key': `adj-${id}` } })).status, 200);

  const a = await openForSigning('adj@example.com');
  const { token, session, signer } = a;
  const up = (fieldId, body, { name = 'dni.png', sess = session } = {}) => fetch(`${t.base}/api/firmar/${token}/adjuntos/${fieldId}`, {
    method: 'PUT', headers: { 'x-docsure': '1', 'x-sign-session': sess, 'x-file-name': encodeURIComponent(name), 'content-type': 'application/octet-stream' }, body,
  });
  const png = Buffer.from(PNG.split(',')[1], 'base64');
  const dniId = a.byLabel['DNI frente'].id;
  const extraId = a.byLabel.Constancia.id;

  assert.equal((await a.sign({})).status, 400, 'falta el adjunto obligatorio');
  assert.equal((await up(dniId, Buffer.from('hola, no soy una imagen'))).status, 415);
  assert.equal((await up(dniId, Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]))).status, 413);
  assert.equal((await up(dniId, png, { sess: 'x'.repeat(40) })).status, 401, 'sin sesión de firma no se sube');
  assert.equal((await up(a.byLabel['Tengo constancia'].id, png)).status, 404, 'solo campos de tipo adjunto');
  assert.equal((await up('00000000-0000-0000-0000-000000000000', png)).status, 404);
  const first = await up(dniId, png, { name: 'C:\\fotos\\dni.png' });
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal((await first.json()).name, 'C:_fotos_dni.png', 'el nombre no lleva rutas');
  const replaced = await (await up(dniId, await samplePdf(), { name: 'dni.pdf' })).json();
  assert.equal(replaced.content_type, 'application/pdf', 'se reemplaza');
  assert.equal((await up(extraId, png, { name: 'constancia.png' })).status, 200);

  // La casilla queda sin marcar: el adjunto condicional se descarta.
  const signed = await signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, consent: true, values: {} } });
  assert.equal(signed.status, 200, await signed.clone().text());
  const { rows: att } = await t.pool.query('SELECT name, content_type FROM attachments WHERE envelope_id = $1', [id]);
  assert.deepEqual(att.map((x) => x.name), ['dni.pdf']);
  assert.equal((await up(dniId, png)).status, 410, 'después de firmar no se puede subir');

  const { rows: [env] } = await t.pool.query('SELECT status, final_pdf FROM envelopes WHERE id = $1', [id]);
  assert.equal(env.status, 'completed');
  const final = await PDFDocument.load(env.final_pdf);
  assert.ok(final.getPageCount() >= 5, 'documento (2) + adjunto (2) + certificado');
  const seal = verifySeal(env.final_pdf, sealFingerprint(t.config.sealP12, t.config.sealPassword));
  assert.equal(seal.intact, true, 'el sello cubre también los adjuntos');

  const detail = await (await owner(`/api/sobres/${id}`)).json();
  assert.equal(detail.attachments.length, 1);
  assert.equal(detail.attachments[0].label, 'DNI frente');
  const dl = await owner(`/api/sobres/${id}/adjuntos/${detail.attachments[0].id}`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.match(dl.headers.get('content-disposition'), /^attachment;/);
  const other = client(t.base);
  await other('/api/auth/registro', { method: 'POST', body: { name: 'Ajeno', email: 'ajeno-adj@example.com', password: 'clave-ajena-larga' } });
  assert.equal((await other(`/api/sobres/${id}/adjuntos/${detail.attachments[0].id}`)).status, 404);

  const { key } = await (await owner('/api/claves', { method: 'POST', body: { name: 'adj' } })).json();
  const apiEnv = await (await fetch(`${t.base}/api/v1/envelopes/${id}`, { headers: { authorization: `Bearer ${key}` } })).json();
  assert.equal(apiEnv.attachments.length, 1);
  const apiDl = await fetch(apiEnv.attachments[0].url.replace(t.config.appUrl, t.base), { headers: { authorization: `Bearer ${key}` } });
  assert.equal(apiDl.status, 200);
});
