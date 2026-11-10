import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { sealFingerprint, verifySeal } from '../src/pdf/verify.js';
import { base32Encode, currentStep, openSecret, sealSecret, totpAt, verifyTotp } from '../src/totp.js';
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

// ---------- Carpetas y búsqueda ----------

test('carpetas: crear, renombrar, mover, filtrar y borrar sin perder sobres', async () => {
  const create = (name) => owner('/api/carpetas', { method: 'POST', body: { name } });
  const ventas = await (await create('Ventas')).json();
  assert.equal((await create('Ventas')).status, 409, 'nombre repetido');
  assert.equal((await create('  ')).status, 400);
  const rrhh = await (await create('RR.HH.')).json();
  assert.equal((await owner(`/api/carpetas/${rrhh.id}`, { method: 'PUT', body: { name: 'Ventas' } })).status, 409);
  assert.equal((await owner(`/api/carpetas/${rrhh.id}`, { method: 'PUT', body: { name: 'Recursos Humanos' } })).status, 200);

  const { id } = await (await owner('/api/sobres?title=Propuesta%20Acme', { method: 'POST', body: await samplePdf() })).json();
  await owner(`/api/sobres/${id}`, { method: 'PUT', body: { title: 'Propuesta Acme', recipients: [{ key: 'a', name: 'Lucía Compradora', email: 'lucia@acme.com' }], fields: [] } });
  assert.equal((await owner(`/api/sobres/${id}/carpeta`, { method: 'PUT', body: { folderId: ventas.id } })).status, 200);

  const other = client(t.base);
  await other('/api/auth/registro', { method: 'POST', body: { name: 'Ajeno', email: 'ajeno-fold@example.com', password: 'clave-ajena-larga' } });
  const foreign = await (await other('/api/carpetas', { method: 'POST', body: { name: 'Mía' } })).json();
  assert.equal((await owner(`/api/sobres/${id}/carpeta`, { method: 'PUT', body: { folderId: foreign.id } })).status, 404, 'no se usa una carpeta ajena');
  assert.equal((await other(`/api/sobres/${id}/carpeta`, { method: 'PUT', body: { folderId: foreign.id } })).status, 404, 'no se mueve un sobre ajeno');
  assert.equal((await other(`/api/carpetas/${ventas.id}`, { method: 'DELETE' })).status, 404);

  const list = (await (await owner('/api/sobres')).json()).envelopes;
  const env = list.find((e) => e.id === id);
  assert.equal(env.folder_id, ventas.id);
  assert.deepEqual(env.recipients, [{ name: 'Lucía Compradora', email: 'lucia@acme.com', role: 'signer' }]);
  const folders = (await (await owner('/api/carpetas')).json()).data;
  assert.equal(folders.find((f) => f.id === ventas.id).envelopes, 1);

  const { key } = await (await owner('/api/claves', { method: 'POST', body: { name: 'fold' } })).json();
  const h = { authorization: `Bearer ${key}` };
  const byFolder = await (await fetch(`${t.base}/api/v1/envelopes?folder_id=${ventas.id}`, { headers: h })).json();
  assert.deepEqual(byFolder.data.map((e) => e.id), [id]);
  const byQuery = await (await fetch(`${t.base}/api/v1/envelopes?q=lucia@acme`, { headers: h })).json();
  assert.deepEqual(byQuery.data.map((e) => e.id), [id]);
  assert.equal(byQuery.data[0].signers_total, 1);
  const none = await (await fetch(`${t.base}/api/v1/envelopes?folder_id=none&q=acme`, { headers: h })).json();
  assert.equal(none.data.length, 0);
  const moved = await fetch(`${t.base}/api/v1/envelopes/${id}/folder`, { method: 'PUT', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ folder_id: rrhh.id }) });
  assert.equal((await moved.json()).folder_id, rrhh.id);

  assert.equal((await owner(`/api/carpetas/${rrhh.id}`, { method: 'DELETE' })).status, 200);
  const after = (await (await owner('/api/sobres')).json()).envelopes.find((e) => e.id === id);
  assert.ok(after, 'el sobre sigue existiendo');
  assert.equal(after.folder_id, null, 'queda sin carpeta');
});

