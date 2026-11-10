import { withTransaction } from '../db.js';
import { templates } from '../mail.js';
import { hmac, randomToken } from '../security.js';
import { HttpError, cleanEmail, cleanText } from '../validate.js';

const INVITE_DAYS = 7;
const MAX_MEMBERS = 500;
const ROLES = new Set(['admin', 'member']);

/** Equipo y rol del usuario, o null si trabaja solo. */
export async function membershipOf(db, userId) {
  const { rows: [m] } = await db.query(
    'SELECT t.id AS team_id, t.name AS team_name, m.role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = $1',
    [userId],
  );
  return m || null;
}

/** Usuarios cuyos sobres puede ver este usuario: él mismo y, si es admin, todo su equipo. */
export async function visibleOwnerIds(db, userId) {
  const m = await membershipOf(db, userId);
  if (!m || m.role !== 'admin') return [userId];
  const { rows } = await db.query('SELECT user_id FROM team_members WHERE team_id = $1', [m.team_id]);
  return rows.map((r) => r.user_id);
}

/** Usuarios cuyas plantillas puede usar este usuario: él mismo y todo su equipo. */
export async function teammateIds(db, userId) {
  const m = await membershipOf(db, userId);
  if (!m) return [userId];
  const { rows } = await db.query('SELECT user_id FROM team_members WHERE team_id = $1', [m.team_id]);
  return rows.map((r) => r.user_id);
}

async function requireAdmin(db, userId) {
  const m = await membershipOf(db, userId);
  if (!m) throw new HttpError(404, 'No sos parte de un equipo.', 'no_team');
  if (m.role !== 'admin') throw new HttpError(403, 'Solo un administrador del equipo puede hacer esto.', 'forbidden');
  return m;
}

export async function getTeam(ctx, userId) {
  const m = await membershipOf(ctx.pool, userId);
  if (!m) return { team: null };
  const { rows: members } = await ctx.pool.query(
    `SELECT u.id, u.name, u.email, m.role, m.joined_at,
            (SELECT count(*)::int FROM envelopes e WHERE e.owner_id = u.id AND e.status <> 'draft') AS envelopes_sent
       FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1 ORDER BY m.role, lower(u.name)`,
    [m.team_id],
  );
  const { rows: invites } = m.role === 'admin'
    ? await ctx.pool.query(
      `SELECT id, email, role, expires_at, created_at FROM team_invites
        WHERE team_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
      [m.team_id],
    )
    : { rows: [] };
  return { team: { id: m.team_id, name: m.team_name }, role: m.role, me: userId, members, invites };
}

export async function createTeam(ctx, userId, body) {
  const name = cleanText(body?.name, { max: 80, field: 'el nombre del equipo' });
  return withTransaction(ctx.pool, async (db) => {
    if (await membershipOf(db, userId)) throw new HttpError(409, 'Ya sos parte de un equipo.', 'has_team');
    const { rows: [team] } = await db.query('INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING id, name', [name, userId]);
    await db.query(`INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'admin')`, [team.id, userId]);
    return team;
  });
}

export async function renameTeam(ctx, userId, body) {
  const m = await requireAdmin(ctx.pool, userId);
  const name = cleanText(body?.name, { max: 80, field: 'el nombre del equipo' });
  await ctx.pool.query('UPDATE teams SET name = $2 WHERE id = $1', [m.team_id, name]);
  return { id: m.team_id, name };
}

/** Crea una invitación de un solo uso. Devuelve el enlace (una sola vez) y además lo envía por email. */
export async function inviteMember(ctx, user, body) {
  const m = await requireAdmin(ctx.pool, user.id);
  const email = cleanEmail(body?.email);
  const role = ROLES.has(body?.role) ? body.role : 'member';
  const { rows: [{ n }] } = await ctx.pool.query('SELECT count(*)::int AS n FROM team_members WHERE team_id = $1', [m.team_id]);
  if (n >= MAX_MEMBERS) throw new HttpError(400, `Máximo ${MAX_MEMBERS} miembros por equipo.`, 'validation');
  const { rows: [already] } = await ctx.pool.query(
    'SELECT 1 FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = $1 AND u.email = $2',
    [m.team_id, email],
  );
  if (already) throw new HttpError(409, 'Esa persona ya es parte del equipo.', 'exists');
  // Una invitación vigente por email: la nueva reemplaza a la anterior.
  await ctx.pool.query('DELETE FROM team_invites WHERE team_id = $1 AND email = $2 AND accepted_at IS NULL', [m.team_id, email]);
  const token = randomToken();
  const { rows: [invite] } = await ctx.pool.query(
    `INSERT INTO team_invites (team_id, email, role, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => ${INVITE_DAYS})) RETURNING id, email, role, expires_at, created_at`,
    [m.team_id, email, role, hmac(ctx.config.tokenSecret, `team:${token}`), user.id],
  );
  const url = `${ctx.config.appUrl}/app/unirse?token=${token}`;
  const mail = templates.teamInvite({ inviterName: user.name, teamName: m.team_name, role, url });
  await ctx.mailer.send({ ...mail, to: email, kind: 'team_invite', dedupeKey: `team-invite:${invite.id}`, sensitive: true });
  return { ...invite, url };
}

export async function revokeInvite(ctx, userId, inviteId) {
  const m = await requireAdmin(ctx.pool, userId);
  if (!/^[0-9a-f-]{36}$/i.test(String(inviteId))) throw new HttpError(404, 'Invitación no encontrada.', 'not_found');
  const { rowCount } = await ctx.pool.query('DELETE FROM team_invites WHERE id = $1 AND team_id = $2 AND accepted_at IS NULL', [inviteId, m.team_id]);
  if (!rowCount) throw new HttpError(404, 'Invitación no encontrada.', 'not_found');
  return { ok: true };
}

async function findInvite(db, ctx, token, { lock = false } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new HttpError(404, 'La invitación no es válida.', 'invalid_invite');
  const { rows: [inv] } = await db.query(
    `SELECT i.*, t.name AS team_name, u.name AS inviter_name FROM team_invites i JOIN teams t ON t.id = i.team_id
       LEFT JOIN users u ON u.id = i.invited_by WHERE i.token_hash = $1 ${lock ? 'FOR UPDATE OF i' : ''}`,
    [hmac(ctx.config.tokenSecret, `team:${token}`)],
  );
  if (!inv) throw new HttpError(404, 'La invitación no es válida o fue reemplazada.', 'invalid_invite');
  if (inv.accepted_at) throw new HttpError(410, 'Esta invitación ya se usó.', 'invite_used');
  if (new Date(inv.expires_at) < new Date()) throw new HttpError(410, 'La invitación venció. Pedile al administrador una nueva.', 'invite_expired');
  return inv;
}

export async function inviteInfo(ctx, user, token) {
  const inv = await findInvite(ctx.pool, ctx, token);
  return { team: inv.team_name, inviter: inv.inviter_name, role: inv.role, email: inv.email, matches: inv.email === user.email };
}

/** Acepta la invitación: el email de la sesión tiene que coincidir con el invitado. */
export async function acceptInvite(ctx, user, token) {
  return withTransaction(ctx.pool, async (db) => {
    const inv = await findInvite(db, ctx, token, { lock: true });
    if (inv.email !== user.email) throw new HttpError(403, `Esta invitación es para ${inv.email}. Ingresá con esa cuenta para aceptarla.`, 'wrong_account');
    if (await membershipOf(db, user.id)) throw new HttpError(409, 'Ya sos parte de un equipo. Salí de ese equipo para sumarte a otro.', 'has_team');
    await db.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)', [inv.team_id, user.id, inv.role]);
    await db.query('UPDATE team_invites SET accepted_at = now() WHERE id = $1', [inv.id]);
    return { team: { id: inv.team_id, name: inv.team_name }, role: inv.role };
  });
}

async function adminCount(db, teamId) {
  const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM team_members WHERE team_id = $1 AND role = 'admin'`, [teamId]);
  return n;
}

