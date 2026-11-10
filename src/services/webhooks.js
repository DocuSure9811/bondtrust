import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { randomToken } from '../security.js';
import { HttpError } from '../validate.js';

export const WEBHOOK_EVENTS = ['envelope.sent', 'recipient.viewed', 'recipient.signed', 'envelope.completed', 'envelope.declined', 'envelope.voided', 'envelope.expired'];
const RETRY_DELAYS_MS = [0, 5_000, 30_000];

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Rechaza URLs que apunten a redes internas (protección SSRF). */
async function assertPublicUrl(ctx, raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'La URL del webhook no es válida.', 'validation');
  }
  if (ctx.config.allowPrivateWebhooks) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'La URL debe ser http o https.', 'validation');
    return url;
  }
  if (url.protocol !== 'https:') throw new HttpError(400, 'La URL del webhook debe usar https.', 'validation');
  if (url.username || url.password) throw new HttpError(400, 'La URL no puede incluir credenciales.', 'validation');
  const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(400, 'No se pudo resolver el dominio del webhook.', 'validation');
  if (addrs.some((a) => isPrivateIp(a.address))) throw new HttpError(400, 'La URL del webhook apunta a una red privada.', 'validation');
  return url;
}

export async function createWebhook(ctx, userId, { url, events }) {
  if (typeof url !== 'string' || url.length > 500) throw new HttpError(400, 'La URL del webhook no es válida.', 'validation');
  const parsed = await assertPublicUrl(ctx, url);
  const list = Array.isArray(events) && events.length ? [...new Set(events)] : WEBHOOK_EVENTS;
  const unknown = list.filter((e) => !WEBHOOK_EVENTS.includes(e));
  if (unknown.length) throw new HttpError(400, `Eventos desconocidos: ${unknown.join(', ')}.`, 'validation');
  const { rows: [{ n }] } = await ctx.pool.query('SELECT count(*)::int AS n FROM webhooks WHERE user_id = $1', [userId]);
  if (n >= 10) throw new HttpError(400, 'Máximo 10 webhooks por cuenta.', 'validation');
  const secret = `whsec_${randomToken(24)}`;
  const { rows: [row] } = await ctx.pool.query(
    'INSERT INTO webhooks (user_id, url, events, secret) VALUES ($1, $2, $3, $4) RETURNING id, url, events, created_at',
    [userId, parsed.toString(), list, secret],
  );
  return { ...row, secret };
}

export async function listWebhooks(ctx, userId) {
  const { rows } = await ctx.pool.query(
    `SELECT w.id, w.url, w.events, w.created_at,
            (SELECT json_build_object('status_code', d.status_code, 'error', d.error, 'at', d.created_at, 'event', d.event_type)
               FROM webhook_deliveries d WHERE d.webhook_id = w.id ORDER BY d.id DESC LIMIT 1) AS last_delivery
       FROM webhooks w WHERE w.user_id = $1 ORDER BY w.created_at DESC`,
    [userId],
  );
  return rows;
}

export async function deleteWebhook(ctx, userId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Webhook no encontrado.', 'not_found');
  const { rowCount } = await ctx.pool.query('DELETE FROM webhooks WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rowCount) throw new HttpError(404, 'Webhook no encontrado.', 'not_found');
  return { ok: true };
}

/** Firma: HMAC-SHA256(secret, `${timestamp}.${body}`) en hex. */
export function signPayload(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function deliver(ctx, hook, eventId, type, body) {
  for (const [attempt, delay] of RETRY_DELAYS_MS.entries()) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    let status = null;
    let error = null;
    try {
      await assertPublicUrl(ctx, hook.url);
      const ts = Math.floor(Date.now() / 1000);
      const res = await fetch(hook.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'DocSure-Webhooks/1',
          'DocSure-Event': type,
          'DocSure-Event-Id': eventId,
          'DocSure-Signature': `t=${ts},v1=${signPayload(hook.secret, ts, body)}`,
        },
        body,
      });
      status = res.status;
    } catch (err) {
      error = String(err.message).slice(0, 300);
    }
    await ctx.pool.query(
      'INSERT INTO webhook_deliveries (webhook_id, event_id, event_type, attempt, status_code, error) VALUES ($1, $2, $3, $4, $5, $6)',
      [hook.id, eventId, type, attempt + 1, status, error],
    ).catch(() => {});
    if (status && status >= 200 && status < 300) return;
  }
}

/** Arma el evento con el estado actual del sobre y lo entrega a los webhooks suscriptos (en segundo plano). */
export async function emitEnvelopeEvent(ctx, envelopeId, type, extra = {}) {
  const { rows: [env] } = await ctx.pool.query('SELECT id, owner_id, title, status, sent_at, completed_at FROM envelopes WHERE id = $1', [envelopeId]);
  if (!env) return [];
  const { rows: hooks } = await ctx.pool.query('SELECT id, url, secret FROM webhooks WHERE user_id = $1 AND $2 = ANY(events)', [env.owner_id, type]);
  if (!hooks.length) return [];
  const { rows: recipients } = await ctx.pool.query(
    'SELECT id, name, email, role, routing_order, status, signed_at FROM recipients WHERE envelope_id = $1 ORDER BY position',
    [envelopeId],
  );
  const eventId = `evt_${randomToken(12)}`;
  const body = JSON.stringify({
    id: eventId,
    type,
    created_at: new Date().toISOString(),
    data: {
      envelope: { id: env.id, title: env.title, status: env.status, sent_at: env.sent_at, completed_at: env.completed_at, recipients },
      ...extra,
    },
  });
  return hooks.map((h) => deliver(ctx, h, eventId, type, body));
}
