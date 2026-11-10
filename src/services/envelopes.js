import crypto from 'node:crypto';
import { withTransaction } from '../db.js';
import { formatLongDate, langOf, templates } from '../mail.js';
import { buildFinalPdf, inspectPdf } from '../pdf/final.js';
import { planOf } from '../plans.js';
import { hmac, maskEmail, newOtp, randomToken, safeEqualHex, sha256Hex } from '../security.js';
import { HttpError, cleanEmail, cleanNumber, cleanPngDataUrl, cleanText } from '../validate.js';
import { rememberRecipients } from './contacts.js';
import { emitEnvelopeEvent } from './webhooks.js';

/** Notifica a los webhooks en segundo plano; nunca bloquea ni rompe el flujo principal. */
function emit(ctx, envelopeId, type, extra) {
  emitEnvelopeEvent(ctx, envelopeId, type, extra)
    .then((deliveries) => Promise.allSettled(deliveries))
    .catch((err) => console.error('Webhook no emitido:', err.message));
}

const ACCESS_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';
const REMINDER_OPTIONS = [0, 1, 2, 3, 5, 7];
const MAX_REMINDERS = 5;
const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 30;
const SIGN_SESSION_MINUTES = 30;
const FIELD_TYPES = new Set(['signature', 'initials', 'date', 'name', 'email', 'text', 'checkbox']);
const AUTO_FIELDS = new Set(['date', 'name', 'email']);

async function addEvent(db, envelopeId, type, { recipientId = null, ip = null, userAgent = null, data = {} } = {}) {
  await db.query(
    'INSERT INTO events (envelope_id, recipient_id, type, ip, user_agent, data) VALUES ($1, $2, $3, $4, $5, $6)',
    [envelopeId, recipientId, type, ip, userAgent ? userAgent.slice(0, 300) : null, data],
  );
}

/** Fecha corta dd/mm/aaaa (UTC), la misma que se estampa en el PDF. */
function shortDate(d) {
  return new Date(d).toISOString().slice(0, 10).split('-').reverse().join('/');
}

/** Código de acceso de 12 caracteres (~58 bits) para entrar sin tocar enlaces: XXXX-XXXX-XXXX. */
function newAccessCode() {
  let out = '';
  for (let i = 0; i < 12; i += 1) out += ACCESS_ALPHABET[crypto.randomInt(ACCESS_ALPHABET.length)];
  return out;
}

const formatCode = (c) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;

/** Datos del sobre y de la marca del remitente para los emails. */
const ENV_MAIL_SQL = `SELECT e.id, e.title, e.message, e.status, e.sequential, e.expires_at, e.language, e.owner_id,
       u.name AS owner_name, u.company AS owner_company, u.brand_color, (u.brand_logo IS NOT NULL) AS has_logo
  FROM envelopes e JOIN users u ON u.id = e.owner_id WHERE e.id = $1`;

export function brandOf(ctx, row) {
  return {
    name: row.owner_company || 'DocSure',
    color: row.brand_color || '#0e7c66',
    logoUrl: row.has_logo ? `${ctx.config.appUrl}/marca/${row.owner_id}` : null,
  };
}

/** Genera enlace y código de acceso nuevos (invalida los anteriores) y los devuelve en claro una sola vez. */
async function issueCredentials(ctx, db, recipientId, expiresAt, extraSet = '') {
  const token = randomToken();
  const code = newAccessCode();
  await db.query(
    `UPDATE recipients SET token_hash = $2, access_code_hash = $3, token_expires_at = $4, last_notified_at = now()${extraSet}
      WHERE id = $1`,
    [recipientId, hmac(ctx.config.tokenSecret, `link:${token}`), hmac(ctx.config.tokenSecret, `access:${code}`), expiresAt],
  );
  return { token, code };
}

// ---------- Remitente ----------

export async function createDraft(ctx, ownerId, { title, pdf }) {
  const cleanTitle = cleanText(title, { max: 160, field: 'el nombre del documento' });
  if (pdf.length > 15 * 1024 * 1024) throw new HttpError(413, 'El PDF supera 15 MB.', 'too_large');
  const { pageCount } = await inspectPdf(pdf);
  const { rows } = await ctx.pool.query(
    `INSERT INTO envelopes (owner_id, title, original_pdf, original_sha256, page_count)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [ownerId, cleanTitle, pdf, sha256Hex(pdf), pageCount],
  );
  await addEvent(ctx.pool, rows[0].id, 'created');
  return { id: rows[0].id, pageCount };
}

async function ownedEnvelope(db, ownerId, id, { lock = false } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Sobre no encontrado.', 'not_found');
  const { rows } = await db.query(
    `SELECT id, owner_id, title, message, status, sequential, page_count, original_sha256, final_sha256,
            send_idempotency_key, expires_at, sent_at, completed_at, created_at, language, expire_days,
            reminder_days, corrected_from, template_id
       FROM envelopes WHERE id = $1 AND owner_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [id, ownerId],
  );
  if (!rows[0]) throw new HttpError(404, 'Sobre no encontrado.', 'not_found');
  return rows[0];
}

