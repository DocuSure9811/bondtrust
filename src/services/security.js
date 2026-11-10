import crypto from 'node:crypto';
import qrcode from 'qrcode-generator';
import { withTransaction } from '../db.js';
import { hashPassword, hmac, safeEqualHex, verifyPassword } from '../security.js';
import { newTotpSecret, openSecret, otpauthUrl, sealSecret, verifyTotp } from '../totp.js';
import { HttpError, cleanPassword } from '../validate.js';

const TICKET_MINUTES = 5;
const RECOVERY_CODES = 10;
const RECOVERY_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';

export async function recordEvent(db, userId, type, meta = {}) {
  await db.query('INSERT INTO account_events (user_id, type, ip, user_agent) VALUES ($1, $2, $3, $4)', [userId, type, meta.ip || null, meta.userAgent ? meta.userAgent.slice(0, 300) : null]);
}

export async function listEvents(ctx, userId) {
  const { rows } = await ctx.pool.query('SELECT type, ip, user_agent, created_at FROM account_events WHERE user_id = $1 ORDER BY id DESC LIMIT 50', [userId]);
  return rows;
}

// ---------- Sesiones ----------

const publicId = (hash) => hash.slice(0, 16);

export async function listSessions(ctx, userId, currentHash) {
  const { rows } = await ctx.pool.query(
    'SELECT id_hash, ip, user_agent, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY coalesce(last_seen_at, created_at) DESC',
    [userId],
  );
  return rows.map((s) => ({ id: publicId(s.id_hash), ip: s.ip, user_agent: s.user_agent, created_at: s.created_at, last_seen_at: s.last_seen_at || s.created_at, current: s.id_hash === currentHash }));
}

export async function revokeSession(ctx, userId, id, meta) {
  if (!/^[0-9a-f]{16}$/.test(String(id))) throw new HttpError(404, 'Sesión no encontrada.', 'not_found');
  const { rowCount } = await ctx.pool.query('DELETE FROM sessions WHERE user_id = $1 AND left(id_hash, 16) = $2', [userId, id]);
  if (!rowCount) throw new HttpError(404, 'Sesión no encontrada.', 'not_found');
  await recordEvent(ctx.pool, userId, 'session_revoked', meta);
  return { ok: true };
}

export async function revokeOtherSessions(ctx, userId, currentHash, meta) {
  const { rowCount } = await ctx.pool.query('DELETE FROM sessions WHERE user_id = $1 AND id_hash <> $2', [userId, currentHash]);
  await recordEvent(ctx.pool, userId, 'sessions_revoked', meta);
  return { ok: true, closed: rowCount };
}

// ---------- Contraseña ----------

export async function changePassword(ctx, userId, body, currentHash, meta) {
  const next = cleanPassword(body?.new_password);
  const { rows: [u] } = await ctx.pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  const current = typeof body?.current_password === 'string' ? body.current_password.slice(0, 200) : '';
  if (!(await verifyPassword(current, u.password_hash))) {
    await recordEvent(ctx.pool, userId, 'password_change_failed', meta);
    throw new HttpError(400, 'La contraseña actual no es correcta.', 'bad_password');
  }
  if (await verifyPassword(next, u.password_hash)) throw new HttpError(400, 'La nueva contraseña tiene que ser distinta de la actual.', 'validation');
  await ctx.pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, await hashPassword(next)]);
  // Por seguridad se cierran las demás sesiones.
  await ctx.pool.query('DELETE FROM sessions WHERE user_id = $1 AND id_hash <> $2', [userId, currentHash]);
  await recordEvent(ctx.pool, userId, 'password_changed', meta);
  return { ok: true };
}

// ---------- Verificación en dos pasos ----------

export async function twoFactorStatus(ctx, userId) {
  const { rows: [u] } = await ctx.pool.query(
    `SELECT totp_enabled_at, (SELECT count(*)::int FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL) AS recovery_left FROM users WHERE id = $1`,
    [userId],
  );
  return { enabled: Boolean(u.totp_enabled_at), enabled_at: u.totp_enabled_at, recovery_left: u.recovery_left };
}

/** Genera un secreto pendiente y su QR. No se activa hasta confirmar un código. */
export async function startTwoFactor(ctx, user) {
  const status = await twoFactorStatus(ctx, user.id);
  if (status.enabled) throw new HttpError(409, 'La verificación en dos pasos ya está activa.', 'already_enabled');
  const secret = newTotpSecret();
  await ctx.pool.query('UPDATE users SET totp_pending = $2 WHERE id = $1', [user.id, sealSecret(secret, ctx.config.tokenSecret)]);
  const url = otpauthUrl(secret, user.email);
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return { secret: secret.match(/.{1,4}/g).join(' '), otpauth_url: url, qr_svg: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) };
}

