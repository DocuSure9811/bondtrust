import { HttpError, cleanText } from '../validate.js';

const MAX_LOGO_BYTES = 200 * 1024;

export async function getSettings(ctx, userId) {
  const { rows: [u] } = await ctx.pool.query(
    'SELECT name, email, company, plan, brand_color, (brand_logo IS NOT NULL) AS has_logo FROM users WHERE id = $1',
    [userId],
  );
  return { ...u, logo_url: u.has_logo ? `/marca/${userId}` : null };
}

export async function updateSettings(ctx, userId, body) {
  const name = cleanText(body.name, { max: 120, field: 'tu nombre' });
  const company = cleanText(body.company ?? '', { max: 120, field: 'la empresa', required: false });
  const color = typeof body.brand_color === 'string' && body.brand_color ? body.brand_color.toLowerCase() : null;
  if (color && !/^#[0-9a-f]{6}$/.test(color)) throw new HttpError(400, 'El color debe tener el formato #RRGGBB.', 'validation');
  await ctx.pool.query('UPDATE users SET name = $2, company = $3, brand_color = $4 WHERE id = $1', [userId, name, company, color]);
  return getSettings(ctx, userId);
}

function imageType(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

export async function setLogo(ctx, userId, buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(400, 'Subí una imagen PNG o JPG.', 'validation');
  if (buf.length > MAX_LOGO_BYTES) throw new HttpError(413, 'El logo supera 200 KB.', 'too_large');
  const type = imageType(buf);
  if (!type) throw new HttpError(400, 'El logo debe ser PNG o JPG.', 'validation');
  await ctx.pool.query('UPDATE users SET brand_logo = $2, brand_logo_type = $3 WHERE id = $1', [userId, buf, type]);
  return getSettings(ctx, userId);
}

export async function deleteLogo(ctx, userId) {
  await ctx.pool.query('UPDATE users SET brand_logo = NULL, brand_logo_type = NULL WHERE id = $1', [userId]);
  return getSettings(ctx, userId);
}

export async function getLogo(ctx, userId) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const { rows: [u] } = await ctx.pool.query('SELECT brand_logo, brand_logo_type FROM users WHERE id = $1 AND brand_logo IS NOT NULL', [userId]);
  return u ? { bytes: u.brand_logo, type: u.brand_logo_type } : null;
}