export async function saveDraft(ctx, ownerId, id, body) {
  const title = cleanText(body.title, { max: 160, field: 'el nombre del documento' });
  const message = cleanText(body.message ?? '', { max: 1000, field: 'el mensaje', required: false });
  const sequential = body.sequential === true;
  const language = langOf(body.language);
  const expireDays = body.expire_days === undefined || body.expire_days === null ? 30 : cleanNumber(body.expire_days, { min: 1, max: 120, field: 'El vencimiento' });
  const reminderDays = body.reminder_days === undefined || body.reminder_days === null ? 0 : Number(body.reminder_days);
  if (!REMINDER_OPTIONS.includes(reminderDays)) throw new HttpError(400, 'Frecuencia de recordatorio inválida (0, 1, 2, 3, 5 o 7 días).', 'validation');
  const recipientsIn = Array.isArray(body.recipients) ? body.recipients : [];
  const fieldsIn = Array.isArray(body.fields) ? body.fields : [];
  if (recipientsIn.length > 50) throw new HttpError(400, 'Máximo 50 destinatarios.', 'validation');
  if (fieldsIn.length > 500) throw new HttpError(400, 'Máximo 500 campos.', 'validation');

  return withTransaction(ctx.pool, async (db) => {
    const env = await ownedEnvelope(db, ownerId, id, { lock: true });
    if (env.status !== 'draft') throw new HttpError(409, 'Solo se pueden editar borradores.', 'not_draft');

    const keys = new Set();
    const emails = new Set();
    const recipients = recipientsIn.map((r, i) => {
      const key = cleanText(r.key, { max: 40, field: 'la clave del destinatario' });
      if (keys.has(key)) throw new HttpError(400, 'Destinatario duplicado.', 'validation');
      keys.add(key);
      const email = cleanEmail(r.email, `el email del destinatario ${i + 1}`);
      if (emails.has(email)) throw new HttpError(400, `El email ${email} está repetido.`, 'validation');
      emails.add(email);
      return {
        key,
        name: cleanText(r.name, { max: 120, field: `el nombre del destinatario ${i + 1}` }),
        email,
        role: r.role === 'cc' ? 'cc' : 'signer',
        order: sequential ? cleanNumber(r.order ?? i + 1, { min: 1, max: 50, field: 'El orden' }) : 1,
      };
    });

    const fields = fieldsIn.map((f) => {
      if (!FIELD_TYPES.has(f.type)) throw new HttpError(400, 'Tipo de campo inválido.', 'validation');
      const recipient = recipients.find((r) => r.key === f.recipientKey);
      if (!recipient || recipient.role !== 'signer') throw new HttpError(400, 'Cada campo debe pertenecer a un firmante.', 'validation');
      const x = cleanNumber(f.x, { min: 0, max: 1, field: 'La posición' });
      const y = cleanNumber(f.y, { min: 0, max: 1, field: 'La posición' });
      const w = cleanNumber(f.w, { min: 0.01, max: 1, field: 'El ancho' });
      const h = cleanNumber(f.h, { min: 0.005, max: 1, field: 'El alto' });
      return {
        recipientKey: recipient.key,
        type: f.type,
        page: cleanNumber(f.page, { min: 1, max: env.page_count, field: 'La página' }),
        x: Math.min(x, 1 - w),
        y: Math.min(y, 1 - h),
        w,
        h,
        required: f.type === 'checkbox' ? f.required === true : f.required !== false,
        label: cleanText(f.label ?? '', { max: 60, field: 'la etiqueta', required: false }),
      };
    });

    await db.query('DELETE FROM recipients WHERE envelope_id = $1', [id]);
    const idByKey = new Map();
    for (const [i, r] of recipients.entries()) {
      const { rows } = await db.query(
        `INSERT INTO recipients (envelope_id, position, name, email, role, routing_order)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [id, i, r.name, r.email, r.role, r.order],
      );
      idByKey.set(r.key, rows[0].id);
    }
    for (const f of fields) {
      await db.query(
        `INSERT INTO fields (envelope_id, recipient_id, type, page, x, y, w, h, required, label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, idByKey.get(f.recipientKey), f.type, f.page, f.x, f.y, f.w, f.h, f.required, f.label],
      );
    }
    await db.query(
      `UPDATE envelopes SET title = $2, message = $3, sequential = $4, language = $5, expire_days = $6, reminder_days = $7, updated_at = now()
        WHERE id = $1`,
      [id, title, message, sequential, language, Math.round(expireDays), reminderDays],
    );
    return { ok: true };
  });
}

export async function monthlyUsage(db, ownerId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM envelopes
      WHERE owner_id = $1 AND status <> 'voided'
        AND sent_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [ownerId],
  );
  return rows[0].n;
}

export async function sendEnvelope(ctx, owner, id, idempotencyKey, meta) {
  const key = cleanText(idempotencyKey, { max: 100, field: 'la clave de idempotencia' });
  const outcome = await withTransaction(ctx.pool, async (db) => {
    const env = await ownedEnvelope(db, owner.id, id, { lock: true });
    if (env.status !== 'draft') {
      if (env.send_idempotency_key === key) return { replay: true };
      throw new HttpError(409, 'Este sobre ya fue enviado.', 'already_sent');
    }
    const { rows: recips } = await db.query(
      `SELECT r.id, r.role, (SELECT count(*)::int FROM fields f WHERE f.recipient_id = r.id) AS nfields,
              (SELECT count(*)::int FROM fields f WHERE f.recipient_id = r.id AND f.type = 'signature') AS nsig
         FROM recipients r WHERE r.envelope_id = $1`,
      [id],
    );
    const signers = recips.filter((r) => r.role === 'signer');
    if (signers.length === 0) throw new HttpError(400, 'Agregá al menos un firmante.', 'validation');
    if (signers.some((s) => s.nsig === 0)) throw new HttpError(400, 'Cada firmante necesita al menos un campo de firma.', 'validation');

    const limit = planOf(owner.plan).monthlyEnvelopes;
    if (limit !== null && (await monthlyUsage(db, owner.id)) >= limit) {
      throw new HttpError(402, `Llegaste al límite de ${limit} sobres de este mes en tu plan. Pasá a un plan superior para seguir enviando.`, 'quota');
    }
    await db.query(
      `UPDATE envelopes SET status = 'sent', sent_at = now(), expires_at = now() + make_interval(days => expire_days),
              send_idempotency_key = $2, updated_at = now() WHERE id = $1`,
      [id, key],
    );
    await addEvent(db, id, 'sent', meta);
    await rememberRecipients(db, owner.id, id);
    return { replay: false };
  });
  if (!outcome.replay) {
    await dispatchStage(ctx, id);
    emit(ctx, id, 'envelope.sent');
  }
  return { ok: true, replay: outcome.replay };
}

