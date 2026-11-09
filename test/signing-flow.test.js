import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { sealFingerprint, verifySeal } from '../src/pdf/verify.js';
import { completeEnvelope } from '../src/services/envelopes.js';
import { PNG, client, codeFrom, downloadFrom, linkFrom, outbox, samplePdf, startTestApp } from './helpers.js';

let t;
let owner;
let envelopeId;
let finalPdf;
const A = 'ana@example.com';
const B = 'bruno@example.com';
const C = 'copia@example.com';

before(async () => {
  t = await startTestApp();
  owner = client(t.base);
});
after(async () => t.stop());

async function json(res) {
  return { status: res.status, body: await res.json() };
}

async function verifiedSession(signer, token, email) {
  assert.equal((await signer(`/api/firmar/${token}/codigo`, { method: 'POST' })).status, 200);
  const [mail] = (await outbox(t.pool, 'otp', email)).slice(-1);
  const r = await json(await signer(`/api/firmar/${token}/verificar`, { method: 'POST', body: { code: codeFrom(mail) } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.session;
}

test('registro e inicio de sesión del remitente', async () => {
  const r = await json(await owner('/api/auth/registro', { method: 'POST', body: { name: 'Olga Remitente', email: 'olga@example.com', password: 'clave-super-segura' } }));
  assert.equal(r.status, 201);
  const me = await json(await owner('/api/me'));
  assert.equal(me.body.user.email, 'olga@example.com');
  const dup = await json(await client(t.base)('/api/auth/registro', { method: 'POST', body: { name: 'X', email: 'olga@example.com', password: 'otra-clave-larga' } }));
  assert.equal(dup.status, 409);
  const bad = await json(await client(t.base)('/api/auth/ingresar', { method: 'POST', body: { email: 'olga@example.com', password: 'incorrecta-123' } }));
  assert.equal(bad.status, 401);
});

test('las mutaciones sin encabezado anti-CSRF se rechazan', async () => {
  const res = await owner('/api/sobres', { method: 'POST', body: await samplePdf(), csrf: false });
  assert.equal(res.status, 403);
});

test('crear borrador, cargar destinatarios y campos', async () => {
  const created = await json(await owner('/api/sobres?title=Contrato%20de%20prueba', { method: 'POST', body: await samplePdf() }));
  assert.equal(created.status, 201);
  assert.equal(created.body.pageCount, 2);
  envelopeId = created.body.id;

  const notPdf = await json(await owner('/api/sobres?title=x', { method: 'POST', body: Buffer.from('hola') }));
  assert.equal(notPdf.status, 400);

  const save = await json(await owner(`/api/sobres/${envelopeId}`, {
    method: 'PUT',
    body: {
      title: 'Contrato de prueba',
      message: 'Por favor firmá',
      sequential: true,
      recipients: [
        { key: 'a', name: 'Ana Firmante', email: A, role: 'signer', order: 1 },
        { key: 'b', name: 'Bruno Firmante', email: B, role: 'signer', order: 2 },
        { key: 'c', name: 'Carla Copia', email: C, role: 'cc' },
      ],
      fields: [
        { recipientKey: 'a', type: 'signature', page: 1, x: 0.1, y: 0.7, w: 0.3, h: 0.06 },
        { recipientKey: 'a', type: 'date', page: 1, x: 0.5, y: 0.7, w: 0.2, h: 0.03 },
        { recipientKey: 'a', type: 'text', page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.03, required: true, label: 'DNI' },
        { recipientKey: 'a', type: 'checkbox', page: 1, x: 0.5, y: 0.8, w: 0.03, h: 0.02, required: true },
        { recipientKey: 'b', type: 'signature', page: 2, x: 0.1, y: 0.6, w: 0.3, h: 0.08 },
        { recipientKey: 'b', type: 'initials', page: 2, x: 0.6, y: 0.6, w: 0.1, h: 0.05 },
        { recipientKey: 'b', type: 'name', page: 2, x: 0.1, y: 0.75, w: 0.3, h: 0.04 },
      ],
    },
  }));
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const cc = await json(await owner(`/api/sobres/${envelopeId}`, { method: 'PUT', body: { title: 'x', recipients: [{ key: 'c', name: 'C', email: C, role: 'cc' }], fields: [{ recipientKey: 'c', type: 'signature', page: 1, x: 0, y: 0, w: 0.1, h: 0.1 }] } }));
  assert.equal(cc.status, 400, 'un destinatario en copia no puede tener campos');
});

test('idempotencia: un sobre = un envío', async () => {
  const first = await json(await owner(`/api/sobres/${envelopeId}/enviar`, { method: 'POST', headers: { 'idempotency-key': 'clave-1' } }));
  assert.equal(first.status, 200);
  assert.equal(first.body.replay, false);
  const replay = await json(await owner(`/api/sobres/${envelopeId}/enviar`, { method: 'POST', headers: { 'idempotency-key': 'clave-1' } }));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replay, true);
  const other = await json(await owner(`/api/sobres/${envelopeId}/enviar`, { method: 'POST', headers: { 'idempotency-key': 'clave-2' } }));
  assert.equal(other.status, 409);
  assert.equal((await outbox(t.pool, 'invite', A)).length, 1, 'Ana recibe exactamente una invitación');
  assert.equal((await outbox(t.pool, 'invite', B)).length, 0, 'Bruno espera su turno (firma en orden)');
  const edit = await owner(`/api/sobres/${envelopeId}`, { method: 'PUT', body: { title: 'x', recipients: [], fields: [] } });
  assert.equal(edit.status, 409, 'un sobre enviado ya no se edita');
});

test('verificación por código y enlace de un solo uso (Ana)', async () => {
  const signer = client(t.base);
  const token = linkFrom((await outbox(t.pool, 'invite', A))[0]);

  const open = await json(await signer(`/api/firmar/${token}`));
  assert.equal(open.status, 200);
  assert.equal(open.body.recipientName, 'Ana Firmante');
  assert.match(open.body.emailMasked, /^an\*+@example\.com$/);

  assert.equal((await signer(`/api/firmar/${token}/documento`)).status, 401, 'sin verificar no se ve el documento');
  assert.equal((await signer(`/api/firmar/${token}/codigo`, { method: 'POST' })).status, 200);
  assert.equal((await signer(`/api/firmar/${token}/codigo`, { method: 'POST' })).status, 429, 'no se puede pedir otro código enseguida');

  const code = codeFrom((await outbox(t.pool, 'otp', A))[0]);
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  const bad = await json(await signer(`/api/firmar/${token}/verificar`, { method: 'POST', body: { code: wrong } }));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'otp_invalid');

  const ok = await json(await signer(`/api/firmar/${token}/verificar`, { method: 'POST', body: { code } }));
  assert.equal(ok.status, 200);
  const session = ok.body.session;
  const reuse = await json(await signer(`/api/firmar/${token}/verificar`, { method: 'POST', body: { code } }));
  assert.equal(reuse.status, 400, 'el código es de un solo uso');

  const doc = await signer(`/api/firmar/${token}/documento`, { headers: { 'x-sign-session': session } });
  assert.equal(doc.status, 200);
  const fields = await json(await signer(`/api/firmar/${token}/campos`, { headers: { 'x-sign-session': session } }));
  assert.equal(fields.body.fields.length, 4);
  const text = fields.body.fields.find((f) => f.type === 'text');
  const box = fields.body.fields.find((f) => f.type === 'checkbox');

  const noConsent = await signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, values: {} } });
  assert.equal(noConsent.status, 400);
  const missing = await signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, values: { [box.id]: true }, consent: true } });
  assert.equal(missing.status, 400, 'falta el texto obligatorio');
  const badImg = await signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: 'data:image/png;base64,AAAA', values: { [box.id]: true, [text.id]: '30111222' }, consent: true } });
  assert.equal(badImg.status, 400, 'la firma debe ser un PNG real');
  const noSession = await signer(`/api/firmar/${token}/firmar`, { method: 'POST', body: { signature: PNG, values: { [box.id]: true, [text.id]: '30111222' }, consent: true } });
  assert.equal(noSession.status, 401);

  const signed = await signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, values: { [box.id]: true, [text.id]: '30111222' }, consent: true } });
  assert.equal(signed.status, 200);

  const again = await json(await signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, values: {}, consent: true } }));
  assert.equal(again.status, 410);
  assert.equal(again.body.code, 'link_used');
  assert.equal((await signer(`/api/firmar/${token}`)).status, 410, 'el enlace ya no abre');
  assert.equal((await outbox(t.pool, 'invite', B)).length, 1, 'al firmar Ana se invita a Bruno');
});

