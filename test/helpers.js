import zlib from 'node:zlib';
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

/** Word (.docx) mínimo armado a mano: un ZIP sin compresión con las tres partes obligatorias. */
export function sampleDocx(text = 'Contrato de prueba DocSure en Word') {
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`],
  ];
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content);
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
