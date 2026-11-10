import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { evaluateFormula, parseNumber } from '../public/formula.js';
import { sealFingerprint, verifySeal } from '../src/pdf/verify.js';
import { PNG, client, codeFrom, linkFrom, outbox, samplePdf, startTestApp } from './helpers.js';

let t;
let owner;
before(async () => {
  t = await startTestApp();
  owner = client(t.base);
  await owner('/api/auth/registro', { method: 'POST', body: { name: 'Seis', email: 'seis@example.com', password: 'clave-v06-larga', plan: 'empresa' } });
});
after(async () => t.stop());

const F = (o) => ({ recipientKey: 's', page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.03, ...o });

async function draft(fields, email = 'f6@example.com') {
  const { id } = await (await owner('/api/sobres?title=v06', { method: 'POST', body: await samplePdf() })).json();
  const res = await owner(`/api/sobres/${id}`, { method: 'PUT', body: { title: 'v06', recipients: [{ key: 's', name: 'Firma Seis', email }], fields } });
  return { id, res };
}

async function openSign(email) {
  const signer = client(t.base);
  const token = linkFrom((await outbox(t.pool, 'invite', email)).at(-1));
  await signer(`/api/firmar/${token}/codigo`, { method: 'POST' });
  const code = codeFrom((await outbox(t.pool, 'otp', email)).at(-1));
  const { session } = await (await signer(`/api/firmar/${token}/verificar`, { method: 'POST', body: { code } })).json();
  const { fields } = await (await signer(`/api/firmar/${token}/campos`, { headers: { 'x-sign-session': session } })).json();
  const by = Object.fromEntries(fields.filter((f) => f.label).map((f) => [f.label, f.id]));
  const sign = (values) => signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, consent: true, values } });
  const upload = (fieldId, body) => fetch(`${t.base}/api/firmar/${token}/adjuntos/${fieldId}`, { method: 'PUT', headers: { 'x-docsure': '1', 'x-sign-session': session, 'x-file-name': 'foto.png' }, body });
  return { by, sign, upload };
}

test('fórmulas: cálculo seguro, números con coma y errores claros', () => {
  const v = { precio: parseNumber('1.500,50'), cantidad: 3 };
  assert.equal(evaluateFormula('{Precio} * {Cantidad}', (n) => v[n]), 4501.5);
  assert.equal(evaluateFormula('({precio} - 500,5) / 2', (n) => v[n]), 500);
  assert.equal(evaluateFormula('1/0', () => 0), null);
  for (const bad of ['1 +', '(1', 'alert(1)', '{x', '2 2']) assert.throws(() => evaluateFormula(bad, () => 0), bad);
});

test('campos nuevos: validaciones del editor', async () => {
  const sig = F({ key: 'sig', type: 'signature', h: 0.06 });
  const bad = async (fields, msg) => assert.equal((await draft([sig, ...fields])).res.status, 400, msg);
  await bad([F({ type: 'radio', options: [] })], 'opción única sin opciones');
  await bad([F({ type: 'multiple' })], 'múltiple sin opciones');
  await bad([F({ type: 'number', label: 'Total', formula: '{Nada} * 2' })], 'referencia inexistente');
  await bad([F({ type: 'number', label: 'Total', formula: '{Precio} *' })], 'sintaxis');
  await bad([F({ key: 'a', type: 'number', label: 'A', formula: '{B} + 1' }), F({ key: 'b', type: 'number', label: 'B', formula: '{A} + 1' })], 'ciclo');
});

