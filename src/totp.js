import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

/** Código de 6 dígitos para un paso de 30 s (RFC 6238 con HMAC-SHA1, como las apps autenticadoras). */
export function totpAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1] & 15;
  const n = ((h[offset] & 127) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Verifica el código aceptando un paso de desfase de reloj. Devuelve el paso usado (para impedir
 * reutilizarlo) o null. `afterStep`: último paso ya aceptado.
 */
export function verifyTotp(secret, code, { afterStep = -1, now = Date.now() } = {}) {
  const clean = String(code ?? '').replace(/\D/g, '');
  if (clean.length !== 6) return null;
  const step = currentStep(now);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= afterStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(totpAt(secret, s)), Buffer.from(clean))) return s;
  }
  return null;
}

export function otpauthUrl(secret, account) {
  return `otpauth://totp/${encodeURIComponent(`DocSure:${account}`)}?secret=${secret}&issuer=DocSure&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/** Cifrado AES-256-GCM del secreto en la base (la clave sale de un secreto del servidor). */
function keyFrom(serverSecret) {
  return crypto.createHash('sha256').update(`totp-key:${serverSecret}`).digest();
}

export function sealSecret(secret, serverSecret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(serverSecret), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${data.toString('base64')}`;
}

export function openSecret(sealed, serverSecret) {
  const [iv, tag, data] = String(sealed).split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(serverSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