/** Envía la invitación a los firmantes de la etapa actual. Cada firmante se invita una sola vez. */
export async function dispatchStage(ctx, envelopeId) {
  const { rows: [env] } = await ctx.pool.query(ENV_MAIL_SQL, [envelopeId]);
  if (!env || env.status !== 'sent') return;
  const { rows: signers } = await ctx.pool.query(
    `SELECT id, name, email, status, routing_order FROM recipients
      WHERE envelope_id = $1 AND role = 'signer' ORDER BY routing_order, position`,
    [envelopeId],
  );
  const pending = signers.filter((s) => s.status !== 'signed');
  if (pending.length === 0) return;
  const stage = env.sequential ? pending.filter((s) => s.routing_order === pending[0].routing_order) : pending;
  for (const s of stage) {
    const { rowCount } = await ctx.pool.query(`UPDATE recipients SET status = 'sent' WHERE id = $1 AND status = 'created'`, [s.id]);
    if (rowCount === 0) continue;
    const creds = await issueCredentials(ctx, ctx.pool, s.id, env.expires_at);
    await inviteRecipient(ctx, env, s, creds, `invite:${s.id}`);
  }
}

async function inviteRecipient(ctx, env, recipient, { token, code }, dedupeKey, { reminder = false } = {}) {
  const mail = templates.signRequest({
    lang: env.language,
    brand: brandOf(ctx, env),
    senderName: env.owner_name,
    recipientName: recipient.name,
    title: env.title,
    message: env.message,
    url: `${ctx.config.appUrl}/firmar/${token}`,
    accessCode: formatCode(code),
    accessUrl: `${ctx.config.appUrl.replace(/^https?:\/\//, '')}/acceder`,
    expiresAt: formatLongDate(env.expires_at, env.language),
    reminder,
  });
  await ctx.mailer.send({ ...mail, to: recipient.email, kind: reminder ? 'reminder' : 'invite', envelopeId: env.id, dedupeKey });
  await addEvent(ctx.pool, env.id, reminder ? 'reminder_sent' : 'email_sent', { recipientId: recipient.id });
}

export async function resendInvite(ctx, ownerId, envelopeId, recipientId) {
  const env = await ownedEnvelope(ctx.pool, ownerId, envelopeId);
  if (env.status !== 'sent') throw new HttpError(409, 'Solo se puede reenviar un sobre en curso.', 'not_sent');
  const { rows: [r] } = await ctx.pool.query(
    `SELECT r.id, r.name, r.email, r.status,
            (SELECT max(created_at) FROM events ev WHERE ev.recipient_id = r.id AND ev.type IN ('email_sent', 'resent')) AS last_sent
       FROM recipients r WHERE r.id = $1 AND r.envelope_id = $2 AND r.role = 'signer'`,
    [recipientId, envelopeId],
  );
  if (!r) throw new HttpError(404, 'Destinatario no encontrado.', 'not_found');
  if (!['sent', 'viewed'].includes(r.status)) throw new HttpError(409, 'Este destinatario no tiene una firma pendiente.', 'not_pending');
  if (r.last_sent && Date.now() - new Date(r.last_sent).getTime() < 60_000) {
    throw new HttpError(429, 'Esperá un minuto antes de reenviar.', 'rate_limited');
  }
  const creds = await issueCredentials(ctx, ctx.pool, r.id, env.expires_at, ', otp_hash = NULL, sign_session_hash = NULL, in_person_by = NULL');
  const { rows: [full] } = await ctx.pool.query(ENV_MAIL_SQL, [envelopeId]);
  await addEvent(ctx.pool, envelopeId, 'resent', { recipientId: r.id });
  await inviteRecipient(ctx, full, r, creds, `resend:${r.id}:${randomToken(8)}`);
  return { ok: true };
}

export async function voidEnvelope(ctx, ownerId, id, meta) {
  await withTransaction(ctx.pool, async (db) => {
    const env = await ownedEnvelope(db, ownerId, id, { lock: true });
    if (env.status !== 'sent') throw new HttpError(409, 'Solo se puede anular un sobre en curso.', 'not_sent');
    await db.query(`UPDATE envelopes SET status = 'voided', updated_at = now() WHERE id = $1`, [id]);
    await db.query('UPDATE recipients SET token_hash = NULL, access_code_hash = NULL, sign_session_hash = NULL WHERE envelope_id = $1', [id]);
    await addEvent(db, id, 'voided', meta);
  });
  emit(ctx, id, 'envelope.voided');
  return { ok: true };
}

export async function deleteDraft(ctx, ownerId, id) {
  const { rowCount } = await ctx.pool.query(`DELETE FROM envelopes WHERE id = $1 AND owner_id = $2 AND status = 'draft'`, [id, ownerId]);
  if (rowCount === 0) throw new HttpError(409, 'Solo se pueden borrar borradores.', 'not_draft');
  return { ok: true };
}

export async function listEnvelopes(ctx, ownerId) {
  const { rows } = await ctx.pool.query(
    `SELECT e.id, e.title, e.status, e.created_at, e.sent_at, e.completed_at,
            count(r.id) FILTER (WHERE r.role = 'signer')::int AS signers,
            count(r.id) FILTER (WHERE r.role = 'signer' AND r.status = 'signed')::int AS signed
       FROM envelopes e LEFT JOIN recipients r ON r.envelope_id = e.id
      WHERE e.owner_id = $1 GROUP BY e.id ORDER BY e.created_at DESC LIMIT 500`,
    [ownerId],
  );
  return rows;
}

export async function envelopeDetail(ctx, ownerId, id) {
  const env = await ownedEnvelope(ctx.pool, ownerId, id);
  const { rows: recipients } = await ctx.pool.query(
    `SELECT id, name, email, role, routing_order, status, signed_at, declined_at, decline_reason, position
       FROM recipients WHERE envelope_id = $1 ORDER BY position`,
    [id],
  );
  const { rows: fields } = await ctx.pool.query(
    `SELECT f.id, r.position AS recipient_index, f.type, f.page, f.x, f.y, f.w, f.h, f.required, f.label
       FROM fields f JOIN recipients r ON r.id = f.recipient_id WHERE f.envelope_id = $1`,
    [id],
  );
  const { rows: events } = await ctx.pool.query(
    'SELECT type, recipient_id, ip, created_at FROM events WHERE envelope_id = $1 ORDER BY id',
    [id],
  );
  const { send_idempotency_key: _k, owner_id: _o, ...publicEnv } = env;
  return { envelope: publicEnv, recipients, fields, events };
}

