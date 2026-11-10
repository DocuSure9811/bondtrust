import { withTransaction } from '../db.js';
import { formatLongDate, templates } from '../mail.js';
import { HttpError } from '../validate.js';
import { addEvent, cloneAsDraft, ownedEnvelope, readableEnvelope } from './envelopes.js';
import { visibleOwnerIds } from './teams.js';

/** Días de anticipación permitidos para el aviso de renovación. */
export const NOTICE_OPTIONS = [7, 15, 30, 60, 90];

/** Valida una fecha AAAA-MM-DD real (o vacía para quitarla). */
export function cleanDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new HttpError(400, 'La fecha de vencimiento no es válida.', 'validation');
  }
  const year = d.getUTCFullYear();
  if (year < 2000 || year > 2100) throw new HttpError(400, 'La fecha de vencimiento no es válida.', 'validation');
  return s;
}

/** Guarda el vencimiento del contrato y la anticipación del aviso. Cambiar la fecha vuelve a habilitar el aviso. */
export async function setContract(ctx, ownerId, id, body, meta) {
  const end = cleanDate(body.contract_end ?? body.endDate);
  const notice = Number(body.renewal_notice_days ?? body.noticeDays ?? 30);
  if (!NOTICE_OPTIONS.includes(notice)) throw new HttpError(400, `El aviso puede ser de ${NOTICE_OPTIONS.join(', ')} días.`, 'validation');
  return withTransaction(ctx.pool, async (db) => {
    const env = await ownedEnvelope(db, ownerId, id, { lock: true });
    const changed = env.contract_end !== end || env.renewal_notice_days !== notice;
    if (!changed) return contractOf(env);
    const { rows: [u] } = await db.query(
      `UPDATE envelopes SET contract_end = $2, renewal_notice_days = $3, renewal_notified_at = NULL, updated_at = now()
        WHERE id = $1 RETURNING to_char(contract_end, 'YYYY-MM-DD') AS contract_end, renewal_notice_days, renewal_notified_at`,
      [id, end, notice],
    );
    await addEvent(db, id, 'contract_updated', { ...meta, data: { contract_end: end, renewal_notice_days: notice } });
    return contractOf(u);
  });
}

export function contractOf(env) {
  return { contract_end: env.contract_end || null, renewal_notice_days: env.renewal_notice_days, renewal_notified_at: env.renewal_notified_at || null };
}

/** Nueva versión: un borrador con los mismos documentos, destinatarios, campos y datos de contrato, enlazado al historial. */
export async function newVersion(ctx, ownerId, id, meta) {
  return withTransaction(ctx.pool, async (db) => {
    const env = await ownedEnvelope(db, ownerId, id, { lock: true });
    if (env.status === 'draft') throw new HttpError(409, 'Un borrador todavía se puede editar: no hace falta una versión nueva.', 'is_draft');
    const newId = await cloneAsDraft(db, id, { newVersion: true });
    await addEvent(db, id, 'version_created', { ...meta, data: { new_version: newId } });
    const { rows: [v] } = await db.query('SELECT id, version FROM envelopes WHERE id = $1', [newId]);
    return v;
  });
}

/** Todas las versiones de un contrato, de la primera a la última. */
export async function versionsOf(db, env) {
  const root = env.root_id || env.id;
  const { rows } = await db.query(
    `SELECT id, title, status, version, created_at, completed_at FROM envelopes
      WHERE owner_id = $2 AND (id = $1 OR root_id = $1) ORDER BY version, created_at`,
    [root, env.owner_id],
  );
  return rows;
}

export async function contractDetail(ctx, userId, id) {
  const env = await readableEnvelope(ctx.pool, userId, id);
  return { ...contractOf(env), version: env.version, versions: await versionsOf(ctx.pool, env) };
}

/**
 * Contratos que vencen pronto (o vencieron hace poco), sin contar los que ya tienen una versión posterior vigente.
 * scope 'team' suma los del equipo para administradores.
 */
export async function expiringContracts(ctx, userId, { days = 90, scope = 'mine' } = {}) {
  const horizon = Math.min(Math.max(Math.round(Number(days)) || 90, 1), 730);
  const owners = scope === 'team' ? await visibleOwnerIds(ctx.pool, userId) : [userId];
  const { rows } = await ctx.pool.query(
    `SELECT e.id, e.title, e.status, e.version, to_char(e.contract_end, 'YYYY-MM-DD') AS contract_end, e.renewal_notice_days,
            (e.contract_end - current_date) AS days_left
       FROM envelopes e
      WHERE e.owner_id = ANY($1::uuid[]) AND e.contract_end IS NOT NULL AND e.status NOT IN ('draft', 'voided')
        AND e.contract_end BETWEEN current_date - 30 AND current_date + $2::int
        AND NOT EXISTS (
          SELECT 1 FROM envelopes n
           WHERE n.owner_id = e.owner_id AND n.version > e.version AND n.status IN ('sent', 'completed')
             AND (n.root_id = coalesce(e.root_id, e.id)))
      ORDER BY e.contract_end, e.title LIMIT 200`,
    [owners, horizon],
  );
  return rows;
}

/** Avisa por email al dueño cuando un contrato completado entra en su período de aviso. Una sola vez por fecha. */
export async function runRenewalNotices(ctx) {
  const { rows } = await ctx.pool.query(
    `UPDATE envelopes e SET renewal_notified_at = now()
      WHERE e.status = 'completed' AND e.contract_end IS NOT NULL AND e.renewal_notified_at IS NULL
        AND e.contract_end - e.renewal_notice_days <= current_date AND e.contract_end >= current_date - 1
        AND NOT EXISTS (SELECT 1 FROM envelopes n WHERE n.owner_id = e.owner_id AND n.version > e.version
                          AND n.status IN ('sent', 'completed') AND n.root_id = coalesce(e.root_id, e.id))
      RETURNING e.id, e.owner_id, e.title, to_char(e.contract_end, 'YYYY-MM-DD') AS contract_end, (e.contract_end - current_date) AS days_left`,
  );
  for (const env of rows) {
    const { rows: [owner] } = await ctx.pool.query('SELECT name, email FROM users WHERE id = $1', [env.owner_id]);
    const mail = templates.renewal({ ownerName: owner.name, title: env.title, endDate: formatLongDate(`${env.contract_end}T12:00:00Z`), daysLeft: env.days_left, url: `${ctx.config.appUrl}/app/sobres/${env.id}` });
    await ctx.mailer.send({ ...mail, to: owner.email, kind: 'renewal', envelopeId: env.id, dedupeKey: `renewal:${env.id}:${env.contract_end}` });
    await addEvent(ctx.pool, env.id, 'renewal_notified', { data: { contract_end: env.contract_end } });
  }
  return rows.length;
}
