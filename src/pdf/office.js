import mammoth from 'mammoth';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { HttpError } from '../validate.js';

/**
 * Word (.docx) a PDF sin programas externos: mammoth extrae el contenido como HTML simple
 * (títulos, párrafos, negrita, cursiva, listas, tablas e imágenes) y acá se compone un PDF A4.
 */
const PAGE = [595.28, 841.89];
const MARGIN = 56;
const WIDTH = PAGE[0] - MARGIN * 2;
const INK = rgb(0.09, 0.13, 0.17);
const LINE = rgb(0.75, 0.78, 0.82);
const SIZES = { p: 11, h1: 20, h2: 16, h3: 13.5, h4: 12, h5: 11, h6: 11 };

/** Detecta documentos de Word por su contenido. Solo .docx se convierte; los formatos viejos piden guardarse como .docx. */
export function officeKind(bytes) {
  if (!bytes || bytes.length < 8) return null;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const head = bytes.subarray(0, Math.min(bytes.length, 64 * 1024)).toString('latin1');
    if (head.includes('word/')) return 'docx';
    if (head.includes('application/vnd.oasis.opendocument.text')) return 'odt';
    return null;
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'doc';
  if (bytes.subarray(0, 5).toString('latin1') === '{\\rtf') return 'rtf';
  return null;
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/** Convierte el HTML de mammoth en bloques: { kind, runs: [{ text, bold, italic }], level, cells, image }. */
function blocksFrom(html) {
  const blocks = [];
  const lists = [];
  let current = null;
  let bold = 0;
  let italic = 0;
  let table = null;
  let row = null;
  let cell = null;
  const start = (kind, extra = {}) => { current = { kind, runs: [], ...extra }; };
  const flush = () => {
    if (!current) return;
    if (cell) cell.push(current);
    else if (current.runs.some((r) => r.text.trim()) || current.image) blocks.push(current);
    current = null;
  };
  const tokens = html.match(/<[^>]+>|[^<]+/g) || [];
  for (const tok of tokens) {
    if (!tok.startsWith('<')) {
      if (!current) start('p');
      current.runs.push({ text: decode(tok), bold: bold > 0, italic: italic > 0 });
      continue;
    }
    const m = tok.match(/^<(\/?)([a-z0-9]+)/i);
    if (!m) continue;
    const [, close, tag] = [m[0], m[1] === '/', m[2].toLowerCase()];
    if (/^(p|h[1-6])$/.test(tag)) {
      if (close) flush(); else { flush(); start(tag === 'p' ? 'p' : tag); }
    } else if (tag === 'strong' || tag === 'b') bold += close ? -1 : 1;
    else if (tag === 'em' || tag === 'i') italic += close ? -1 : 1;
    else if (tag === 'br') { if (current) current.runs.push({ text: '\n', bold: false, italic: false }); }
    else if (tag === 'ul' || tag === 'ol') { flush(); if (close) lists.pop(); else lists.push({ ordered: tag === 'ol', n: 0 }); }
    else if (tag === 'li') {
      if (close) flush();
      else {
        flush();
        const list = lists[lists.length - 1] || { ordered: false, n: 0 };
        list.n += 1;
        start('li', { level: Math.max(0, lists.length - 1), marker: list.ordered ? `${list.n}.` : '•' });
      }
    } else if (tag === 'table') { flush(); if (close) { if (table?.length) blocks.push({ kind: 'table', rows: table }); table = null; } else table = []; }
    else if (tag === 'tr') { if (close) { if (row && table) table.push(row); row = null; } else row = []; }
    else if (tag === 'td' || tag === 'th') {
      if (close) { flush(); if (row) row.push(cell || []); cell = null; } else { cell = []; }
    } else if (tag === 'img' && !close) {
      const src = tok.match(/src="data:(image\/(?:png|jpeg));base64,([^"]+)"/);
      if (src) { flush(); blocks.push({ kind: 'img', runs: [], image: { type: src[1], data: Buffer.from(src[2], 'base64') } }); }
    }
  }
  flush();
  return blocks;
}

