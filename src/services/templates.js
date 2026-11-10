import { randomToken } from '../security.js';
import { fieldsAsInput } from './fields.js';
import { membershipOf, teammateIds } from './teams.js';
import { HttpError, cleanText } from '../validate.js';
import { createDraft, documentsOf, saveDraft, sendEnvelope } from './envelopes.js';

const MAX_BULK_ROWS = 200;

function checkId(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new HttpError(404, 'Plantilla no encontrada.', 'not_found');
}

/** Guarda un sobre (en cualquier estado) como plantilla: documento, roles y campos, sin datos de personas. */
export async function saveTemplate(ctx, ownerId, envelopeId, name) {
  checkId(envelopeId);
  const clean = cleanText(name, { max: 120, field: 'el nombre de la plantilla' });
  const { rows: [env] } = await ctx.pool.query(
    'SELECT id, title, message, sequential, language, original_pdf, original_sha256, page_count, documents FROM envelopes WHERE id = $1 AND owner_id = $2',
    [envelopeId, ownerId],
  );
  if (!env) throw new HttpError(404, 'Sobre no encontrado.', 'not_found');
  const { rows: recips } = await ctx.pool.query('SELECT id, role, routing_order FROM recipients WHERE envelope_id = $1 ORDER BY position', [envelopeId]);
  if (!recips.some((r) => r.role === 'signer')) throw new HttpError(400, 'El sobre necesita al menos un firmante para guardarse como plantilla.', 'validation');
  const index = new Map(recips.map((r, i) => [r.id, i]));
  let signerN = 0;
  let ccN = 0;
  const roles = recips.map((r) => ({
    label: r.role === 'cc' ? `Copia ${(ccN += 1)}` : `Firmante ${(signerN += 1)}`,
    role: r.role,
    order: r.routing_order,
  }));
  const { rows: fields } = await ctx.pool.query('SELECT id, recipient_id, type, page, x, y, w, h, required, label, options, validation, formula, cond_field_id, cond_value FROM fields WHERE envelope_id = $1', [envelopeId]);
  const tplFields = fieldsAsInput(fields, (f) => index.get(f.recipient_id)).map(({ recipientKey, ...f }) => ({ role: recipientKey, ...f }));
  const { rows: [tpl] } = await ctx.pool.query(
    `INSERT INTO templates (owner_id, name, message, sequential, language, pdf, page_count, roles, fields, documents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, name, created_at`,
    [ownerId, clean, env.message, env.sequential, env.language, env.original_pdf, env.page_count, JSON.stringify(roles), JSON.stringify(tplFields), JSON.stringify(documentsOf(env))],
  );
  return tpl;
}

/** Plantillas propias y las de los compañeros de equipo. */
export async function listTemplates(ctx, ownerId) {
  const owners = await teammateIds(ctx.pool, ownerId);
  const m = await membershipOf(ctx.pool, ownerId);
  const { rows } = await ctx.pool.query(
    `SELECT t.id, t.name, t.page_count, t.roles, t.sequential, t.language, t.created_at, t.owner_id, u.name AS owner_name,
            jsonb_array_length(t.fields) AS field_count FROM templates t JOIN users u ON u.id = t.owner_id
      WHERE t.owner_id = ANY($1::uuid[]) ORDER BY t.created_at DESC`,
    [owners],
  );
  return rows.map(({ owner_id: o, ...t }) => ({ ...t, mine: o === ownerId, can_delete: o === ownerId || m?.role === 'admin' }));
}

/** Borra el dueño o un administrador del equipo. */
export async function deleteTemplate(ctx, ownerId, id) {
  checkId(id);
  const m = await membershipOf(ctx.pool, ownerId);
  const owners = m?.role === 'admin' ? await teammateIds(ctx.pool, ownerId) : [ownerId];
  const { rowCount } = await ctx.pool.query('DELETE FROM templates WHERE id = $1 AND owner_id = ANY($2::uuid[])', [id, owners]);
  if (!rowCount) throw new HttpError(404, 'Plantilla no encontrada.', 'not_found');
  return { ok: true };
}

