import { templates } from '../mail.js';
import { hmac, randomToken } from '../security.js';
import { HttpError, cleanEmail, cleanText } from '../validate.js';

/** Disparadores y acciones disponibles. Enviar copia solo tiene sentido con el PDF final, o sea al completarse. */
export const TRIGGERS = ['completed', 'declined', 'expired'];
export const ACTIONS = ['move_folder', 'send_copy', 'notify'];
const MAX_RULES = 20;
const COPY_LINK_DAYS = 30;

const checkId = (id) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new HttpError(404, 'Regla no encontrada.', 'not_found');
};

const SELECT = `SELECT a.id, a.name, a.trigger, a.title_contains, a.action, a.folder_id, f.name AS folder_name, a.email,
                       a.active, a.runs, a.last_run_at, a.created_at
                  FROM automations a LEFT JOIN folders f ON f.id = a.folder_id`;

export async function listAutomations(ctx, ownerId) {
  const { rows } = await ctx.pool.query(`${SELECT} WHERE a.owner_id = $1 ORDER BY a.created_at`, [ownerId]);
  return rows;
}

/** Valida una regla completa; las combinaciones imposibles se rechazan con un mensaje claro. */
async function cleanRule(ctx, ownerId, body) {
  const trigger = String(body.trigger || '');
  const action = String(body.action || '');
  if (!TRIGGERS.includes(trigger)) throw new HttpError(400, 'Elegí cuándo se ejecuta la regla: completado, rechazado o vencido.', 'validation');
  if (!ACTIONS.includes(action)) throw new HttpError(400, 'Elegí qué hace la regla.', 'validation');
  if (action === 'send_copy' && trigger !== 'completed') throw new HttpError(400, 'Solo se puede enviar una copia del documento firmado cuando el sobre se completa.', 'validation');
  const titleContains = cleanText(body.title_contains ?? '', { max: 80, field: 'el texto del título', required: false });
  let folderId = null;
  let email = null;
  if (action === 'move_folder') {
    if (!/^[0-9a-f-]{36}$/i.test(String(body.folder_id || ''))) throw new HttpError(400, 'Elegí una de tus carpetas.', 'validation');
    const { rows } = await ctx.pool.query('SELECT id FROM folders WHERE id = $1 AND owner_id = $2', [body.folder_id, ownerId]);
    if (!rows[0]) throw new HttpError(400, 'Elegí una de tus carpetas.', 'validation');
    folderId = rows[0].id;
  } else {
    email = cleanEmail(body.email);
  }
  const name = cleanText(body.name ?? '', { max: 80, field: 'el nombre', required: false }) || describe(trigger, action);
  return { name, trigger, titleContains, action, folderId, email };
}

function describe(trigger, action) {
  const when = { completed: 'Al completarse', declined: 'Al rechazarse', expired: 'Al vencer' }[trigger];
  const what = { move_folder: 'mover a carpeta', send_copy: 'enviar copia', notify: 'avisar por email' }[action];
  return `${when}: ${what}`;
}