export async function ownerPdf(ctx, ownerId, id, which) {
  await ownedEnvelope(ctx.pool, ownerId, id);
  const { rows } = await ctx.pool.query(
    `SELECT title, ${which === 'final' ? 'final_pdf' : 'original_pdf'} AS pdf FROM envelopes WHERE id = $1`,
    [id],
  );
  if (!rows[0]?.pdf) throw new HttpError(404, 'El documento final todavía no existe.', 'not_found');
  return rows[0];
}

// ---------- Firmante ----------

export async function resolveToken(ctx, token, { forUpdate = false, db = ctx.pool } = {}) {
  const code = typeof token === 'string' ? token.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  const isCode = typeof token === 'string' && token.length <= 20 && code.length === 12;
  if (!isCode && (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token))) {
    throw new HttpError(404, 'El enlace no es válido.', 'invalid_link');
  }
  const { rows: [r] } = await db.query(
    `SELECT r.*, e.title, e.status AS envelope_status, e.page_count, e.language, e.owner_id,
            u.name AS owner_name, u.company AS owner_company, u.brand_color, (u.brand_logo IS NOT NULL) AS has_logo
       FROM recipients r JOIN envelopes e ON e.id = r.envelope_id JOIN users u ON u.id = e.owner_id
      WHERE ${isCode ? 'r.access_code_hash' : 'r.token_hash'} = $1 ${forUpdate ? 'FOR UPDATE OF r' : ''}`,
    [hmac(ctx.config.tokenSecret, isCode ? `access:${code}` : `link:${token}`)],
  );
  if (!r) throw new HttpError(404, 'El enlace no es válido o fue reemplazado por uno nuevo.', 'invalid_link');
  if (r.token_used_at || r.status === 'signed') throw new HttpError(410, 'Este enlace ya fue utilizado. Si necesitás el documento, revisá el email de finalización.', 'link_used');
  if (r.status === 'declined') throw new HttpError(410, 'Rechazaste firmar este documento.', 'link_used');
  if (r.envelope_status === 'voided') throw new HttpError(410, 'El remitente anuló este sobre.', 'voided');
  if (r.envelope_status === 'expired') throw new HttpError(410, 'El sobre venció. Pedile al remitente que lo vuelva a enviar.', 'expired');
  if (r.envelope_status !== 'sent') throw new HttpError(410, 'Este sobre ya no admite firmas.', 'closed');
  if (new Date(r.token_expires_at) < new Date()) throw new HttpError(410, 'El enlace venció. Pedile al remitente que te lo reenvíe.', 'expired');
  return r;
}

export async function openSigning(ctx, token, meta) {
  const r = await resolveToken(ctx, token);
  if (r.status === 'sent') {
    const { rowCount } = await ctx.pool.query(`UPDATE recipients SET status = 'viewed' WHERE id = $1 AND status = 'sent'`, [r.id]);
    if (rowCount) {
      await addEvent(ctx.pool, r.envelope_id, 'viewed', { recipientId: r.id, ...meta });
      emit(ctx, r.envelope_id, 'recipient.viewed', { recipient_id: r.id });
    }
  }
  return {
    title: r.title,
    senderName: r.owner_name,
    recipientName: r.name,
    emailMasked: maskEmail(r.email),
    pageCount: r.page_count,
    language: langOf(r.language),
    brand: brandOf(ctx, r),
    inPerson: Boolean(r.in_person_by),
  };
}

export async function sendOtp(ctx, token, meta) {
  const r = await resolveToken(ctx, token);
  if (r.otp_sent_at && Date.now() - new Date(r.otp_sent_at).getTime() < OTP_RESEND_SECONDS * 1000) {
    throw new HttpError(429, `Esperá ${OTP_RESEND_SECONDS} segundos para pedir otro código.`, 'rate_limited');
  }
  const code = newOtp();
  await ctx.pool.query(
    `UPDATE recipients SET otp_hash = $2, otp_expires_at = now() + interval '${OTP_MINUTES} minutes',
            otp_sent_at = now(), otp_attempts = 0 WHERE id = $1`,
    [r.id, hmac(ctx.config.tokenSecret, `otp:${r.id}:${code}`)],
  );
  const mail = templates.otp({ lang: r.language, brand: brandOf(ctx, r), recipientName: r.name, code, title: r.title });
  await ctx.mailer.send({ ...mail, to: r.email, kind: 'otp', envelopeId: r.envelope_id, dedupeKey: `otp:${r.id}:${randomToken(8)}`, sensitive: true });
  await addEvent(ctx.pool, r.envelope_id, 'otp_sent', { recipientId: r.id, ...meta });
  return { ok: true, emailMasked: maskEmail(r.email) };
}

export async function verifyOtp(ctx, token, code, meta) {
  const r = await resolveToken(ctx, token);
  const clean = typeof code === 'string' ? code.replace(/\D/g, '') : '';
  if (!r.otp_hash || !r.otp_expires_at || new Date(r.otp_expires_at) < new Date()) {
    throw new HttpError(400, 'El código venció o no fue solicitado. Pedí uno nuevo.', 'otp_expired');
  }
  if (r.otp_attempts >= OTP_MAX_ATTEMPTS) {
    throw new HttpError(429, 'Demasiados intentos. Pedí un código nuevo.', 'otp_locked');
  }
  const ok = clean.length === 6 && safeEqualHex(hmac(ctx.config.tokenSecret, `otp:${r.id}:${clean}`), r.otp_hash);
  if (!ok) {
    await ctx.pool.query('UPDATE recipients SET otp_attempts = otp_attempts + 1 WHERE id = $1', [r.id]);
    await addEvent(ctx.pool, r.envelope_id, 'otp_failed', { recipientId: r.id, ...meta });
    const left = OTP_MAX_ATTEMPTS - r.otp_attempts - 1;
    throw new HttpError(400, left > 0 ? `Código incorrecto. Te quedan ${left} intentos.` : 'Código incorrecto. Pedí un código nuevo.', 'otp_invalid');
  }
  const session = randomToken();
  await ctx.pool.query(
    `UPDATE recipients SET otp_hash = NULL, verified_at = now(), sign_session_hash = $2,
            sign_session_expires_at = now() + interval '${SIGN_SESSION_MINUTES} minutes' WHERE id = $1`,
    [r.id, hmac(ctx.config.tokenSecret, `sess:${session}`)],
  );
  await addEvent(ctx.pool, r.envelope_id, 'otp_verified', { recipientId: r.id, ...meta });
  return { session };
}

