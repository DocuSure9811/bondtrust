import { HttpError } from './validate.js';

/** Límite de pedidos en memoria por clave (ventana fija). Suficiente para una sola instancia. */
export function createRateLimiter() {
  const buckets = new Map();
  let lastSweep = Date.now();

  function sweep(now) {
    if (now - lastSweep < 60_000) return;
    lastSweep = now;
    for (const [key, b] of buckets) if (b.reset <= now) buckets.delete(key);
  }

  return function limit(key, max, windowMs) {
    const now = Date.now();
    sweep(now);
    const b = buckets.get(key);
    if (!b || b.reset <= now) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      return;
    }
    b.count += 1;
    if (b.count > max) {
      throw new HttpError(429, 'Demasiados intentos. Probá de nuevo en unos minutos.', 'rate_limited');
    }
  };
}