const checkMember = (id) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new HttpError(404, 'Miembro no encontrado.', 'not_found');
};

export async function changeRole(ctx, userId, memberId, role) {
  checkMember(memberId);
  if (!ROLES.has(role)) throw new HttpError(400, 'Rol inválido (admin o member).', 'validation');
  return withTransaction(ctx.pool, async (db) => {
    const m = await requireAdmin(db, userId);
    await db.query('SELECT 1 FROM teams WHERE id = $1 FOR UPDATE', [m.team_id]);
    const { rows: [target] } = await db.query('SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2', [m.team_id, memberId]);
    if (!target) throw new HttpError(404, 'Miembro no encontrado.', 'not_found');
    if (target.role === 'admin' && role === 'member' && (await adminCount(db, m.team_id)) === 1) {
      throw new HttpError(400, 'El equipo necesita al menos un administrador.', 'last_admin');
    }
    await db.query('UPDATE team_members SET role = $3 WHERE team_id = $1 AND user_id = $2', [m.team_id, memberId, role]);
    return { ok: true };
  });
}

/** Quita a un miembro (admin) o sale del equipo (uno mismo). Sus sobres y plantillas siguen siendo suyos. */
export async function removeMember(ctx, userId, memberId) {
  checkMember(memberId);
  return withTransaction(ctx.pool, async (db) => {
    const m = await membershipOf(db, userId);
    if (!m) throw new HttpError(404, 'No sos parte de un equipo.', 'no_team');
    if (memberId !== userId && m.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede quitar miembros.', 'forbidden');
    await db.query('SELECT 1 FROM teams WHERE id = $1 FOR UPDATE', [m.team_id]);
    const { rows: [target] } = await db.query('SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2', [m.team_id, memberId]);
    if (!target) throw new HttpError(404, 'Miembro no encontrado.', 'not_found');
    const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM team_members WHERE team_id = $1', [m.team_id]);
    if (target.role === 'admin' && n > 1 && (await adminCount(db, m.team_id)) === 1) {
      throw new HttpError(400, 'Nombrá a otro administrador antes de salir.', 'last_admin');
    }
    await db.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [m.team_id, memberId]);
    if (n === 1) await db.query('DELETE FROM teams WHERE id = $1', [m.team_id]);
    return { ok: true };
  });
}
