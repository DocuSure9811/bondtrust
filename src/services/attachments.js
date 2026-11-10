import { PDFDocument } from 'pdf-lib';
import { inspectPdf } from '../pdf/final.js';
import { sha256Hex } from '../security.js';
import { HttpError, cleanText } from '../validate.js';
import { addEvent, assertSession, readableEnvelope, resolveToken } from './envelopes.js';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_PAGES = 20;

/** Detecta el tipo por los primeros bytes (no confía en el encabezado del navegador). */
function sniff(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

/** El firmante sube (o reemplaza) el archivo de un campo "adjunto" antes de finalizar. */
export async function uploadAttachment(ctx, token, session, fieldId, { name, bytes }, meta) {
  const r = await resolveToken(ctx, token);
  assertSession(ctx, r, session);
  if (!/^[0-9a-f-]{36}$/i.test(String(fieldId))) throw new HttpError(404, 'Campo no encontrado.', 'not_found');
  const { rows: [field] } = await ctx.pool.query(`SELECT id, type FROM fields WHERE id = $1 AND recipient_id = $2 AND type IN ('attachment', 'image')`, [fieldId, r.id]);
  if (!field) throw new HttpError(404, 'Campo no encontrado.', 'not_found');
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new HttpError(400, 'Elegí un archivo.', 'validation');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'El archivo supera 5 MB.', 'too_large');
  const type = sniff(bytes);
  if (!type) throw new HttpError(415, 'El adjunto tiene que ser una imagen PNG o JPG, o un PDF.', 'invalid_file');
  if (field.type === 'image' && type === 'application/pdf') throw new HttpError(415, 'Este campo necesita una imagen PNG o JPG.', 'invalid_file');
  if (type === 'application/pdf') {
    const { pageCount } = await inspectPdf(bytes);
    if (pageCount > MAX_ATTACHMENT_PAGES) throw new HttpError(400, `El PDF adjunto puede tener hasta ${MAX_ATTACHMENT_PAGES} páginas.`, 'validation');
  } else {
    // Se prueba ahora para que el documento final nunca falle por una imagen ilegible.
    try {
      const probe = await PDFDocument.create();
      await (type === 'image/png' ? probe.embedPng(bytes) : probe.embedJpg(bytes));
    } catch {
      throw new HttpError(400, 'No se pudo leer la imagen. Probá con otra foto o exportala como JPG.', 'invalid_file');
    }
  }
  const clean = cleanText(String(name || 'adjunto').replace(/[\\/]/g, '_'), { max: 120, field: 'el nombre del archivo' });
  const { rows: [a] } = await ctx.pool.query(
    `INSERT INTO attachments (envelope_id, field_id, recipient_id, name, content_type, size, sha256, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (field_id) DO UPDATE SET name = EXCLUDED.name, content_type = EXCLUDED.content_type, size = EXCLUDED.size,
       sha256 = EXCLUDED.sha256, data = EXCLUDED.data, created_at = now()
     RETURNING id, name, size, content_type`,
    [r.envelope_id, field.id, r.id, clean, type, bytes.length, sha256Hex(bytes), bytes],
  );
  await addEvent(ctx.pool, r.envelope_id, 'attachment_uploaded', { recipientId: r.id, ...meta, data: { name: clean } });
  return a;
}

export async function listAttachments(db, envelopeId) {
  const { rows } = await db.query(
    `SELECT a.id, a.field_id, a.recipient_id, a.name, a.content_type, a.size, a.sha256, a.created_at, f.label
       FROM attachments a JOIN fields f ON f.id = a.field_id WHERE a.envelope_id = $1 ORDER BY a.created_at`,
    [envelopeId],
  );
  return rows;
}

export async function ownerAttachment(ctx, ownerId, envelopeId, attachmentId) {
  await readableEnvelope(ctx.pool, ownerId, envelopeId);
  if (!/^[0-9a-f-]{36}$/i.test(String(attachmentId))) throw new HttpError(404, 'Adjunto no encontrado.', 'not_found');
  const { rows: [a] } = await ctx.pool.query('SELECT name, content_type, data FROM attachments WHERE id = $1 AND envelope_id = $2', [attachmentId, envelopeId]);
  if (!a) throw new HttpError(404, 'Adjunto no encontrado.', 'not_found');
  return a;
}