class Composer {
  constructor(pdf, fonts) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage(PAGE);
    this.y = PAGE[1] - MARGIN;
  }

  font(run) {
    return run.bold && run.italic ? this.fonts.bi : run.bold ? this.fonts.b : run.italic ? this.fonts.i : this.fonts.r;
  }

  /** Solo caracteres que las fuentes estándar pueden dibujar (WinAnsi). */
  safe(font, text) {
    let out = '';
    for (const ch of text) {
      try { font.encodeText(ch); out += ch; } catch { out += ch === '\t' ? '    ' : '?'; }
    }
    return out;
  }

  /** Arma líneas con palabras de distintos estilos sin pasarse del ancho. */
  lines(runs, size, width) {
    const words = [];
    for (const run of runs) {
      for (const part of run.text.split(/(\n| +)/)) {
        if (part === '\n') words.push({ br: true });
        else if (part) words.push({ text: this.safe(this.font(run), part), font: this.font(run), space: /^ +$/.test(part) });
      }
    }
    const out = [];
    let line = [];
    let w = 0;
    for (const word of words) {
      if (word.br) { out.push(line); line = []; w = 0; continue; }
      const ww = word.font.widthOfTextAtSize(word.text, size);
      if (w + ww > width && line.length && !word.space) { out.push(line); line = []; w = 0; }
      if (word.space && !line.length) continue;
      if (ww > width) {
        // Palabra más larga que la línea: se corta.
        let chunk = '';
        for (const ch of word.text) {
          if (word.font.widthOfTextAtSize(chunk + ch, size) > width) { out.push([{ ...word, text: chunk }]); chunk = ''; }
          chunk += ch;
        }
        line = [{ ...word, text: chunk }];
        w = word.font.widthOfTextAtSize(chunk, size);
        continue;
      }
      line.push({ ...word, w: ww });
      w += ww;
    }
    if (line.length) out.push(line);
    return out;
  }

  paragraph(runs, { size = 11, indent = 0, marker = null, after = 6 } = {}) {
    const lh = size * 1.4;
    const lines = this.lines(runs, size, WIDTH - indent);
    lines.forEach((line, i) => {
      if (this.y - lh < MARGIN) this.newPage();
      this.y -= lh;
      if (i === 0 && marker) this.page.drawText(this.safe(this.fonts.r, marker), { x: MARGIN + indent - 14, y: this.y, size, font: this.fonts.r, color: INK });
      let x = MARGIN + indent;
      for (const word of line) {
        if (!word.space) this.page.drawText(word.text, { x, y: this.y, size, font: word.font, color: INK });
        x += word.w ?? word.font.widthOfTextAtSize(word.text, size);
      }
    });
    this.y -= after;
  }

  async image({ type, data }) {
    let img;
    try {
      img = type === 'image/png' ? await this.pdf.embedPng(data) : await this.pdf.embedJpg(data);
    } catch {
      return;
    }
    const scale = Math.min(1, WIDTH / img.width, (PAGE[1] - MARGIN * 2) / img.height);
    const h = img.height * scale;
    if (this.y - h < MARGIN) this.newPage();
    this.y -= h;
    this.page.drawImage(img, { x: MARGIN, y: this.y, width: img.width * scale, height: h });
    this.y -= 8;
  }

  table(rows) {
    const cols = Math.max(...rows.map((r) => r.length));
    const cw = WIDTH / cols;
    const size = 9.5;
    const lh = size * 1.35;
    for (const row of rows) {
      const cellLines = row.map((paras) => paras.flatMap((p) => this.lines(p.runs, size, cw - 8)));
      const h = Math.max(1, ...cellLines.map((l) => l.length)) * lh + 8;
      if (this.y - h < MARGIN) this.newPage();
      const top = this.y;
      cellLines.forEach((lines, c) => {
        const x0 = MARGIN + c * cw;
        this.page.drawRectangle({ x: x0, y: top - h, width: cw, height: h, borderColor: LINE, borderWidth: 0.6 });
        lines.forEach((line, i) => {
          let x = x0 + 4;
          for (const word of line) {
            if (!word.space) this.page.drawText(word.text, { x, y: top - 4 - lh * (i + 1) + 3, size, font: word.font, color: INK });
            x += word.w ?? word.font.widthOfTextAtSize(word.text, size);
          }
        });
      });
      this.y = top - h;
    }
    this.y -= 10;
  }
}

/** Convierte un .docx a PDF. Los formatos .doc, .odt y .rtf piden guardarse como .docx o PDF. */
export async function officeToPdf(bytes, kind) {
  if (kind !== 'docx') throw new HttpError(415, 'Ese formato de Word es antiguo. Guardalo como .docx o PDF y subilo de nuevo.', 'office_format');
  let html;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer: bytes }));
  } catch {
    throw new HttpError(400, 'No se pudo leer el documento de Word. Exportalo como PDF y subilo.', 'office_failed');
  }
  const blocks = blocksFrom(html);
  if (!blocks.length) throw new HttpError(400, 'El documento de Word está vacío.', 'office_failed');
  const pdf = await PDFDocument.create();
  const fonts = {
    r: await pdf.embedFont(StandardFonts.Helvetica),
    b: await pdf.embedFont(StandardFonts.HelveticaBold),
    i: await pdf.embedFont(StandardFonts.HelveticaOblique),
    bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const out = new Composer(pdf, fonts);
  for (const block of blocks) {
    if (block.kind === 'table') out.table(block.rows);
    else if (block.kind === 'img') await out.image(block.image);
    else if (block.kind === 'li') out.paragraph(block.runs, { indent: 18 + block.level * 18, marker: block.marker, after: 2 });
    else {
      const heading = block.kind !== 'p';
      out.paragraph(heading ? block.runs.map((r) => ({ ...r, bold: true })) : block.runs, { size: SIZES[block.kind], after: heading ? 8 : 6 });
    }
    if (pdf.getPageCount() > 200) throw new HttpError(400, 'El documento de Word supera 200 páginas.', 'office_failed');
  }
  pdf.setProducer('DocSure');
  return Buffer.from(await pdf.save());
}
