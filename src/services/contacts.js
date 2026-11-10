import { HttpError, cleanEmail, cleanText } from '../validate.js';

const MAX_CONTACTS = 5000;

const publicContact = (c) => ({ id: c.id, name: c.name, email: c.email, uses: c.uses, last_used_at: c.last_used_at, created_at: c.created_at });

/** Guarda (o actualiza) en la libreta los destinatarios de un sobre enviado. */
export async function rememberRecipients(db, ownerId, envelopeId) {
  await db.query(
    `INSERT INTO contacts (owner_id, name, email, uses, last_used_at)
     SELECT $1, name, email, 1, now() FROM recipients WHERE envelope_id = $2
     ON CONFLICT (owner_id, email) DO UPDATE SET name = EXCLUDED.name, uses = contacts.uses + 1, last_used_at = now()`,
    [ownerId, envelopeId],
  );
}

export async function listContacts(ctx, ownerId, query) {
  const q = typeof query === 'string' ? query.trim().slice(0, 100) : '';
  const { rows } = await ctx.pool.query(
    `SELECT id, name, email, uses, last_used_at, created_at FROM contacts
      WHERE owner_id = $1 AND ($2 = '' OR name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')
      ORDER BY last_used_at DESC NULLS LAST, name LIMIT ${MAX_CONTACTS}`,
    [ownerId, q.replace(/[%_\\]/g, (m) => `\\${m}`)],
  );
  return rows.map(publicContact);
}

export async function createContact(ctx, ownerId, body) {
  const name = cleanText(body?.name, { max: 120, field: 'el nombre' });
  const email = cleanEmail(body?.email);
  const { rows: [{ n }] } = await ctx.pool.query('SELECT count(*)::int AS n FROM contacts WHERE owner_id = $1', [ownerId]);
  if (n >= MAX_CONTACTS) throw new HttpError(400, `Máximo ${MAX_CONTACTS} contactos.`, 'validation');
  const { rows: [c] } = await ctx.pool.query(
    `INSERT INTO contacts (owner_id, name, email) VALUES ($1, $2, $3)
     ON CONFLICT (owner_id, email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, email, uses, last_used_at, created_at`,
    [ownerId, name, email],
  );
  return publicContact(c);
}

export async function updateContact(ctx, ownerId, id, body) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new HttpError(404, 'Contacto no encontrado.', 'not_found');
  const name = cleanText(body?.name, { max: 120, field: 'el nombre' });
  const email = cleanEmail(body?.email);
  try {
    const { rows: [c] } = await ctx.pool.query(
      `UPDATE contacts SET name = $3, email = $4 WHERE id = $1 AND owner_id = $2
       RETURNING id, name, email, uses, last_used_at, created_at`,
      [id, ownerId, name, email],
    );
    if (!c) throw new HttpError(404, 'Contacto no encontrado.', 'not_found');
    return publicContact(c);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Ya tenés un contacto con ese email.', 'exists');
    throw err;
  }
}

export async function deleteContact(ctx, ownerId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new HttpError(404, 'Contacto no encontrado.', 'not_found');
  const { rowCount } = await ctx.pool.query('DELETE FROM contacts WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  if (!rowCount) throw new HttpError(404, 'Contacto no encontrado.', 'not_found');
  return { ok: true };
}
