export class HttpError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(value, { max = 200, field = 'texto', required = true } = {}) {
  const text = typeof value === 'string' ? value.replace(CONTROL_RE, '').trim() : '';
  if (required && !text) throw new HttpError(400, `Falta ${field}.`, 'validation');
  if (text.length > max) throw new HttpError(400, `${field} supera ${max} caracteres.`, 'validation');
  return text;
}

export function cleanEmail(value, field = 'el email') {
  const email = cleanText(value, { max: 254, field }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, `${field} no es válido.`, 'validation');
  return email;
}

export function cleanPassword(value) {
  if (typeof value !== 'string' || value.length < 10) {
    throw new HttpError(400, 'La contraseña debe tener al menos 10 caracteres.', 'validation');
  }
  if (value.length > 200) throw new HttpError(400, 'La contraseña es demasiado larga.', 'validation');
  return value;
}

export function cleanNumber(value, { min, max, field }) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, `${field} fuera de rango.`, 'validation');
  }
  return n;
}

const PNG_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export function cleanPngDataUrl(value, field) {
  if (typeof value !== 'string' || !PNG_DATA_URL_RE.test(value) || value.length > 400_000) {
    throw new HttpError(400, `${field} no es una imagen válida.`, 'validation');
  }
  const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
  const isPng = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!isPng) throw new HttpError(400, `${field} no es una imagen PNG.`, 'validation');
  return value;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