test('campos nuevos: opción única, múltiple, número con fórmula, teléfono, imagen y sello', async () => {
  const fields = [
    F({ key: 'sig', type: 'signature', h: 0.06 }),
    F({ key: 'r', type: 'radio', label: 'Plan', options: ['Mensual', 'Anual'], y: 0.2 }),
    F({ type: 'multiple', label: 'Extras', options: ['Soporte', 'Capacitación', 'API'], y: 0.25, required: false }),
    F({ type: 'number', label: 'Precio', y: 0.3 }),
    F({ type: 'number', label: 'Cantidad', y: 0.35 }),
    F({ type: 'number', label: 'Total', formula: '{Precio} * {Cantidad}', y: 0.4 }),
    F({ type: 'phone', label: 'Tel', y: 0.45 }),
    F({ type: 'image', label: 'Logo', y: 0.5, h: 0.08 }),
    F({ type: 'stamp', label: 'Sello', y: 0.62, h: 0.08 }),
    F({ type: 'text', label: 'Motivo', y: 0.75, showIf: { key: 'r', equals: 'Anual' } }),
  ];
  const { id, res } = await draft(fields, 'nuevos@example.com');
  assert.equal(res.status, 200, await res.clone().text());
  const detail = await (await owner(`/api/sobres/${id}`)).json();
  const total = detail.fields.find((f) => f.label === 'Total');
  assert.equal(total.formula, '{Precio} * {Cantidad}');
  assert.equal(total.required, false, 'un campo calculado no se pide al firmante');
  assert.equal((await owner(`/api/sobres/${id}/enviar`, { method: 'POST', headers: { 'idempotency-key': `n-${id}` } })).status, 200);

  const s = await openSign('nuevos@example.com');
  const base = { [s.by.Plan]: 'Mensual', [s.by.Precio]: '1.500,50', [s.by.Cantidad]: '3', [s.by.Tel]: '+54 11 5555-1234', [s.by.Sello]: 'Acme SA', [s.by.Total]: '999999' };
  assert.equal((await s.sign({ ...base, [s.by.Plan]: 'Semanal' })).status, 400, 'opción inexistente');
  assert.equal((await s.sign({ ...base, [s.by.Extras]: ['Soporte', 'Otro'] })).status, 400, 'múltiple con opción inexistente');
  assert.equal((await s.sign({ ...base, [s.by.Precio]: 'mil' })).status, 400, 'número inválido');
  assert.equal((await s.sign({ ...base, [s.by.Tel]: 'abc' })).status, 400, 'teléfono inválido');
  assert.equal((await s.sign(base)).status, 400, 'falta la imagen');
  assert.equal((await s.upload(s.by.Logo, await samplePdf())).status, 415, 'el campo imagen no acepta PDF');
  assert.equal((await s.upload(s.by.Logo, Buffer.from(PNG.split(',')[1], 'base64'))).status, 200);
  const ok = await s.sign({ ...base, [s.by.Extras]: ['API', 'Soporte'] });
  assert.equal(ok.status, 200, await ok.clone().text());

  const { rows } = await t.pool.query('SELECT label, value FROM fields WHERE envelope_id = $1', [id]);
  const v = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  assert.equal(v.Total, '4501,5', 'el total lo calcula el servidor, no el navegador');
  assert.equal(v.Plan, 'Mensual');
  assert.deepEqual(JSON.parse(v.Extras), ['Soporte', 'API'], 'en el orden de las opciones');
  assert.equal(JSON.parse(v.Sello).company, 'Acme SA');
  assert.equal(v.Motivo, null, 'condición por opción única');
  const { rows: [env] } = await t.pool.query('SELECT status, final_pdf FROM envelopes WHERE id = $1', [id]);
  assert.equal(env.status, 'completed');
  const final = await PDFDocument.load(env.final_pdf);
  assert.ok(final.getPageCount() >= 3, 'la imagen va dentro del campo, no como anexo extra');
  assert.equal(verifySeal(env.final_pdf, sealFingerprint(t.config.sealP12, t.config.sealPassword)).intact, true);
});

test('documentos de imagen y detección de campos de formularios PDF', async () => {
  const png = Buffer.from(PNG.split(',')[1], 'base64');
  const img = await owner('/api/sobres?title=Foto&name=foto.png', { method: 'POST', body: png, headers: { 'content-type': 'image/png' } });
  assert.equal(img.status, 201, await img.clone().text());
  const created = await img.json();
  assert.equal(created.pageCount, 1);
  assert.equal(created.documents[0].name, 'foto');
  const orig = Buffer.from(await (await owner(`/api/sobres/${created.id}/original.pdf`)).arrayBuffer());
  assert.equal(orig.subarray(0, 5).toString(), '%PDF-', 'la foto se convierte en PDF');
  assert.equal((await owner('/api/sobres?title=x', { method: 'POST', body: Buffer.from('GIF89a....'), headers: { 'content-type': 'image/png' } })).status, 400);

  // Formulario PDF con campos
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  form.createTextField('Nombre completo').addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  form.createCheckBox('Acepto').addToPage(page, { x: 50, y: 650, width: 15, height: 15 });
  const dd = form.createDropdown('Provincia');
  dd.addOptions(['Buenos Aires', 'Córdoba']);
  dd.addToPage(page, { x: 50, y: 600, width: 150, height: 20 });
  const rg = form.createRadioGroup('Plan');
  rg.addOptionToPage('Mensual', page, { x: 50, y: 550, width: 15, height: 15 });
  rg.addOptionToPage('Anual', page, { x: 100, y: 550, width: 15, height: 15 });
  const formPdf = Buffer.from(await doc.save());
  const { id } = await (await owner('/api/sobres?title=Formulario', { method: 'POST', body: formPdf })).json();
  const { fields } = await (await owner(`/api/sobres/${id}/campos-pdf`)).json();
  assert.deepEqual(fields.map((f) => f.type).sort(), ['checkbox', 'radio', 'select', 'text']);
  const text = fields.find((f) => f.type === 'text');
  assert.equal(text.label, 'Nombre completo');
  assert.ok(Math.abs(text.x - 50 / 600) < 0.001 && Math.abs(text.y - (1 - 720 / 800)) < 0.001, 'posición convertida');
  assert.deepEqual(fields.find((f) => f.type === 'radio').options, ['Mensual', 'Anual']);

  // Se usan, se firma y el formulario original queda aplanado
  const mapped = [F({ key: 'sig', type: 'signature', y: 0.3, h: 0.06 }), ...fields.map((f) => ({ ...f, recipientKey: 's', required: false }))];
  assert.equal((await owner(`/api/sobres/${id}`, { method: 'PUT', body: { title: 'Formulario', recipients: [{ key: 's', name: 'Form Firma', email: 'form@example.com' }], fields: mapped } })).status, 200);
  assert.equal((await owner(`/api/sobres/${id}/enviar`, { method: 'POST', headers: { 'idempotency-key': `f-${id}` } })).status, 200);
  const s = await openSign('form@example.com');
  assert.equal((await s.sign({ [s.by['Nombre completo']]: 'Ana Pérez', [s.by.Provincia]: 'Córdoba' })).status, 200);
  const { rows: [env] } = await t.pool.query('SELECT status, final_pdf FROM envelopes WHERE id = $1', [id]);
  assert.equal(env.status, 'completed');
  const final = await PDFDocument.load(env.final_pdf);
  assert.equal(final.getForm().getFields().length, 0, 'el formulario original queda aplanado');
});
