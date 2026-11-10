import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, migrate } from '../src/db.js';
import { createMailer } from '../src/mail.js';

/** Levanta la app contra un esquema Postgres temporal y aislado. */
export async function startTestApp() {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const schema = `test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const adminPool = createPool(url);
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const pool = createPool(url, { schema });
  await migrate(pool);
  const config = loadConfig({ ...process.env, DATABASE_URL: url, APP_URL: 'http://127.0.0.1', PORT: '0', ALLOW_PRIVATE_WEBHOOKS: '1' });
  const mailer = createMailer({ pool, resendApiKey: '', mailFrom: 'test', forceOutbox: true });
  const app = createApp({ pool, config, mailer });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    pool,
    config,
    ctx: { pool, config, mailer },
    async stop() {
      await new Promise((r) => server.close(r));
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    },
  };
}

/** Cliente HTTP con cookie de sesión y encabezado anti-CSRF. */
export function client(base) {
  let cookie = '';
  return async function call(path, { method = 'GET', body, headers = {}, csrf = true } = {}) {
    const h = { ...headers };
    if (csrf) h['x-docsure'] = '1';
    if (cookie) h.cookie = cookie;
    let payload;
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
      payload = body;
      h['content-type'] = 'application/pdf';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      h['content-type'] = 'application/json';
    }
    const res = await fetch(base + path, { method, headers: h, body: payload, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return res;
  };
}

/** PDF de prueba: página 1 normal y página 2 rotada 90°. */
export async function samplePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595, 842]);
  p1.drawText('Contrato de prueba DocSure - página 1', { x: 50, y: 780, size: 14, font });
  const p2 = doc.addPage([595, 842]);
  p2.drawText('Página 2 (rotada)', { x: 50, y: 780, size: 14, font });
  p2.setRotation(degrees(90));
  return Buffer.from(await doc.save());
}

export async function outbox(pool, kind, to) {
  const { rows } = await pool.query('SELECT text_body FROM emails WHERE kind = $1 AND to_email = $2 ORDER BY id', [kind, to]);
  return rows.map((r) => r.text_body);
}

export const linkFrom = (text) => text.match(/\/firmar\/([A-Za-z0-9_-]+)/)[1];
export const downloadFrom = (text) => text.match(/\/documento\/([A-Za-z0-9_-]+)/)[1];
export const codeFrom = (text) => text.match(/\b(\d{6})\b/)[1];

// PNG 1x1 válido para firmas de prueba.
export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
