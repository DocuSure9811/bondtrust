import { HttpError, cleanText } from '../validate.js';

const MAX_FOLDERS = 200;
const checkId = (id, what = 'Carpeta') => {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new HttpError(404, `${what} no encontrada.`, 'not_found');
};

export async function listFolders(ctx, ownerId) {
  const { rows } = await ctx.pool.query(
    `SELECT f.id, f.name, f.created_at, count(e.id)::int AS envelopes
       FROM folders f LEFT JOIN envelopes e ON e.folder_id = f.id
      WHERE f.owner_id = $1 GROUP BY f.id ORDER BY lower(f.name)`,
    [ownerId],
  );
  return rows;
}

export async function createFolder(ctx, ownerId, body) {
  const name = cleanText(body?.name, { max: 60, field: 'el nombre de la carpeta' });
  const { rows: [{ n }] } = await ctx.pool.query('SELECT count(*)::int AS n FROM folders WHERE owner_id = $1', [ownerId]);
  if (n >= MAX_FOLDERS) throw new HttpError(400, `Máximo ${MAX_FOLDERS} carpetas.`, 'validation');
  try {
    const { rows: [f] } = await ctx.pool.query('INSERT INTO folders (owner_id, name) VALUES ($1, $2) RETURNING id, name, created_at', [ownerId, name]);
    return { ...f, envelopes: 0 };
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Ya tenés una carpeta con ese nombre.', 'exists');
    throw err;
  }
}

export async function renameFolder(ctx, ownerId, id, body) {
  checkId(id);
  const name = cleanText(body?.name, { max: 60, field: 'el nombre de la carpeta' });
  try {
    const { rows: [f] } = await ctx.pool.query('UPDATE folders SET name = $3 WHERE id = $1 AND owner_id = $2 RETURNING id, name, created_at', [id, ownerId, name]);
    if (!f) throw new HttpError(404, 'Carpeta no encontrada.', 'not_found');
    return f;
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Ya tenés una carpeta con ese nombre.', 'exists');
    throw err;
  }
}

/** Borra la carpeta; sus sobres quedan sin carpeta (no se borra ningún sobre). */
export async function deleteFolder(ctx, ownerId, id) {
  checkId(id);
  const { rowCount } = await ctx.pool.query('DELETE FROM folders WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  if (!rowCount) throw new HttpError(404, 'Carpeta no encontrada.', 'not_found');
  return { ok: true };
}

export async function moveEnvelope(ctx, ownerId, envelopeId, folderId) {
  checkId(envelopeId, 'Sobre');
  if (folderId !== null && folderId !== undefined && folderId !== '') {
    checkId(folderId);
    const { rows: [f] } = await ctx.pool.query('SELECT id FROM folders WHERE id = $1 AND owner_id = $2', [folderId, ownerId]);
    if (!f) throw new HttpError(404, 'Carpeta no encontrada.', 'not_found');
  }
  const { rowCount } = await ctx.pool.query('UPDATE envelopes SET folder_id = $3 WHERE id = $1 AND owner_id = $2', [envelopeId, ownerId, folderId || null]);
  if (!rowCount) throw new HttpError(404, 'Sobre no encontrado.', 'not_found');
  return { ok: true, folder_id: folderId || null };
}
