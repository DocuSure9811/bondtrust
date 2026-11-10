import * as pdfjsLib from '/vendor/pdfjs-dist/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs-dist/build/pdf.worker.min.mjs';

/**
 * Texto de la etiqueta de cada página. Con varios documentos indica a cuál pertenece:
 * "Anexo · página 2 de 3".
 */
export function pageLabeler(documents, word = { page: 'Página', of: 'de' }) {
  return (i, total) => {
    if (!documents || documents.length < 2) return `${word.page} ${i} ${word.of} ${total}`;
    let first = 1;
    for (const d of documents) {
      if (i < first + d.pages) return `${d.name} · ${word.page.toLowerCase()} ${i - first + 1} ${word.of} ${d.pages}`;
      first += d.pages;
    }
    return `${word.page} ${i} ${word.of} ${total}`;
  };
}

/** Dibuja cada página del PDF en un contenedor. Devuelve los envoltorios de página (posicionables). */
export async function renderPdf(bytes, container, { maxWidth = 900, label = pageLabeler() } = {}) {
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    standardFontDataUrl: '/vendor/pdfjs-dist/standard_fonts/',
    cMapUrl: '/vendor/pdfjs-dist/cmaps/',
    cMapPacked: true,
  }).promise;
  const width = Math.min(maxWidth, container.clientWidth || maxWidth);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wraps = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (width / base.width) * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.setAttribute('aria-hidden', 'true');
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.style.width = '100%';
    wrap.style.maxWidth = `${width}px`;
    wrap.dataset.page = String(i);
    const tag = document.createElement('span');
    tag.className = 'page-label';
    tag.textContent = label(i, pdf.numPages);
    wrap.append(tag, canvas);
    container.appendChild(wrap);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    wraps.push(wrap);
  }
  return wraps;
}