async function getTemplate(ctx, ownerId, id) {
  checkId(id);
  const owners = await teammateIds(ctx.pool, ownerId);
  const { rows: [tpl] } = await ctx.pool.query('SELECT * FROM templates WHERE id = $1 AND owner_id = ANY($2::uuid[])', [id, owners]);
  if (!tpl) throw new HttpError(404, 'Plantilla no encontrada.', 'not_found');
  return tpl;
}

/**
 * Crea un sobre desde una plantilla. `recipients` va en el mismo orden que los roles.
 * Si `send` es true lo envía; si falla el envío, no deja el borrador.
 */
export async function useTemplate(ctx, owner, templateId, body, meta, idempotencyKey) {
  const tpl = await getTemplate(ctx, owner.id, templateId);
  const recipientsIn = Array.isArray(body.recipients) ? body.recipients : [];
  if (recipientsIn.length !== tpl.roles.length) {
    throw new HttpError(400, `La plantilla tiene ${tpl.roles.length} rol(es): indicá un destinatario para cada uno (${tpl.roles.map((r) => r.label).join(', ')}).`, 'validation');
  }
  const title = body.title || tpl.name;
  const { id } = await createDraft(ctx, owner.id, { title, pdf: tpl.pdf, documents: tpl.documents });
  try {
    await ctx.pool.query('UPDATE envelopes SET template_id = $2 WHERE id = $1', [id, tpl.id]);
    await saveDraft(ctx, owner.id, id, {
      title,
      message: body.message ?? tpl.message,
      sequential: tpl.sequential,
      language: body.language || tpl.language,
      expire_days: body.expire_days,
      reminder_days: body.reminder_days,
      recipients: tpl.roles.map((role, i) => ({ key: `r${i}`, name: recipientsIn[i]?.name, email: recipientsIn[i]?.email, role: role.role, order: role.order })),
      fields: tpl.fields.map(({ role, ...f }) => ({ ...f, recipientKey: `r${role}` })),
    });
    if (body.send) await sendEnvelope(ctx, owner, id, idempotencyKey || randomToken(16), meta);
  } catch (err) {
    await ctx.pool.query(`DELETE FROM envelopes WHERE id = $1 AND status = 'draft'`, [id]);
    throw err;
  }
  return { id };
}

/** Envío masivo: un sobre por fila, para plantillas de un solo firmante. Se detiene si se agota el cupo. */
export async function bulkSend(ctx, owner, templateId, rows, meta) {
  const tpl = await getTemplate(ctx, owner.id, templateId);
  if (tpl.roles.length !== 1 || tpl.roles[0].role !== 'signer') {
    throw new HttpError(400, 'El envío masivo funciona con plantillas de un solo firmante.', 'validation');
  }
  if (!Array.isArray(rows) || rows.length === 0) throw new HttpError(400, 'Cargá al menos una fila con nombre y email.', 'validation');
  if (rows.length > MAX_BULK_ROWS) throw new HttpError(400, `Máximo ${MAX_BULK_ROWS} filas por envío masivo.`, 'validation');
  const results = [];
  let stopped = false;
  const batch = randomToken(8);
  for (const [i, row] of rows.entries()) {
    if (stopped) {
      results.push({ row: i + 1, email: row?.email, status: 'skipped', error: 'No se envió porque se alcanzó el límite del plan.' });
      continue;
    }
    try {
      const { id } = await useTemplate(ctx, owner, templateId, { recipients: [{ name: row?.name, email: row?.email }], send: true }, meta, `bulk:${batch}:${i}`);
      results.push({ row: i + 1, email: row?.email, status: 'sent', envelope_id: id });
    } catch (err) {
      if (err.code === 'quota') stopped = true;
      results.push({ row: i + 1, email: row?.email, status: 'error', error: err.message });
    }
  }
  return { sent: results.filter((r) => r.status === 'sent').length, results };
}