test('bloqueo tras 5 códigos incorrectos (Bruno) y firma final', async () => {
  const signer = client(t.base);
  const token = linkFrom((await outbox(t.pool, 'invite', B))[0]);
  assert.equal((await signer(`/api/firmar/${token}/codigo`, { method: 'POST' })).status, 200);
  const code = codeFrom((await outbox(t.pool, 'otp', B))[0]);
  const wrong = String((Number(code) + 7) % 1_000_000).padStart(6, '0');
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await signer(`/api/firmar/${token}/verificar`, { method: 'POST', body: { code: wrong } })).status, 400);
  }
  const locked = await json(await signer(`/api/firmar/${token}/verificar`, { method: 'POST', body: { code } }));
  assert.equal(locked.status, 429, 'ni el código correcto sirve tras 5 errores');
  assert.equal(locked.body.code, 'otp_locked');

  await t.pool.query(`UPDATE recipients SET otp_sent_at = now() - interval '1 minute' WHERE email = $1`, [B]);
  const session = await verifiedSession(signer, token, B);
  const res = await signer(`/api/firmar/${token}/firmar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { signature: PNG, initials: PNG, consent: true } });
  assert.equal(res.status, 200);
});

test('al completar: PDF final sellado, notificaciones únicas y descarga', async () => {
  const detail = await json(await owner(`/api/sobres/${envelopeId}`));
  assert.equal(detail.body.envelope.status, 'completed');
  const res = await owner(`/api/sobres/${envelopeId}/final.pdf`);
  assert.equal(res.status, 200);
  finalPdf = Buffer.from(await res.arrayBuffer());
  assert.equal(finalPdf.subarray(0, 5).toString(), '%PDF-');

  for (const email of [A, B, C, 'olga@example.com']) {
    assert.equal((await outbox(t.pool, 'completed', email)).length, 1, `una notificación para ${email}`);
  }
  await completeEnvelope(t.ctx, envelopeId);
  assert.equal((await outbox(t.pool, 'completed', A)).length, 1, 'completar de nuevo no duplica envíos');

  const dl = downloadFrom((await outbox(t.pool, 'completed', C))[0]);
  const page = await client(t.base)(`/documento/${dl}`);
  assert.equal(page.status, 200);
  const pdf = await client(t.base)(`/documento/${dl}/pdf`);
  assert.equal(Buffer.compare(Buffer.from(await pdf.arrayBuffer()), finalPdf), 0);
  assert.equal((await client(t.base)('/documento/token-que-no-existe-123456789/pdf')).status, 404);
});

test('integridad del sello digital', async () => {
  const fp = sealFingerprint(t.config.sealP12, t.config.sealPassword);
  const ok = verifySeal(finalPdf, fp);
  assert.equal(ok.signed, true);
  assert.equal(ok.intact, true);
  assert.equal(ok.issuedByDocSure, true);

  const tampered = Buffer.from(finalPdf);
  const i = Math.floor(tampered.length / 3);
  tampered[i] = tampered[i] === 0x41 ? 0x42 : 0x41;
  assert.equal(verifySeal(tampered, fp).intact, false, 'un byte cambiado invalida el sello');

  const appended = Buffer.concat([finalPdf, Buffer.from('\n%%agregado')]);
  assert.equal(verifySeal(appended, fp).intact, false, 'contenido agregado después invalida el sello');

  const pub = await (await client(t.base)('/api/verificar', { method: 'POST', body: finalPdf })).json();
  assert.equal(pub.seal.intact, true);
  assert.equal(pub.record.id, envelopeId);
  assert.equal(pub.record.signers.length, 2);
  const pubBad = await (await client(t.base)('/api/verificar', { method: 'POST', body: tampered })).json();
  assert.equal(pubBad.seal.intact, false);
  assert.equal(pubBad.record, null);
});

test('rechazo con motivo cierra el sobre y avisa al remitente', async () => {
  const created = await json(await owner('/api/sobres?title=Para%20rechazar', { method: 'POST', body: await samplePdf() }));
  const id = created.body.id;
  await owner(`/api/sobres/${id}`, {
    method: 'PUT',
    body: { title: 'Para rechazar', recipients: [{ key: 'd', name: 'Diego', email: 'diego@example.com' }], fields: [{ recipientKey: 'd', type: 'signature', page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.06 }] },
  });
  assert.equal((await owner(`/api/sobres/${id}/enviar`, { method: 'POST', headers: { 'idempotency-key': 'r1' } })).status, 200);
  const signer = client(t.base);
  const token = linkFrom((await outbox(t.pool, 'invite', 'diego@example.com'))[0]);
  const session = await verifiedSession(signer, token, 'diego@example.com');
  const res = await signer(`/api/firmar/${token}/rechazar`, { method: 'POST', headers: { 'x-sign-session': session }, body: { reason: 'El monto no es correcto' } });
  assert.equal(res.status, 200);
  const detail = await json(await owner(`/api/sobres/${id}`));
  assert.equal(detail.body.envelope.status, 'declined');
  assert.equal((await t.pool.query(`SELECT count(*)::int AS n FROM emails WHERE kind = 'declined' AND envelope_id = $1`, [id])).rows[0].n, 1);
  assert.equal((await signer(`/api/firmar/${token}`)).status, 410);
});

test('anular un sobre invalida los enlaces y reenviar reemplaza el anterior', async () => {
  const created = await json(await owner('/api/sobres?title=Para%20anular', { method: 'POST', body: await samplePdf() }));
  const id = created.body.id;
  await owner(`/api/sobres/${id}`, {
    method: 'PUT',
    body: { title: 'Para anular', recipients: [{ key: 'e', name: 'Eva', email: 'eva@example.com' }], fields: [{ recipientKey: 'e', type: 'signature', page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.06 }] },
  });
  await owner(`/api/sobres/${id}/enviar`, { method: 'POST', headers: { 'idempotency-key': 'v1' } });
  const first = linkFrom((await outbox(t.pool, 'invite', 'eva@example.com'))[0]);
  const { rows: [rec] } = await t.pool.query('SELECT id FROM recipients WHERE envelope_id = $1', [id]);
  await t.pool.query(`UPDATE events SET created_at = now() - interval '2 minutes' WHERE recipient_id = $1`, [rec.id]);
  assert.equal((await owner(`/api/sobres/${id}/destinatarios/${rec.id}/reenviar`, { method: 'POST' })).status, 200);
  assert.equal((await client(t.base)(`/api/firmar/${first}`)).status, 404, 'el enlace viejo deja de funcionar');
  const second = linkFrom((await outbox(t.pool, 'invite', 'eva@example.com')).at(-1));
  assert.equal((await client(t.base)(`/api/firmar/${second}`)).status, 200);
  assert.equal((await owner(`/api/sobres/${id}/anular`, { method: 'POST' })).status, 200);
  assert.equal((await client(t.base)(`/api/firmar/${second}`)).status, 404);
});