function newRecoveryCode() {
  let s = '';
  for (let i = 0; i < 8; i += 1) s += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
const recoveryHash = (ctx, userId, code) => hmac(ctx.config.tokenSecret, `recovery:${userId}:${String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')}`);

export async function enableTwoFactor(ctx, userId, code, meta) {
  return withTransaction(ctx.pool, async (db) => {
    const { rows: [u] } = await db.query('SELECT totp_pending, totp_enabled_at FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (u.totp_enabled_at) throw new HttpError(409, 'La verificación en dos pasos ya está activa.', 'already_enabled');
    if (!u.totp_pending) throw new HttpError(400, 'Primero generá el código QR.', 'not_started');
    const secret = openSecret(u.totp_pending, ctx.config.tokenSecret);
    const step = verifyTotp(secret, code);
    if (step === null) throw new HttpError(400, 'El código no es correcto. Revisá la hora del celular y probá con el código nuevo.', 'bad_code');
    await db.query('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled_at = now(), totp_last_step = $2 WHERE id = $1', [userId, step]);
    await db.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
    const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
    for (const c of codes) await db.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, recoveryHash(ctx, userId, c)]);
    await recordEvent(db, userId, 'two_factor_enabled', meta);
    return { enabled: true, recovery_codes: codes };
  });
}

/**
 * Comprueba un código de la app (sin reutilizar pasos ya aceptados) o un código de recuperación (un solo uso).
 * Devuelve 'totp', 'recovery' o null.
 */
async function consumeSecondFactor(ctx, db, userId, code) {
  const { rows: [u] } = await db.query('SELECT totp_secret, totp_last_step FROM users WHERE id = $1', [userId]);
  if (!u?.totp_secret) return null;
  const digits = String(code ?? '').replace(/\D/g, '');
  if (digits.length === 6 && /^\s*[\d\s]+\s*$/.test(String(code))) {
    const step = verifyTotp(openSecret(u.totp_secret, ctx.config.tokenSecret), digits, { afterStep: Number(u.totp_last_step) });
    if (step === null) return null;
    const { rowCount } = await db.query('UPDATE users SET totp_last_step = $2 WHERE id = $1 AND totp_last_step < $2', [userId, step]);
    return rowCount ? 'totp' : null;
  }
  const { rowCount } = await db.query('UPDATE recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL', [userId, recoveryHash(ctx, userId, code)]);
  return rowCount ? 'recovery' : null;
}

export async function disableTwoFactor(ctx, userId, body, meta) {
  const { rows: [u] } = await ctx.pool.query('SELECT password_hash, totp_enabled_at FROM users WHERE id = $1', [userId]);
  if (!u.totp_enabled_at) throw new HttpError(409, 'La verificación en dos pasos no está activa.', 'not_enabled');
  const password = typeof body?.password === 'string' ? body.password.slice(0, 200) : '';
  if (!(await verifyPassword(password, u.password_hash))) throw new HttpError(400, 'La contraseña no es correcta.', 'bad_password');
  if (!(await consumeSecondFactor(ctx, ctx.pool, userId, body?.code))) throw new HttpError(400, 'El código no es correcto.', 'bad_code');
  await ctx.pool.query('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = 0 WHERE id = $1', [userId]);
  await ctx.pool.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
  await recordEvent(ctx.pool, userId, 'two_factor_disabled', meta);
  return { enabled: false };
}

// ---------- Ingreso en dos pasos ----------

/** Ticket firmado y de corta duración entre la contraseña y el segundo factor. */
export function loginTicket(ctx, userId) {
  const exp = Date.now() + TICKET_MINUTES * 60_000;
  const payload = `${userId}.${exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${hmac(ctx.config.sessionSecret, `2fa:${payload}`)}`;
}

export async function completeLogin(ctx, ticket, code, meta) {
  const [encoded, sig] = String(ticket || '').split('.');
  const payload = encoded ? Buffer.from(encoded, 'base64url').toString() : '';
  const [userId, exp] = payload.split('.');
  if (!sig || !/^[0-9a-f]{64}$/.test(sig) || !safeEqualHex(hmac(ctx.config.sessionSecret, `2fa:${payload}`), sig) || !/^[0-9a-f-]{36}$/.test(userId || '')) {
    throw new HttpError(400, 'Volvé a ingresar tu email y contraseña.', 'bad_ticket');
  }
  if (Number(exp) < Date.now()) throw new HttpError(400, 'Pasó demasiado tiempo. Volvé a ingresar tu email y contraseña.', 'ticket_expired');
  const used = await consumeSecondFactor(ctx, ctx.pool, userId, code);
  if (!used) {
    await recordEvent(ctx.pool, userId, 'two_factor_failed', meta);
    throw new HttpError(400, 'El código no es correcto.', 'bad_code');
  }
  await recordEvent(ctx.pool, userId, used === 'recovery' ? 'login_recovery_code' : 'login', meta);
  return { userId, usedRecovery: used === 'recovery' };
}