function assertSession(ctx, r, session) {
  const valid = typeof session === 'string' && session.length > 20 && r.sign_session_hash &&
    new Date(r.sign_session_expires_at) > new Date() &&
    safeEqualHex(hmac(ctx.config.tokenSecret, `sess:${session}`), r.sign_session_hash);
  if (!valid) throw new HttpError(401, 'Tu sesión de firma venció. Verificá tu identidad de nuevo.', 'session_expired');
}

export async function signingDocument(ctx, token, session) {
  const r = await resolveToken(ctx, token);
  assertSession(ctx, r, session);
  const { rows } = await ctx.pool.query('SELECT original_pdf FROM envelopes WHERE id = $1', [r.envelope_id]);
  return rows[0].original_pdf;
}

export async function signingFields(ctx, token, session) {
  const r = await resolveToken(ctx, token);
  assertSession(ctx, r, session);
  const { rows } = await ctx.pool.query(
    'SELECT id, type, page, x, y, w, h, required, label FROM fields WHERE recipient_id = $1 ORDER BY page, y, x',
    [r.id],
  );
  return { fields: rows, name: r.name, email: r.email, today: shortDate(new Date()) };
}

export async function signDocument(ctx, token, body, meta) {
  if (body.consent !== true) throw new HttpError(400, 'Tenés que aceptar firmar electrónicamente.', 'consent');
  const { envelopeId, recipientId } = await withTransaction(ctx.pool, async (db) => {
    const r = await resolveToken(ctx, token, { forUpdate: true, db });
    assertSession(ctx, r, body.session);
    const { rows: fields } = await db.query('SELECT id, type, required FROM fields WHERE recipient_id = $1', [r.id]);
    const needs = (type) => fields.some((f) => f.type === type);
    const signature = needs('signature') ? cleanPngDataUrl(body.signature, 'La firma') : null;
    const initials = needs('initials') ? cleanPngDataUrl(body.initials, 'Las iniciales') : null;
    const values = body.values && typeof body.values === 'object' ? body.values : {};
    const signedOn = shortDate(new Date());

    for (const f of fields) {
      let value = null;
      if (f.type === 'signature') value = signature;
      else if (f.type === 'initials') value = initials;
      else if (f.type === 'date') value = signedOn;
      else if (f.type === 'name') value = r.name;
      else if (f.type === 'email') value = r.email;
      else if (f.type === 'checkbox') value = values[f.id] === true ? 'true' : 'false';
      else if (f.type === 'text') value = cleanText(values[f.id] ?? '', { max: 500, field: 'un campo de texto', required: f.required }) || null;
      if (f.required && f.type === 'checkbox' && value !== 'true') throw new HttpError(400, 'Marcá todas las casillas obligatorias.', 'validation');
      if (f.required && !value && !AUTO_FIELDS.has(f.type)) throw new HttpError(400, 'Completá todos los campos obligatorios.', 'validation');
      await db.query('UPDATE fields SET value = $2 WHERE id = $1', [f.id, value]);
    }
    await db.query(
      `UPDATE recipients SET status = 'signed', signed_at = now(), token_used_at = now(), sign_session_hash = NULL,
              signature_image = $2, initials_image = $3, action_ip = $4, action_user_agent = $5 WHERE id = $1`,
      [r.id, signature, initials, meta.ip, meta.userAgent ? meta.userAgent.slice(0, 300) : null],
    );
    await addEvent(db, r.envelope_id, 'signed', { recipientId: r.id, ...meta });
    return { envelopeId: r.envelope_id, recipientId: r.id };
  });
  emit(ctx, envelopeId, 'recipient.signed', { recipient_id: recipientId });
  await advance(ctx, envelopeId);
  return { ok: true };
}

export async function declineDocument(ctx, token, body, meta) {
  const reason = cleanText(body.reason, { max: 500, field: 'el motivo' });
  const info = await withTransaction(ctx.pool, async (db) => {
    const r = await resolveToken(ctx, token, { forUpdate: true, db });
    assertSession(ctx, r, body.session);
    await db.query(
      `UPDATE recipients SET status = 'declined', declined_at = now(), decline_reason = $2, token_used_at = now(),
              sign_session_hash = NULL, action_ip = $3, action_user_agent = $4 WHERE id = $1`,
      [r.id, reason, meta.ip, meta.userAgent ? meta.userAgent.slice(0, 300) : null],
    );
    await db.query(`UPDATE envelopes SET status = 'declined', updated_at = now() WHERE id = $1 AND status = 'sent'`, [r.envelope_id]);
    await db.query('UPDATE recipients SET token_hash = NULL WHERE envelope_id = $1 AND id <> $2', [r.envelope_id, r.id]);
    await addEvent(db, r.envelope_id, 'declined', { recipientId: r.id, ...meta, data: { reason } });
    const { rows: [owner] } = await db.query('SELECT u.name, u.email FROM envelopes e JOIN users u ON u.id = e.owner_id WHERE e.id = $1', [r.envelope_id]);
    return { envelopeId: r.envelope_id, title: r.title, recipientName: r.name, owner };
  });
  const mail = templates.declined({
    ownerName: info.owner.name,
    title: info.title,
    recipientName: info.recipientName,
    reason,
    url: `${ctx.config.appUrl}/app/sobres/${info.envelopeId}`,
  });
  await ctx.mailer.send({ ...mail, to: info.owner.email, kind: 'declined', envelopeId: info.envelopeId, dedupeKey: `declined:${info.envelopeId}` });
  emit(ctx, info.envelopeId, 'envelope.declined', { reason });
  return { ok: true };
}

async function advance(ctx, envelopeId) {
  const { rows } = await ctx.pool.query(
    `SELECT count(*) FILTER (WHERE status <> 'signed')::int AS pending FROM recipients WHERE envelope_id = $1 AND role = 'signer'`,
    [envelopeId],
  );
  if (rows[0].pending > 0) {
    await dispatchStage(ctx, envelopeId);
    return;
  }
  await completeEnvelope(ctx, envelopeId);
}

