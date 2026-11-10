import { createRequire } from 'node:module';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { HttpError } from '../validate.js';

const require = createRequire(import.meta.url);
const signpdfModule = require('@signpdf/signpdf');
const signpdf = signpdfModule.default ?? signpdfModule;
const { P12Signer } = require('@signpdf/signer-p12');
const { pdflibAddPlaceholder } = require('@signpdf/placeholder-pdf-lib');

const MAX_PAGES = 200;
const BRAND = rgb(0.055, 0.486, 0.4);
const INK = rgb(0.063, 0.137, 0.118);
const MUTED = rgb(0.29, 0.37, 0.35);

export async function inspectPdf(bytes) {
  if (!bytes?.length || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new HttpError(400, 'El archivo no es un PDF.', 'invalid_pdf');
  }
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const encrypted = /encrypt/i.test(err.message);
    throw new HttpError(400, encrypted ? 'El PDF está protegido con contraseña. Subí una versión sin protección.' : 'No se pudo leer el PDF.', 'invalid_pdf');
  }
  const pageCount = doc.getPageCount();
  if (pageCount < 1 || pageCount > MAX_PAGES) {
    throw new HttpError(400, `El PDF debe tener entre 1 y ${MAX_PAGES} páginas.`, 'invalid_pdf');
  }
  return { pageCount };
}

export { MAX_PAGES };

/**
 * Arma un PDF nuevo con páginas de varios PDF, en orden.
 * `parts`: [{ bytes, keep? }] donde `keep(i)` decide si se conserva la página i (base 0).
 */
export async function assemblePdf(parts) {
  const out = await PDFDocument.create();
  for (const { bytes, keep } of parts) {
    const src = await PDFDocument.load(bytes, { updateMetadata: false });
    const indices = src.getPageIndices().filter((i) => !keep || keep(i));
    const copied = await out.copyPages(src, indices);
    copied.forEach((p) => out.addPage(p));
  }
  return Buffer.from(await out.save());
}

