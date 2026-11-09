import * as pdfjsLib from '/vendor/pdfjs-dist/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs-dist/build/pdf.worker.min.mjs';

/** Dibuja cada página del PDF en un contenedor. Devuelve los envoltorios de página (posicionables). */
export async function renderPdf(bytes, container, { maxWidth = 900 } = {}) {
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
    const label = document.createElement('span');
    label.className = 'page-label';
    label.textContent = `Página ${i} de ${pdf.numPages}`;
    wrap.append(label, canvas);
    container.appendChild(wrap);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    wraps.push(wrap);
  }
  return wraps;
}