/** Genera el PDF final sellado y notifica. Idempotente: solo una ejecución puede completar el sobre. */
export async function completeEnvelope(ctx, envelopeId) {
  const { rows: [envelope] } = await ctx.pool.query(
    `SELECT id, title, status, page_count, original_pdf, original_sha256, created_at, sent_at, owner_id FROM envelopes WHERE id = $1`,
    [envelopeId],
  );
  if (!envelope || envelope.status !== 'sent') return;
  const { rows: [owner] } = await ctx.pool.query('SELECT id, name, email FROM users WHERE id = $1', [envelope.owner_id]);
  const { rows: recipients } = await ctx.pool.query('SELECT * FROM recipients WHERE envelope_id = $1 ORDER BY position', [envelopeId]);
  const { rows: fields } = await ctx.pool.query('SELECT type, page, x, y, w, h, value FROM fields WHERE envelope_id = $1', [envelopeId]);
  const { rows: events } = await ctx.pool.query('SELECT type, recipient_id, ip, created_at FROM events WHERE envelope_id = $1 ORDER BY id', [envelopeId]);
  const completedAt = new Date();

  const finalPdf = await buildFinalPdf({
    original: envelope.original_pdf,
    fields,
    envelope: { ...envelope, completed_at: completedAt },
    owner,
    recipients,
    events,
    siteUrl: ctx.config.siteUrl,
    sealP12: ctx.config.sealP12,
    sealPassword: ctx.config.sealPassword,
  });

  const done = await withTransaction(ctx.pool, async (db) => {
    const { rowCount } = await db.query(
      `UPDATE envelopes SET status = 'completed', completed_at = $2, final_pdf = $3, final_sha256 = $4, updated_at = now()
        WHERE id = $1 AND status = 'sent'
          AND NOT EXISTS (SELECT 1 FROM recipients WHERE envelope_id = $1 AND role = 'signer' AND status <> 'signed')`,
      [envelopeId, completedAt, finalPdf, sha256Hex(finalPdf)],
    );
    if (rowCount === 0) return false;
    await addEvent(db, envelopeId, 'completed');
    return true;
  });
  if (!done) return;
  emit(ctx, envelopeId, 'envelope.completed', { final_sha256: sha256Hex(finalPdf) });

  const { rows: [mailEnv] } = await ctx.pool.query(ENV_MAIL_SQL, [envelopeId]);
  const brand = brandOf(ctx, mailEnv);
  for (const r of recipients) {
    const token = randomToken();
    await ctx.pool.query('UPDATE recipients SET download_token_hash = $2 WHERE id = $1', [r.id, hmac(ctx.config.tokenSecret, `dl:${token}`)]);
    const mail = templates.completed({ lang: mailEnv.language, brand, recipientName: r.name, title: envelope.title, url: `${ctx.config.appUrl}/documento/${token}` });
    await ctx.mailer.send({ ...mail, to: r.email, kind: 'completed', envelopeId, dedupeKey: `completed:${r.id}` });
  }
  const ownerMail = templates.completed({ recipientName: owner.name, title: envelope.title, url: `${ctx.config.appUrl}/app/sobres/${envelopeId}` });
  await ctx.mailer.send({ ...ownerMail, to: owner.email, kind: 'completed', envelopeId, dedupeKey: `completed-owner:${envelopeId}` });
}

export async function downloadByToken(ctx, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new HttpError(404, 'Enlace inválido.', 'invalid_link');
  const { rows: [row] } = await ctx.pool.query(
    `SELECT e.id, e.title, e.final_pdf, e.final_sha256, e.completed_at FROM recipients r JOIN envelopes e ON e.id = r.envelope_id
      WHERE r.download_token_hash = $1 AND e.status = 'completed'`,
    [hmac(ctx.config.tokenSecret, `dl:${token}`)],
  );
  if (!row) throw new HttpError(404, 'El enlace de descarga no es válido.', 'invalid_link');
  return row;
}

export async function lookupBySha(ctx, sha) {
  const { rows: [env] } = await ctx.pool.query(
    'SELECT id, title, completed_at, page_count FROM envelopes WHERE final_sha256 = $1 AND status = $2',
    [sha, 'completed'],
  );
  if (!env) return null;
  const { rows: signers } = await ctx.pool.query(
    `SELECT name, email, signed_at FROM recipients WHERE envelope_id = $1 AND role = 'signer' ORDER BY position`,
    [env.id],
  );
  return { ...env, signers: signers.map((s) => ({ name: s.name, email: maskEmail(s.email), signedAt: s.signed_at })) };
}

// ---------- API pública v1 ----------

function autoFields(recipients, pageCount) {
  const signers = recipients.map((r, i) => ({ ...r, i })).filter((r) => r.role !== 'cc');
  if (signers.length > 6) throw new HttpError(400, 'Con más de 6 firmantes indicá la posición de los campos en "fields".', 'validation');
  return signers.flatMap((s, n) => {
    const x = 0.08 + (n % 2) * 0.46;
    const y = 0.78 - Math.floor(n / 2) * 0.1;
    return [
      { recipientKey: `r${s.i}`, type: 'signature', page: pageCount, x, y, w: 0.36, h: 0.06, required: true, label: '' },
      { recipientKey: `r${s.i}`, type: 'date', page: pageCount, x, y: y + 0.065, w: 0.2, h: 0.025, required: true, label: '' },
    ];
  });
}