export async function createAutomation(ctx, ownerId, body) {
  const r = await cleanRule(ctx, ownerId, body);
  const { rows: [{ n }] } = await ctx.pool.query('SELECT count(*)::int AS n FROM automations WHERE owner_id = $1', [ownerId]);
  if (n >= MAX_RULES) throw new HttpError(409, `Podés tener hasta ${MAX_RULES} reglas.`, 'limit');
  const { rows: [created] } = await ctx.pool.query(
    `INSERT INTO automations (owner_id, name, trigger, title_contains, action, folder_id, email) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [ownerId, r.name, r.trigger, r.titleContains, r.action, r.folderId, r.email],
  );
  return (await ctx.pool.query(`${SELECT} WHERE a.id = $1`, [created.id])).rows[0];
}

export async function updateAutomation(ctx, ownerId, id, body) {
  checkId(id);
  const { rows: [current] } = await ctx.pool.query(`${SELECT} WHERE a.id = $1 AND a.owner_id = $2`, [id, ownerId]);
  if (!current) throw new HttpError(404, 'Regla no encontrada.', 'not_found');
  // Pausar o reanudar no exige reenviar la regla entera.
  if (Object.keys(body).length === 1 && typeof body.active === 'boolean') {
    if (body.active && current.action === 'move_folder' && !current.folder_id) throw new HttpError(409, 'La carpeta de esta regla ya no existe: editala antes de activarla.', 'folder_missing');
    await ctx.pool.query('UPDATE automations SET active = $3 WHERE id = $1 AND owner_id = $2', [id, ownerId, body.active]);
  } else {
    const r = await cleanRule(ctx, ownerId, { ...current, ...body });
    await ctx.pool.query(
      `UPDATE automations SET name = $3, trigger = $4, title_contains = $5, action = $6, folder_id = $7, email = $8, active = $9
        WHERE id = $1 AND owner_id = $2`,
      [id, ownerId, r.name, r.trigger, r.titleContains, r.action, r.folderId, r.email, body.active ?? current.active],
    );
  }
  return (await ctx.pool.query(`${SELECT} WHERE a.id = $1`, [id])).rows[0];
}

export async function deleteAutomation(ctx, ownerId, id) {
  checkId(id);
  const { rowCount } = await ctx.pool.query('DELETE FROM automations WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  if (!rowCount) throw new HttpError(404, 'Regla no encontrada.', 'not_found');
  return { ok: true };
}

/**
 * Ejecuta las reglas activas del dueño para un sobre que acaba de completarse, rechazarse o vencer.
 * Cada regla corre una sola vez por sobre (el evento automation_run hace de candado) y un error en una no frena a las demás.
 */
export async function runAutomations(ctx, envelopeId, trigger) {
  const { rows: [env] } = await ctx.pool.query(
    `SELECT e.id, e.title, e.owner_id, e.status, u.name AS owner_name FROM envelopes e JOIN users u ON u.id = e.owner_id WHERE e.id = $1`,
    [envelopeId],
  );
  if (!env || env.status !== trigger) return 0;
  const { rows: rules } = await ctx.pool.query(
    `SELECT * FROM automations WHERE owner_id = $1 AND trigger = $2 AND active
        AND (title_contains = '' OR strpos(lower($3), lower(title_contains)) > 0)
      ORDER BY created_at`,
    [env.owner_id, trigger, env.title],
  );
  let ran = 0;
  for (const rule of rules) {
    const { rows: claimed } = await ctx.pool.query(
      `INSERT INTO events (envelope_id, type, data)
       SELECT $1, 'automation_run', jsonb_build_object('rule_id', $2::text, 'rule', $3::text, 'action', $4::text)
        WHERE NOT EXISTS (SELECT 1 FROM events WHERE envelope_id = $1 AND type = 'automation_run' AND data->>'rule_id' = $2::text)
       RETURNING id`,
      [env.id, rule.id, rule.name, rule.action],
    );
    if (!claimed[0]) continue;
    try {
      await execute(ctx, env, rule);
      await ctx.pool.query('UPDATE automations SET runs = runs + 1, last_run_at = now() WHERE id = $1', [rule.id]);
      ran += 1;
    } catch (err) {
      console.error('Automatización fallida:', err.message);
    }
  }
  return ran;
}

async function execute(ctx, env, rule) {
  const url = `${ctx.config.appUrl}/app/sobres/${env.id}`;
  if (rule.action === 'move_folder') {
    if (!rule.folder_id) return;
    await ctx.pool.query('UPDATE envelopes SET folder_id = $2, updated_at = now() WHERE id = $1 AND owner_id = $3', [env.id, rule.folder_id, env.owner_id]);
  } else if (rule.action === 'send_copy') {
    const token = randomToken();
    await ctx.pool.query(
      `INSERT INTO document_links (envelope_id, token_hash, email, expires_at) VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
      [env.id, hmac(ctx.config.tokenSecret, `dl:${token}`), rule.email, COPY_LINK_DAYS],
    );
    const mail = templates.sharedCopy({ senderName: env.owner_name, title: env.title, url: `${ctx.config.appUrl}/documento/${token}`, days: COPY_LINK_DAYS });
    await ctx.mailer.send({ ...mail, to: rule.email, kind: 'copy', envelopeId: env.id, dedupeKey: `copy:${rule.id}:${env.id}` });
  } else if (rule.action === 'notify') {
    const mail = templates.automationNotice({ trigger: rule.trigger, title: env.title, ruleName: rule.name, url });
    await ctx.mailer.send({ ...mail, to: rule.email, kind: 'notice', envelopeId: env.id, dedupeKey: `notice:${rule.id}:${env.id}` });
  }
}