/** Deja solo los caracteres que la fuente estándar puede codificar (WinAnsi). */
function encodable(font, text) {
  let out = '';
  for (const ch of String(text)) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function fitText(font, text, size, maxWidth) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Convierte un rectángulo en fracciones de la página tal como se ve (origen arriba a la izquierda,
 * con la rotación aplicada) a un origen y ejes en el espacio de usuario del PDF.
 */
function placement(page, field) {
  const { width: W, height: H } = page.getSize();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const map = (u, v) => {
    if (r === 90) return [v * W, u * H];
    if (r === 180) return [W - u * W, v * H];
    if (r === 270) return [(1 - v) * W, (1 - u) * H];
    return [u * W, H - v * H];
  };
  const dispW = r % 180 ? H : W;
  const dispH = r % 180 ? W : H;
  const [ox, oy] = map(field.x, field.y + field.h);
  const rad = (r * Math.PI) / 180;
  return {
    ox, oy, rotate: degrees(r),
    boxW: field.w * dispW,
    boxH: field.h * dispH,
    along: [Math.cos(rad), Math.sin(rad)],
    up: [-Math.sin(rad), Math.cos(rad)],
  };
}

function at(p, a, u) {
  return { x: p.ox + p.along[0] * a + p.up[0] * u, y: p.oy + p.along[1] * a + p.up[1] * u };
}

async function drawField(pdf, page, field, font, imageCache) {
  const p = placement(page, field);
  if (field.type === 'signature' || field.type === 'initials') {
    if (!field.value) return;
    let image = imageCache.get(field.value);
    if (!image) {
      image = await pdf.embedPng(Buffer.from(field.value.slice(field.value.indexOf(',') + 1), 'base64'));
      imageCache.set(field.value, image);
    }
    const scale = Math.min(p.boxW / image.width, p.boxH / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, { ...at(p, (p.boxW - w) / 2, (p.boxH - h) / 2), width: w, height: h, rotate: p.rotate });
    return;
  }
  const raw = field.type === 'checkbox' ? (field.value === 'true' ? 'X' : '') : field.value;
  if (!raw) return;
  const size = Math.max(6, Math.min(12, p.boxH * 0.62));
  const text = fitText(font, encodable(font, raw), size, Math.max(4, p.boxW - 4));
  const offsetX = field.type === 'checkbox' ? (p.boxW - font.widthOfTextAtSize(text, size)) / 2 : 2;
  page.drawText(text, { ...at(p, offsetX, (p.boxH - size * 0.72) / 2), size, font, color: INK, rotate: p.rotate });
}

function fmt(date) {
  if (!date) return '—';
  return `${new Date(date).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

const EVENT_LABELS = {
  created: 'Sobre creado',
  sent: 'Sobre enviado',
  email_sent: 'Invitación enviada',
  viewed: 'Enlace abierto',
  otp_sent: 'Código de verificación enviado',
  otp_failed: 'Código incorrecto',
  otp_verified: 'Identidad verificada por código',
  signed: 'Documento firmado',
  declined: 'Firma rechazada',
  resent: 'Invitación reenviada',
  reminder_sent: 'Recordatorio enviado',
  extended: 'Vencimiento extendido',
  in_person_started: 'Firma en persona iniciada por el remitente',
  in_person_verified: 'Identidad atestiguada en persona',
  corrected: 'Sobre corregido',
  document_added: 'Documento agregado',
  document_removed: 'Documento quitado',
  voided: 'Sobre anulado',
  completed: 'Sobre completado',
};

class Writer {
  constructor(pdf, fonts) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage([595.28, 841.89]);
    this.y = 790;
    this.page.drawRectangle({ x: 0, y: 812, width: 595.28, height: 30, color: BRAND });
    this.page.drawText('DocSure · Certificado de finalización', { x: 40, y: 822, size: 11, font: this.fonts.bold, color: rgb(1, 1, 1) });
  }

  ensure(space) {
    if (this.y - space < 50) this.newPage();
  }

  text(value, { size = 10, bold = false, color = INK, x = 40, maxWidth = 515 } = {}) {
    const font = bold ? this.fonts.bold : this.fonts.regular;
    const words = encodable(font, value).split(/\s+/);
    let line = '';
    const lines = [];
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    for (const l of lines) {
      this.ensure(size + 4);
      this.page.drawText(l, { x, y: this.y, size, font, color });
      this.y -= size + 4;
    }
  }

  gap(h = 8) {
    this.y -= h;
  }

  rule() {
    this.ensure(10);
    this.page.drawLine({ start: { x: 40, y: this.y + 4 }, end: { x: 555, y: this.y + 4 }, thickness: 0.6, color: rgb(0.85, 0.89, 0.88) });
    this.gap(8);
  }
}

async function addCertificate(pdf, { envelope, owner, recipients, events, siteUrl }) {
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const w = new Writer(pdf, fonts);
  w.text(envelope.title, { size: 16, bold: true });
  w.gap(4);
  w.text(`ID del sobre: ${envelope.id}`, { color: MUTED });
  w.text(`Remitente: ${owner.name} <${owner.email}>`, { color: MUTED });
  w.text(`Creado: ${fmt(envelope.created_at)} · Enviado: ${fmt(envelope.sent_at)} · Completado: ${fmt(envelope.completed_at)}`, { color: MUTED });
  w.text(`Documento original: ${envelope.page_count} página(s) · SHA-256 ${envelope.original_sha256}`, { color: MUTED, size: 8 });
  const docs = envelope.documents || [];
  if (docs.length > 1) {
    let first = 1;
    for (const [i, d] of docs.entries()) {
      w.text(`Documento ${i + 1}: ${d.name} · páginas ${first}-${first + d.pages - 1} · SHA-256 del archivo subido ${d.sha256}`, { color: MUTED, size: 8 });
      first += d.pages;
    }
  }
  w.gap(10);
  w.text('Firmantes y destinatarios', { size: 13, bold: true });
  w.rule();

  const images = new Map();
  for (const r of recipients) {
    w.ensure(90);
    w.text(`${r.name} <${r.email}>`, { bold: true });
    const role = r.role === 'cc' ? 'Recibe copia del documento final' : `Firmante (orden ${r.routing_order}) · Firmado`;
    w.text(role, { color: MUTED });
    if (r.role === 'signer') {
      const method = r.in_person_by
        ? 'firma en persona en el dispositivo del remitente, con su sesión autenticada'
        : 'código de un solo uso enviado al email';
      w.text(`Verificación de identidad: ${method} · verificado ${fmt(r.verified_at)}`, { color: MUTED, size: 9 });
      w.text(`Firmado: ${fmt(r.signed_at)} · IP ${r.action_ip || '—'}`, { color: MUTED, size: 9 });
      w.text(`Navegador: ${(r.action_user_agent || '—').slice(0, 160)}`, { color: MUTED, size: 8 });
      if (r.signature_image) {
        let img = images.get(r.signature_image);
        if (!img) {
          img = await pdf.embedPng(Buffer.from(r.signature_image.slice(r.signature_image.indexOf(',') + 1), 'base64'));
          images.set(r.signature_image, img);
        }
        const scale = Math.min(160 / img.width, 40 / img.height);
        w.ensure(48);
        w.page.drawRectangle({ x: 40, y: w.y - 40, width: 170, height: 46, borderColor: rgb(0.85, 0.89, 0.88), borderWidth: 0.6 });
        w.page.drawImage(img, { x: 45, y: w.y - 37, width: img.width * scale, height: img.height * scale });
        w.gap(50);
      }
    }
    w.rule();
  }

  w.gap(6);
  w.text('Registro de auditoría', { size: 13, bold: true });
  w.rule();
  const byId = new Map(recipients.map((r) => [r.id, r]));
  for (const e of events) {
    const who = e.recipient_id ? byId.get(e.recipient_id)?.email || '' : owner.email;
    const label = EVENT_LABELS[e.type] || e.type;
    w.text(`${fmt(e.created_at)} · ${label} · ${who}${e.ip ? ` · IP ${e.ip}` : ''}`, { size: 8.5 });
  }
  w.gap(12);
  w.text(
    'Este documento fue sellado digitalmente por DocSure con un certificado X.509. Cualquier modificación posterior invalida el sello. ' +
      `Verificá su integridad en ${siteUrl}/verificar subiendo este archivo.`,
    { size: 9, color: MUTED },
  );
}

export async function buildFinalPdf({ original, fields, envelope, owner, recipients, events, siteUrl, sealP12, sealPassword }) {
  const pdf = await PDFDocument.load(original, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const imageCache = new Map();
  for (const field of fields) {
    const page = pages[field.page - 1];
    if (page) await drawField(pdf, page, field, font, imageCache);
  }
  await addCertificate(pdf, { envelope, owner, recipients, events, siteUrl });
  pdf.setProducer('DocSure');
  pdf.setTitle(envelope.title);
  pdflibAddPlaceholder({
    pdfDoc: pdf,
    reason: 'Sello de integridad DocSure',
    contactInfo: 'soporte@docsure.app',
    name: 'DocSure',
    location: 'docsure.app',
    appName: 'DocSure',
  });
  const unsigned = Buffer.from(await pdf.save({ useObjectStreams: false }));
  return signpdf.sign(unsigned, new P12Signer(sealP12, { passphrase: sealPassword }));
}