function decodePdf(value) {
  if (typeof value !== 'string' || value.length < 10) throw new HttpError(400, 'Falta document_base64 con el PDF en base64.', 'validation');
  const b64 = value.replace(/^data:application\/pdf;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new HttpError(400, 'document_base64 no es base64 válido.', 'validation');
  return Buffer.from(b64, 'base64');
}

export async function apiEnvelope(ctx, ownerId, id) {
  const { envelope: e, recipients, events } = await envelopeDetail(ctx, ownerId, id);
  const base = `${ctx.config.appUrl}/api/v1/envelopes/${e.id}`;
  return {
    id: e.id,
    title: e.title,
    message: e.message,
    status: e.status,
    sequential: e.sequential,
    page_count: e.page_count,
    created_at: e.created_at,
    sent_at: e.sent_at,
    completed_at: e.completed_at,
    expires_at: e.expires_at,
    original_sha256: e.original_sha256,
    final_sha256: e.final_sha256,
    recipients: recipients.map((r) => ({
      id: r.id, name: r.name, email: r.email, role: r.role, routing_order: r.routing_order,
      status: r.status, signed_at: r.signed_at, declined_at: r.declined_at, decline_reason: r.decline_reason,
    })),
    events: events.map((ev) => ({ type: ev.type, recipient_id: ev.recipient_id, created_at: ev.created_at })),
    links: {
      self: base,
      original_pdf: `${base}/document?version=original`,
      final_pdf: e.status === 'completed' ? `${base}/document?version=final` : null,
      dashboard: `${ctx.config.appUrl}/app/sobres/${e.id}`,
    },
  };
}

/** Crea (y por defecto envía) un sobre en una sola llamada. Idempotente con Idempotency-Key. */
export async function createFromApi(ctx, owner, body, idempotencyKey, meta) {
  const key = idempotencyKey ? cleanText(idempotencyKey, { max: 100, field: 'Idempotency-Key' }) : null;
  if (key) {
    const { rows: [existing] } = await ctx.pool.query('SELECT id FROM envelopes WHERE owner_id = $1 AND create_idempotency_key = $2', [owner.id, key]);
    if (existing) return { replay: true, envelope: await apiEnvelope(ctx, owner.id, existing.id) };
  }
  const recipientsIn = Array.isArray(body.recipients) ? body.recipients : [];
  if (!recipientsIn.length) throw new HttpError(400, 'Indicá al menos un destinatario en "recipients".', 'validation');
  const { id, pageCount } = await createDraft(ctx, owner.id, { title: body.title, pdf: decodePdf(body.document_base64) });
  try {
    if (key) await ctx.pool.query('UPDATE envelopes SET create_idempotency_key = $2 WHERE id = $1', [id, key]);
    const recipients = recipientsIn.map((r, i) => ({ key: `r${i}`, name: r?.name, email: r?.email, role: r?.role === 'cc' ? 'cc' : 'signer', order: r?.order ?? i + 1 }));
    const fields = Array.isArray(body.fields) && body.fields.length
      ? body.fields.map((f) => {
        const idx = typeof f.recipient === 'number' ? f.recipient : recipientsIn.findIndex((r) => String(r?.email).toLowerCase() === String(f.recipient).toLowerCase());
        if (idx < 0 || idx >= recipients.length) throw new HttpError(400, 'Cada campo debe indicar "recipient" (índice o email de un destinatario).', 'validation');
        return { recipientKey: `r${idx}`, type: f.type, page: f.page, x: f.x, y: f.y, w: f.width, h: f.height, required: f.required, label: f.label };
      })
      : autoFields(recipients, pageCount);
    await saveDraft(ctx, owner.id, id, {
      title: body.title, message: body.message, sequential: body.sequential === true, recipients, fields,
      language: body.language, expire_days: body.expire_days, reminder_days: body.reminder_days,
    });
    if (body.send !== false) await sendEnvelope(ctx, owner, id, key || randomToken(16), meta);
  } catch (err) {
    await ctx.pool.query(`DELETE FROM envelopes WHERE id = $1 AND status = 'draft'`, [id]);
    if (err.code === '23505' && key) return createFromApi(ctx, owner, body, key, meta);
    throw err;
  }
  return { replay: false, envelope: await apiEnvelope(ctx, owner.id, id) };
}

// ---------- Corrección, vencimiento, firma en persona y tareas programadas ----------

/** Copia un sobre como borrador nuevo (documento, destinatarios y campos). */
async function cloneAsDraft(db, src, correctedFrom) {
  const { rows: [created] } = await db.query(
    `INSERT INTO envelopes (owner_id, title, message, sequential, language, expire_days, reminder_days,
                            original_pdf, original_sha256, page_count, corrected_from, template_id)
     SELECT owner_id, title, message, sequential, language, expire_days, reminder_days,
            original_pdf, original_sha256, page_count, $2, template_id FROM envelopes WHERE id = $1 RETURNING id`,
    [src, correctedFrom],
  );
  const { rows: recips } = await db.query('SELECT id, position, name, email, role, routing_order FROM recipients WHERE envelope_id = $1 ORDER BY position', [src]);
  const map = new Map();
  for (const r of recips) {
    const { rows: [n] } = await db.query(
      'INSERT INTO recipients (envelope_id, position, name, email, role, routing_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [created.id, r.position, r.name, r.email, r.role, r.routing_order],
    );
    map.set(r.id, n.id);
  }
  const { rows: fields } = await db.query('SELECT recipient_id, type, page, x, y, w, h, required, label FROM fields WHERE envelope_id = $1', [src]);
  for (const f of fields) {
    await db.query(
      'INSERT INTO fields (envelope_id, recipient_id, type, page, x, y, w, h, required, label) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [created.id, map.get(f.recipient_id), f.type, f.page, f.x, f.y, f.w, f.h, f.required, f.label],
    );
  }
  await addEvent(db, created.id, 'created', { data: { corrected_from: correctedFrom } });
  return created.id;
}

/** Corregir: anula el sobre en curso (los anulados no consumen cupo) y crea un borrador idéntico para editar y reenviar. */
export async function correctEnvelope(ctx, ownerId, id, meta) {
  let voided = false;
  const newId = await withTransaction(ctx.pool, async (db) => {
    const env = await ownedEnvelope(db, ownerId, id, { lock: true });
    if (!['sent', 'declined', 'expired', 'voided'].includes(env.status)) {
      throw new HttpError(409, 'Solo se pueden corregir sobres enviados, rechazados, vencidos o anulados.', 'not_correctable');
    }
    if (env.status === 'sent') {
      await db.query(`UPDATE envelopes SET status = 'voided', updated_at = now() WHERE id = $1`, [id]);
      await db.query('UPDATE recipients SET token_hash = NULL, access_code_hash = NULL, sign_session_hash = NULL WHERE envelope_id = $1', [id]);
      voided = true;
    }
    await addEvent(db, id, 'corrected', meta);
    return cloneAsDraft(db, id, id);
  });
  if (voided) emit(ctx, id, 'envelope.voided', { corrected_by: newId });
  return { id: newId };
}

export async function extendExpiration(ctx, ownerId, id, days, meta) {
  const d = Math.round(cleanNumber(days, { min: 1, max: 120, field: 'Los días' }));
  return withTransaction(ctx.pool, async (db) => {
    const env = await ownedEnvelope(db, ownerId, id, { lock: true });
    if (env.status !== 'sent') throw new HttpError(409, 'Solo se puede extender un sobre en curso.', 'not_sent');
    const { rows: [u] } = await db.query('UPDATE envelopes SET expires_at = now() + make_interval(days => $2), updated_at = now() WHERE id = $1 RETURNING expires_at', [id, d]);
    await db.query('UPDATE recipients SET token_expires_at = $2 WHERE envelope_id = $1 AND token_hash IS NOT NULL', [id, u.expires_at]);
    await addEvent(db, id, 'extended', { ...meta, data: { days: d } });
    return { expires_at: u.expires_at };
  });
}

/** Firma en persona: el remitente abre la firma en su dispositivo y su sesión atestigua la identidad. */
export async function startInPerson(ctx, ownerId, envelopeId, recipientId) {
  const env = await ownedEnvelope(ctx.pool, ownerId, envelopeId);
  if (env.status !== 'sent') throw new HttpError(409, 'Solo se puede firmar en persona un sobre en curso.', 'not_sent');
  if (!/^[0-9a-f-]{36}$/i.test(recipientId)) throw new HttpError(404, 'Destinatario no encontrado.', 'not_found');
  const { rows: [r] } = await ctx.pool.query(`SELECT id, status FROM recipients WHERE id = $1 AND envelope_id = $2 AND role = 'signer'`, [recipientId, envelopeId]);
  if (!r) throw new HttpError(404, 'Destinatario no encontrado.', 'not_found');
  if (!['sent', 'viewed'].includes(r.status)) throw new HttpError(409, 'Este firmante no tiene una firma pendiente en este momento.', 'not_pending');
  const creds = await issueCredentials(ctx, ctx.pool, r.id, env.expires_at, ', otp_hash = NULL, sign_session_hash = NULL');
  await ctx.pool.query('UPDATE recipients SET in_person_by = $2 WHERE id = $1', [r.id, ownerId]);
  await addEvent(ctx.pool, envelopeId, 'in_person_started', { recipientId: r.id });
  return { url: `${ctx.config.appUrl}/firmar/${creds.token}` };
}

export async function inPersonSession(ctx, token, user, meta) {
  const r = await resolveToken(ctx, token);
  if (!user || !r.in_person_by || r.in_person_by !== user.id) {
    throw new HttpError(403, 'La firma en persona requiere la sesión del remitente en este dispositivo.', 'in_person_forbidden');
  }
  const session = randomToken();
  await ctx.pool.query(
    `UPDATE recipients SET verified_at = now(), sign_session_hash = $2,
            sign_session_expires_at = now() + interval '${SIGN_SESSION_MINUTES} minutes' WHERE id = $1`,
    [r.id, hmac(ctx.config.tokenSecret, `sess:${session}`)],
  );
  await addEvent(ctx.pool, r.envelope_id, 'in_person_verified', { recipientId: r.id, ...meta });
  return { session };
}

/** Vence sobres pasados de fecha y envía recordatorios. Seguro en paralelo: cada paso se reclama con un UPDATE. */
export async function runScheduler(ctx) {
  const out = { expired: 0, reminders: 0 };
  const { rows: expired } = await ctx.pool.query(
    `UPDATE envelopes SET status = 'expired', updated_at = now() WHERE status = 'sent' AND expires_at < now() RETURNING id, owner_id, title`,
  );
  for (const env of expired) {
    await ctx.pool.query('UPDATE recipients SET token_hash = NULL, access_code_hash = NULL, sign_session_hash = NULL WHERE envelope_id = $1', [env.id]);
    await addEvent(ctx.pool, env.id, 'expired');
    const { rows: [owner] } = await ctx.pool.query('SELECT name, email FROM users WHERE id = $1', [env.owner_id]);
    const mail = templates.expired({ ownerName: owner.name, title: env.title, url: `${ctx.config.appUrl}/app/sobres/${env.id}` });
    await ctx.mailer.send({ ...mail, to: owner.email, kind: 'expired', envelopeId: env.id, dedupeKey: `expired:${env.id}` });
    emit(ctx, env.id, 'envelope.expired');
    out.expired += 1;
  }

  const { rows: due } = await ctx.pool.query(
    `SELECT r.id, r.name, r.email, r.envelope_id FROM recipients r JOIN envelopes e ON e.id = r.envelope_id
      WHERE e.status = 'sent' AND e.reminder_days > 0 AND r.role = 'signer' AND r.status IN ('sent', 'viewed')
        AND r.in_person_by IS NULL AND r.reminders_sent < $1
        AND r.last_notified_at < now() - make_interval(days => e.reminder_days)
      LIMIT 200`,
    [MAX_REMINDERS],
  );
  for (const r of due) {
    const { rows: [claimed] } = await ctx.pool.query(
      `UPDATE recipients rr SET reminders_sent = rr.reminders_sent + 1, last_notified_at = now()
         FROM envelopes e WHERE rr.id = $1 AND e.id = rr.envelope_id AND e.status = 'sent'
          AND rr.last_notified_at < now() - make_interval(days => e.reminder_days)
       RETURNING rr.reminders_sent, e.expires_at`,
      [r.id],
    );
    if (!claimed) continue;
    const creds = await issueCredentials(ctx, ctx.pool, r.id, claimed.expires_at, ', otp_hash = NULL, sign_session_hash = NULL');
    const { rows: [env] } = await ctx.pool.query(ENV_MAIL_SQL, [r.envelope_id]);
    await inviteRecipient(ctx, env, r, creds, `reminder:${r.id}:${claimed.reminders_sent}`, { reminder: true });
    out.reminders += 1;
  }
  return out;
}
