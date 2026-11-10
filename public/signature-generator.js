// Generador de firma: todo ocurre en el navegador, nada se envía al servidor.
const root = document.getElementById('sig-gen');
const canvas = document.getElementById('gen-pad');
const nameInput = document.getElementById('gen-name');
const stylesBox = document.getElementById('gen-styles');
const err = document.getElementById('gen-err');

const STYLES = [
  ['Clásica', '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive'],
  ['Pincel', '"Brush Script MT", "Segoe Script", cursive'],
  ['Caligráfica', '"Lucida Handwriting", "Apple Chancery", "URW Chancery L", cursive'],
  ['Manuscrita', '"Ink Free", "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'],
];
let mode = 'draw';
let color = '#1b2f6b';
let style = 0;

// Lienzo con resolución real de la pantalla.
const ctx = canvas.getContext('2d');
function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  if (canvas.width) copy.getContext('2d').drawImage(canvas, 0, 0);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (copy.width) ctx.drawImage(copy, 0, 0, copy.width / dpr, copy.height / dpr);
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}
sizeCanvas();
window.addEventListener('resize', sizeCanvas);

let drawing = false;
let last = null;
const point = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
canvas.addEventListener('pointerdown', (e) => { drawing = true; last = point(e); canvas.setPointerCapture(e.pointerId); err.textContent = ''; });
canvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const p = point(e);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(...last);
  ctx.lineTo(...p);
  ctx.stroke();
  last = p;
});
canvas.addEventListener('pointerup', () => { drawing = false; });

function renderStyles() {
  const text = nameInput.value.trim() || 'Tu firma';
  stylesBox.replaceChildren(...STYLES.map(([label, font], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === style));
    b.setAttribute('aria-label', label);
    b.className = 'gen-style';
    b.style.fontFamily = font;
    b.style.color = color;
    b.textContent = text;
    b.addEventListener('click', () => { style = i; renderStyles(); });
    return b;
  }));
}
nameInput.addEventListener('input', () => { err.textContent = ''; renderStyles(); });
renderStyles();

root.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
  mode = tab.dataset.tab;
  root.querySelectorAll('[data-tab]').forEach((o) => o.setAttribute('aria-selected', String(o === tab)));
  root.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== mode; });
  if (mode === 'draw') sizeCanvas(); else nameInput.focus();
  err.textContent = '';
}));

root.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
  color = b.dataset.color;
  root.querySelectorAll('[data-color]').forEach((o) => o.setAttribute('aria-checked', String(o === b)));
  renderStyles();
}));

document.getElementById('gen-clear').addEventListener('click', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  nameInput.value = '';
  renderStyles();
  err.textContent = '';
});

/** Recorta al contenido dibujado y deja el fondo transparente. */
function trimmed(source) {
  const sctx = source.getContext('2d');
  const { width, height } = source;
  const px = sctx.getImageData(0, 0, width, height).data;
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (px[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 12;
  const out = document.createElement('canvas');
  out.width = maxX - minX + pad * 2;
  out.height = maxY - minY + pad * 2;
  out.getContext('2d').drawImage(source, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

document.getElementById('gen-download').addEventListener('click', () => {
  let out = null;
  if (mode === 'draw') {
    out = trimmed(canvas);
  } else if (nameInput.value.trim()) {
    const c = document.createElement('canvas');
    c.width = 1400;
    c.height = 320;
    const tctx = c.getContext('2d');
    tctx.fillStyle = color;
    tctx.font = `160px ${STYLES[style][1]}`;
    tctx.textBaseline = 'middle';
    tctx.fillText(nameInput.value.trim(), 30, 165, 1340);
    out = trimmed(c);
  }
  if (!out) {
    err.textContent = mode === 'draw' ? 'Dibujá tu firma primero.' : 'Escribí tu nombre primero.';
    return;
  }
  const a = document.createElement('a');
  a.href = out.toDataURL('image/png');
  a.download = 'mi-firma.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
});
