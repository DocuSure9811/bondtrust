import crypto from 'node:crypto';
import { hmac, randomToken } from '../security.js';
import { HttpError, cleanText } from '../validate.js';

const KEY_PREFIX = 'ds_live_';
const DEVICE_MINUTES = 15;
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';

function keyHash(ctx, key) {
  return hmac(ctx.config.tokenSecret, `apikey:${key}`);
}

export async function createApiKey(ctx, userId, name, createdVia = 'panel') {
  const clean = cleanText(name, { max: 80, field: 'el nombre de la clave' });
  const { rows: [{ n }] } = await ctx.pool.query('SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  if (n >= 25) throw new HttpError(400, 'Máximo 25 claves activas. Revocá alguna antes de crear otra.', 'validation');
  const key = `${KEY_PREFIX}${randomToken(32)}`;
  const { rows: [row] } = await ctx.pool.query(
    `INSERT INTO api_keys (user_id, name, prefix, key_hash, created_via) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, prefix, created_via, created_at`,
    [userId, clean, key.slice(0, 14), keyHash(ctx, key), createdVia],
  );
  return { ...row, key };
}

export async function listApiKeys(ctx, userId) {
  const { rows } = await ctx.pool.query(
    `SELECT id, name, prefix, created_via, created_at, last_used_at FROM api_keys
      WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

export async function revokeApiKey(ctx, userId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Clave no encontrada.', 'not_found');
  const { rowCount } = await ctx.pool.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [id, userId]);
  if (!rowCount) throw new HttpError(404, 'Clave no encontrada.', 'not_found');
  return { ok: true };
}

/** Devuelve el usuario dueño de la clave o null. */
export async function authenticateApiKey(ctx, key) {
  if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX) || key.length > 100) return null;
  const { rows: [row] } = await ctx.pool.query(
    `UPDATE api_keys k SET last_used_at = now() FROM users u
      WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND u.id = k.user_id
      RETURNING u.id, u.name, u.email, u.company, u.plan, k.id AS key_id`,
    [keyHash(ctx, key)],
  );
  return row || null;
}

// ---------- Conexión de agentes (flujo de dispositivo) ----------

function userCode() {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export async function startDeviceFlow(ctx, clientName) {
  const name = cleanText(clientName ?? 'Asistente de IA', { max: 60, field: 'el nombre del cliente', required: false }) || 'Asistente de IA';
  const deviceCode = randomToken(32);
  const code = userCode();
  await ctx.pool.query(
    `INSERT INTO device_codes (device_code_hash, user_code, client_name, expires_at)
     VALUES ($1, $2, $3, now() + interval '${DEVICE_MINUTES} minutes')`,
    [hmac(ctx.config.tokenSecret, `device:${deviceCode}`), code, name],
  );
  return {
    device_code: deviceCode,
    user_code: code,
    verification_url: `${ctx.config.appUrl}/app/conectar?codigo=${code}`,
    expires_in: DEVICE_MINUTES * 60,
    interval: 3,
  };
}

export async function deviceInfo(ctx, code) {
  const clean = String(code || '').toUpperCase().trim();
  const { rows: [row] } = await ctx.pool.query(
    `SELECT client_name, approved_at, denied_at, expires_at FROM device_codes WHERE user_code = $1`,
    [clean],
  );
  if (!row || new Date(row.expires_at) < new Date()) throw new HttpError(404, 'El código no existe o venció. Pedile a tu asistente que genere uno nuevo.', 'invalid_code');
  if (row.approved_at || row.denied_at) throw new HttpError(409, 'Este código ya fue usado.', 'used_code');
  return { clientName: row.client_name, userCode: clean };
}

export async function decideDevice(ctx, userId, code, approve) {
  await deviceInfo(ctx, code);
  const { rowCount } = await ctx.pool.query(
    `UPDATE device_codes SET user_id = $2, ${approve ? 'approved_at' : 'denied_at'} = now()
      WHERE user_code = $1 AND approved_at IS NULL AND denied_at IS NULL AND expires_at > now()`,
    [String(code).toUpperCase().trim(), userId],
  );
  if (!rowCount) throw new HttpError(409, 'Este código ya fue usado.', 'used_code');
  return { ok: true };
}

/** El agente consulta hasta que el usuario autoriza; recibe la clave una sola vez. */
export async function pollDevice(ctx, deviceCode) {
  if (typeof deviceCode !== 'string' || deviceCode.length < 20 || deviceCode.length > 100) {
    throw new HttpError(400, 'device_code inválido.', 'invalid_request');
  }
  const hash = hmac(ctx.config.tokenSecret, `device:${deviceCode}`);
  const { rows: [row] } = await ctx.pool.query('SELECT * FROM device_codes WHERE device_code_hash = $1', [hash]);
  if (!row) throw new HttpError(400, 'device_code inválido.', 'invalid_request');
  if (row.denied_at) throw new HttpError(403, 'El usuario rechazó la conexión.', 'access_denied');
  if (row.consumed_at) throw new HttpError(400, 'La clave ya fue entregada.', 'already_consumed');
  if (new Date(row.expires_at) < new Date()) throw new HttpError(400, 'El código venció. Iniciá la conexión de nuevo.', 'expired_token');
  if (!row.approved_at) throw new HttpError(428, 'Esperando que el usuario autorice.', 'authorization_pending');
  const { rowCount } = await ctx.pool.query('UPDATE device_codes SET consumed_at = now() WHERE device_code_hash = $1 AND consumed_at IS NULL', [hash]);
  if (!rowCount) throw new HttpError(400, 'La clave ya fue entregada.', 'already_consumed');
  const created = await createApiKey(ctx, row.user_id, row.client_name, 'agente');
  return { api_key: created.key, key_id: created.id, name: created.name };
}