// ---------- Equipos y roles ----------

async function newUser(name, email) {
  const c = client(t.base);
  await c('/api/auth/registro', { method: 'POST', body: { name, email, password: 'clave-equipo-larga', plan: 'empresa' } });
  const id = (await (await c('/api/me')).json()).user.id;
  return { c, id, email };
}

test('equipos: invitar, aceptar, roles, plantillas compartidas y vista de administrador', async () => {
  const ana = await newUser('Ana Admin', 'ana-team@example.com');
  const beto = await newUser('Beto Miembro', 'beto-team@example.com');
  const caro = await newUser('Caro Externa', 'caro-team@example.com');
  const dani = await newUser('Dani Dos', 'dani-team@example.com');

  assert.equal((await (await beto.c('/api/equipo')).json()).team, null);
  assert.equal((await ana.c('/api/equipo', { method: 'POST', body: { name: 'Comercial' } })).status, 201);
  assert.equal((await ana.c('/api/equipo', { method: 'POST', body: { name: 'Otro' } })).status, 409, 'un equipo por persona');

  const inv = await (await ana.c('/api/equipo/invitaciones', { method: 'POST', body: { email: 'BETO-team@example.com', role: 'member' } })).json();
  assert.match(inv.url, /\/app\/unirse\?token=/);
  const token = new URL(inv.url).searchParams.get('token');
  const { rows: [mail] } = await t.pool.query(`SELECT subject FROM emails WHERE kind = 'team_invite' AND to_email = 'beto-team@example.com'`);
  assert.match(mail.subject, /Comercial/);

  assert.equal((await (await caro.c(`/api/equipo/invitacion?token=${token}`)).json()).matches, false);
  assert.equal((await caro.c('/api/equipo/unirse', { method: 'POST', body: { token } })).status, 403, 'la invitación es para otro email');
  assert.equal((await beto.c('/api/equipo/unirse', { method: 'POST', body: { token: 'x'.repeat(30) } })).status, 404);
  assert.equal((await beto.c('/api/equipo/unirse', { method: 'POST', body: { token } })).status, 200);
  assert.equal((await beto.c('/api/equipo/unirse', { method: 'POST', body: { token } })).status, 410, 'un solo uso');
  assert.equal((await beto.c('/api/equipo/invitaciones', { method: 'POST', body: { email: 'x@example.com' } })).status, 403, 'un miembro no invita');
  assert.equal((await ana.c('/api/equipo/invitaciones', { method: 'POST', body: { email: 'beto-team@example.com' } })).status, 409, 'ya es miembro');

  const invD = await (await ana.c('/api/equipo/invitaciones', { method: 'POST', body: { email: 'dani-team@example.com', role: 'admin' } })).json();
  await t.pool.query(`UPDATE team_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [invD.id]);
  assert.equal((await dani.c('/api/equipo/unirse', { method: 'POST', body: { token: new URL(invD.url).searchParams.get('token') } })).status, 410, 'invitación vencida');
  const invD2 = await (await ana.c('/api/equipo/invitaciones', { method: 'POST', body: { email: 'dani-team@example.com', role: 'admin' } })).json();
  assert.equal((await dani.c('/api/equipo/unirse', { method: 'POST', body: { token: new URL(invD2.url).searchParams.get('token') } })).status, 200);

  const team = await (await ana.c('/api/equipo')).json();
  assert.deepEqual(team.members.map((m) => [m.email, m.role]).sort(), [['ana-team@example.com', 'admin'], ['beto-team@example.com', 'member'], ['dani-team@example.com', 'admin']]);
  assert.deepEqual((await (await beto.c('/api/equipo')).json()).invites, [], 'un miembro no ve invitaciones');

  // Sobre y plantilla de Beto
  const { id: envB } = await (await beto.c('/api/sobres?title=Cotizacion%20Beto', { method: 'POST', body: await samplePdf() })).json();
  await beto.c(`/api/sobres/${envB}`, { method: 'PUT', body: { title: 'Cotizacion Beto', recipients: [{ key: 'a', name: 'Cliente Beto', email: 'cliente-beto@example.com' }], fields: [{ recipientKey: 'a', type: 'signature', page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.06 }] } });
  assert.equal((await beto.c(`/api/sobres/${envB}/enviar`, { method: 'POST', headers: { 'idempotency-key': `b-${envB}` } })).status, 200);
  const tplB = await (await beto.c('/api/plantillas', { method: 'POST', body: { envelopeId: envB, name: 'Cotización estándar' } })).json();

  const anaTpls = (await (await ana.c('/api/plantillas')).json()).data;
  const shared = anaTpls.find((x) => x.id === tplB.id);
  assert.ok(shared, 'la plantilla del compañero se ve');
  assert.equal(shared.mine, false);
  assert.equal(shared.owner_name, 'Beto Miembro');
  assert.equal(shared.can_delete, true, 'un admin puede borrarla');
  assert.equal((await ana.c(`/api/plantillas/${tplB.id}/usar`, { method: 'POST', body: { recipients: [{ name: 'Cliente Ana', email: 'cliente-ana@example.com' }] } })).status, 201, 'se usa la plantilla del equipo');
  assert.equal((await (await caro.c('/api/plantillas')).json()).data.length, 0, 'fuera del equipo no se ve');
  assert.equal((await caro.c(`/api/plantillas/${tplB.id}/usar`, { method: 'POST', body: { recipients: [{ name: 'X', email: 'x@example.com' }] } })).status, 404);

  // Vista de administrador: lectura sí, acciones no
  const teamList = (await (await ana.c('/api/sobres?alcance=equipo')).json()).envelopes;
  const seen = teamList.find((e) => e.id === envB);
  assert.equal(seen.owner_name, 'Beto Miembro');
  assert.equal((await (await ana.c('/api/sobres')).json()).envelopes.some((e) => e.id === envB), false, 'por defecto solo los propios');
  assert.equal((await (await beto.c('/api/sobres?alcance=equipo')).json()).envelopes.every((e) => e.owner_id === beto.id), true, 'un miembro solo ve los suyos');
  const detail = await (await ana.c(`/api/sobres/${envB}`)).json();
  assert.equal(detail.envelope.can_edit, false);
  assert.equal(detail.envelope.owner_name, 'Beto Miembro');
  assert.equal((await ana.c(`/api/sobres/${envB}/original.pdf`)).status, 200);
  assert.equal((await ana.c(`/api/sobres/${envB}/anular`, { method: 'POST' })).status, 404, 'el admin no actúa sobre sobres ajenos');
  assert.equal((await caro.c(`/api/sobres/${envB}`)).status, 404);
  assert.equal((await (await beto.c(`/api/sobres/${envB}`)).json()).envelope.can_edit, true);

  // API v1
  const { key } = await (await ana.c('/api/claves', { method: 'POST', body: { name: 'team' } })).json();
  const v1team = await (await fetch(`${t.base}/api/v1/team`, { headers: { authorization: `Bearer ${key}` } })).json();
  assert.equal(v1team.team.name, 'Comercial');
  assert.equal(v1team.members.length, 3);
  const v1list = await (await fetch(`${t.base}/api/v1/envelopes?scope=team`, { headers: { authorization: `Bearer ${key}` } })).json();
  assert.ok(v1list.data.some((e) => e.id === envB));

  // Roles y salidas
  assert.equal((await ana.c(`/api/equipo/miembros/${dani.id}`, { method: 'PUT', body: { role: 'member' } })).status, 200);
  assert.equal((await ana.c(`/api/equipo/miembros/${ana.id}`, { method: 'PUT', body: { role: 'member' } })).status, 400, 'queda al menos un admin');
  assert.equal((await beto.c(`/api/equipo/miembros/${ana.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await ana.c(`/api/equipo/miembros/${ana.id}`, { method: 'DELETE' })).status, 400, 'el último admin no sale sin reemplazo');
  assert.equal((await ana.c(`/api/equipo/miembros/${beto.id}`, { method: 'PUT', body: { role: 'admin' } })).status, 200);
  assert.equal((await ana.c(`/api/equipo/miembros/${ana.id}`, { method: 'DELETE' })).status, 200, 'sale con otro admin');
  assert.equal((await (await ana.c('/api/equipo')).json()).team, null);
  assert.equal((await ana.c(`/api/sobres/${envB}`)).status, 404, 'fuera del equipo ya no ve los sobres');
  assert.equal((await beto.c(`/api/equipo/miembros/${dani.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await beto.c(`/api/equipo/miembros/${beto.id}`, { method: 'DELETE' })).status, 200, 'el último miembro sale y el equipo se borra');
  const { rows } = await t.pool.query(`SELECT count(*)::int AS n FROM teams WHERE name = 'Comercial'`);
  assert.equal(rows[0].n, 0);
  assert.equal((await (await beto.c(`/api/sobres/${envB}`)).json()).envelope.can_edit, true, 'el sobre sigue siendo de Beto');
  assert.equal((await ana.c('/app/equipo')).status, 200);
});

// ---------- Seguridad de la cuenta ----------

test('TOTP: vectores oficiales del RFC 6238 y cifrado del secreto', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totpAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totpAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totpAt(secret, Math.floor(2000000000 / 30)), '279037');
  assert.equal(verifyTotp(secret, '287082', { now: 59_000 }), 1);
  assert.equal(verifyTotp(secret, '287082', { now: 59_000, afterStep: 1 }), null, 'no se reutiliza un paso');
  assert.equal(verifyTotp(secret, '000000', { now: 59_000 }), null);
  const sealed = sealSecret(secret, 'clave-servidor');
  assert.notEqual(sealed.includes(secret), true);
  assert.equal(openSecret(sealed, 'clave-servidor'), secret);
  assert.throws(() => openSecret(sealed, 'otra-clave'));
});

test('verificación en dos pasos, sesiones, contraseña y registro de actividad', async () => {
  const email = 'seguro@example.com';
  const a = client(t.base);
  await a('/api/auth/registro', { method: 'POST', body: { name: 'Sole Segura', email, password: 'clave-segura-1234' } });
  let sec = await (await a('/api/seguridad')).json();
  assert.equal(sec.two_factor.enabled, false);
  assert.equal(sec.sessions.length, 1);
  assert.equal(sec.sessions[0].current, true);
  assert.equal(sec.events[0].type, 'signup');

  // Activar
  assert.equal((await a('/api/seguridad/dos-pasos/activar', { method: 'POST', body: { code: '123456' } })).status, 400, 'sin iniciar');
  const setup = await (await a('/api/seguridad/dos-pasos/iniciar', { method: 'POST' })).json();
  assert.match(setup.qr_svg, /^<svg/);
  assert.match(setup.otpauth_url, /^otpauth:\/\/totp\/DocSure%3Aseguro%40example\.com\?secret=/);
  const secret = setup.secret.replace(/ /g, '');
  const { rows: [stored] } = await t.pool.query('SELECT totp_pending FROM users WHERE email = $1', [email]);
  assert.ok(!stored.totp_pending.includes(secret), 'el secreto se guarda cifrado');
  assert.equal((await a('/api/seguridad/dos-pasos/activar', { method: 'POST', body: { code: '000000' } })).status, 400);
  const step = currentStep();
  const on = await (await a('/api/seguridad/dos-pasos/activar', { method: 'POST', body: { code: totpAt(secret, step) } })).json();
  assert.equal(on.recovery_codes.length, 10);
  assert.match(on.recovery_codes[0], /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  // Ingresar con dos pasos
  const login = async (c, password = 'clave-segura-1234') => (await c('/api/auth/ingresar', { method: 'POST', body: { email, password } })).json();
  const b = client(t.base);
  const first = await login(b);
  assert.equal(first.two_factor, true);
  assert.equal((await b('/api/me')).status, 401, 'la contraseña sola no abre sesión');
  const second = (c, ticket, code) => c('/api/auth/dos-pasos', { method: 'POST', body: { ticket, code } });
  assert.equal((await second(b, first.ticket, totpAt(secret, step))).status, 400, 'el código usado al activar no se reutiliza');
  assert.equal((await second(b, `${first.ticket}x`, totpAt(secret, step + 1))).status, 400, 'ticket alterado');
  assert.equal((await second(b, first.ticket, totpAt(secret, step + 1))).status, 200);
  assert.equal((await b('/api/me')).status, 200);
  const c = client(t.base);
  const t2 = await login(c);
  const viaRecovery = await (await second(c, t2.ticket, on.recovery_codes[0].toLowerCase())).json();
  assert.equal(viaRecovery.used_recovery_code, true);
  const d = client(t.base);
  assert.equal((await second(d, (await login(d)).ticket, on.recovery_codes[0])).status, 400, 'cada código de recuperación sirve una vez');
  assert.equal((await (await a('/api/seguridad')).json()).two_factor.recovery_left, 9);

  // Sesiones: a, b y c abiertas; a cierra la de b y después todas las demás
  sec = await (await a('/api/seguridad')).json();
  assert.equal(sec.sessions.length, 3);
  const others = sec.sessions.filter((s) => !s.current);
  assert.equal((await a(`/api/seguridad/sesiones/${others[0].id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await a('/api/seguridad/sesiones/zzzz', { method: 'DELETE' })).status, 404);
  const stillOpen = [(await b('/api/me')).status, (await c('/api/me')).status].sort();
  assert.deepEqual(stillOpen, [200, 401]);
  assert.equal((await (await a('/api/seguridad/sesiones/cerrar-otras', { method: 'POST' })).json()).closed, 1);
  assert.equal((await b('/api/me')).status, 401);
  assert.equal((await c('/api/me')).status, 401);
  assert.equal((await a('/api/me')).status, 200, 'la sesión actual sigue abierta');

  // Contraseña
  assert.equal((await a('/api/seguridad/contrasena', { method: 'POST', body: { current_password: 'mal', new_password: 'clave-nueva-12345' } })).status, 400);
  assert.equal((await a('/api/seguridad/contrasena', { method: 'POST', body: { current_password: 'clave-segura-1234', new_password: 'corta' } })).status, 400);
  assert.equal((await a('/api/seguridad/contrasena', { method: 'POST', body: { current_password: 'clave-segura-1234', new_password: 'clave-nueva-12345' } })).status, 200);
  assert.equal((await client(t.base)('/api/auth/ingresar', { method: 'POST', body: { email, password: 'clave-segura-1234' } })).status, 401, 'la contraseña vieja ya no sirve');

  // Desactivar (contraseña + código de recuperación)
  assert.equal((await a('/api/seguridad/dos-pasos/desactivar', { method: 'POST', body: { password: 'clave-segura-1234', code: on.recovery_codes[1] } })).status, 400);
  assert.equal((await a('/api/seguridad/dos-pasos/desactivar', { method: 'POST', body: { password: 'clave-nueva-12345', code: on.recovery_codes[1] } })).status, 200);
  const plain = await login(client(t.base), 'clave-nueva-12345');
  assert.equal(plain.ok, true, 'sin dos pasos vuelve a entrar con la contraseña');

  const types = (await (await a('/api/seguridad')).json()).events.map((e) => e.type);
  for (const ty of ['two_factor_enabled', 'login', 'login_recovery_code', 'two_factor_failed', 'session_revoked', 'sessions_revoked', 'password_change_failed', 'password_changed', 'login_failed', 'two_factor_disabled']) {
    assert.ok(types.includes(ty), `registro de actividad: ${ty}`);
  }
});
