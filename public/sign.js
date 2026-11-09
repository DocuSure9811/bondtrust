import { api, esc } from './app-common.js';
import { renderPdf } from './pdfview.js';

const token = location.pathname.split('/').pop();
const root = document.getElementById('sign-root');
const info = document.getElementById('doc-info');
const base = `/api/firmar/${encodeURIComponent(token)}`;
let session = null;
let data = null;
const values = {};
let signature = null;
let initials = null;

function card(html) {
  root.innerHTML = `<div class="sign-card">${html}</div>`;
}

function fatal(message) {
  card(`<h1>No podés firmar con este enlace</h1><p class="muted">${esc(message)}</p><a class="btn btn-ghost" href="/">Conocé DocSure</a>`);
}

// ---------- 1. Abrir ----------
let meta;
try {
  meta = await api(base);
} catch (err) {
  fatal(err.message);
}

if (meta) {
  document.title = `Firmar: ${meta.title} | DocSure`;
  info.innerHTML = `<strong>${esc(meta.title)}</strong>Enviado por ${esc(meta.senderName)}`;
  identityStep();
}

function identityStep() {
  card(`<h1>Hola ${esc(meta.recipientName)}</h1>
    <p><strong>${esc(meta.senderName)}</strong> te envió <strong>${esc(meta.title)}</strong> para firmar.</p>
    <p class="muted">Para proteger el documento, primero confirmá tu identidad con un código que te enviamos a <strong>${esc(meta.emailMasked)}</strong>.</p>
    <button class="btn btn-primary btn-lg btn-block" id="send-code">Enviarme el código</button>
    <p class="form-error" role="alert" id="err"></p>`);
  document.getElementById('send-code').addEventListener('click', sendCode);
}

async function sendCode() {
  const err = document.getElementById('err');
  const btn = document.getElementById('send-code');
  btn.disabled = true;
  try {
    await api(`${base}/codigo`, { method: 'POST' });
    codeStep();
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
    if (e.code === 'rate_limited') codeStep(e.message);
  }
}

function codeStep(notice = '') {
  card(`<h1>Ingresá el código</h1>
    <p class="muted">Te enviamos un código de 6 dígitos a <strong>${esc(meta.emailMasked)}</strong>. Vence en 10 minutos.</p>
    <form id="code-form" novalidate>
      <label class="visually-hidden" for="code">Código de verificación</label>
      <input id="code" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
      <p class="form-error" role="alert" id="err">${esc(notice)}</p>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Verificar</button>
    </form>
    <p class="fine"><button class="btn btn-ghost btn-sm" type="button" id="resend">Reenviar código</button></p>`);
  const input = document.getElementById('code');
  input.focus();
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
  document.getElementById('resend').addEventListener('click', async () => {
    try {
      await api(`${base}/codigo`, { method: 'POST' });
      document.getElementById('err').textContent = 'Te enviamos un código nuevo.';
    } catch (e) {
      document.getElementById('err').textContent = e.message;
    }
  });
  document.getElementById('code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('err');
    err.textContent = '';
    if (input.value.length !== 6) return void (err.textContent = 'El código tiene 6 dígitos.');
    try {
      const res = await api(`${base}/verificar`, { method: 'POST', body: { code: input.value } });
      session = res.session;
      await documentStep();
    } catch (ex) {
      err.textContent = ex.message;
      input.select();
    }
  });
}

// ---------- 2. Documento ----------
async function documentStep() {
  root.innerHTML = '<p class="muted">Cargando documento…</p>';
  const headers = { 'X-Sign-Session': session };
  const [pdfRes, fieldData] = await Promise.all([api(`${base}/documento`, { raw: true, headers }), api(`${base}/campos`, { headers })]);
  data = fieldData;
  const bytes = await pdfRes.arrayBuffer();
  root.innerHTML = `<p class="muted center">Completá los campos marcados. Al final, aceptá y tocá <strong>Finalizar</strong>.</p><div class="sign-pages" id="pages"></div>`;
  await renderPdf(bytes, document.getElementById('pages'), { maxWidth: 880 });
  placeFields();
  renderBar();
}

function fieldDone(f) {
  if (f.type === 'signature') return Boolean(signature);
  if (f.type === 'initials') return Boolean(initials);
  if (f.type === 'checkbox') return !f.required || values[f.id] === true;
  if (f.type === 'text') return !f.required || Boolean(String(values[f.id] || '').trim());
  return true;
}

function placeFields() {
  for (const f of data.fields) {
    const wrap = document.querySelector(`.page-wrap[data-page="${f.page}"]`);
    if (!wrap) continue;
    let el;
    if (f.type === 'text') {
      el = document.createElement('div');
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 500;
      input.placeholder = f.label || (f.required ? 'Obligatorio' : 'Opcional');
      input.setAttribute('aria-label', f.label || 'Texto');
      input.addEventListener('input', () => { values[f.id] = input.value; update(); });
      el.appendChild(input);
    } else if (f.type === 'checkbox') {
      el = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('aria-label', f.label || 'Casilla');
      input.addEventListener('change', () => { values[f.id] = input.checked; update(); });
      el.appendChild(input);
    } else if (f.type === 'signature' || f.type === 'initials') {
      el = document.createElement('button');
      el.type = 'button';
      el.addEventListener('click', () => openPad(f.type));
    } else {
      el = document.createElement('div');
      el.textContent = f.type === 'date' ? data.today : f.type === 'name' ? data.name : data.email;
    }
    el.classList.add('sbox');
    el.dataset.id = f.id;
    el.dataset.type = f.type;
    el.style.cssText = `left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%`;
    wrap.appendChild(el);
  }
  fitFonts();
  window.addEventListener('resize', fitFonts);
  update();
}

/** Ajusta la letra de cada campo a la altura de su casillero. */
function fitFonts() {
  document.querySelectorAll('.sbox').forEach((el) => {
    const px = `${Math.max(8, Math.min(15, el.clientHeight * 0.62))}px`;
    el.style.fontSize = px;
    const input = el.querySelector('input[type="text"]');
    if (input) input.style.fontSize = px;
  });
}

function update() {
  for (const f of data.fields) {
    const el = document.querySelector(`.sbox[data-id="${f.id}"]`);
    if (!el) continue;
    const done = fieldDone(f);
    el.classList.toggle('filled', done);
    if (done) el.classList.remove('missing');
    if (f.type === 'signature' || f.type === 'initials') {
      const img = f.type === 'signature' ? signature : initials;
      el.innerHTML = img ? `<img alt="${f.type === 'signature' ? 'Tu firma' : 'Tus iniciales'}" src="${img}">` : (f.type === 'signature' ? 'Firmar aquí' : 'Iniciales');
    }
  }
  const total = data.fields.filter((f) => !['date', 'name', 'email'].includes(f.type)).length;
  const done = data.fields.filter((f) => !['date', 'name', 'email'].includes(f.type) && fieldDone(f)).length;
  const p = document.getElementById('progress');
  if (p) p.textContent = `${done} de ${total} campos completos`;
  const barErr = document.getElementById('bar-err');
  if (barErr && done === total && /campos/.test(barErr.textContent)) barErr.textContent = '';
}

function renderBar() {
  const bar = document.createElement('div');
  bar.className = 'sign-bar';
  bar.innerHTML = `<div class="wrap-app sign-bar-row">
    <label class="consent"><input type="checkbox" id="consent"> Acepto firmar electrónicamente este documento y que mi firma electrónica tenga la misma validez que mi firma manuscrita.</label>
    <div class="sign-bar-actions"><span class="progress" id="progress"></span>
      <button class="btn btn-ghost" type="button" id="decline">Rechazar</button>
      <button class="btn btn-primary" type="button" id="finish">Finalizar</button></div>
  </div><p class="form-error wrap-app" role="alert" id="bar-err"></p>`;
  document.body.appendChild(bar);
  update();
  document.getElementById('finish').addEventListener('click', finish);
  document.getElementById('decline').addEventListener('click', openDecline);
}

async function finish() {
  const err = document.getElementById('bar-err');
  err.textContent = '';
  const pending = data.fields.find((f) => !fieldDone(f));
  if (pending) {
    const el = document.querySelector(`.sbox[data-id="${pending.id}"]`);
    el.classList.add('missing');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    err.textContent = 'Completá los campos marcados antes de finalizar.';
    return;
  }
  if (!document.getElementById('consent').checked) {
    err.textContent = 'Marcá la casilla de aceptación para firmar.';
    return;
  }
  const btn = document.getElementById('finish');
  btn.disabled = true;
  btn.textContent = 'Firmando…';
  try {
    await api(`${base}/firmar`, { method: 'POST', headers: { 'X-Sign-Session': session }, body: { signature, initials, values, consent: true } });
    document.querySelector('.sign-bar').remove();
    card(`<span class="ic ic-shield" aria-hidden="true"></span><h1>¡Listo, firmaste!</h1>
      <p class="muted">Cuando todas las partes firmen, te vamos a enviar por email el documento final con su sello digital y el certificado de finalización.</p>
      <a class="btn btn-ghost" href="/">Conocé DocSure</a>`);
    window.scrollTo({ top: 0 });
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
    btn.textContent = 'Finalizar';
    if (e.code === 'session_expired') setTimeout(identityStep, 1500);
  }
}

// ---------- Rechazo ----------
function openDecline() {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form class="modal" method="dialog" id="decline-form"><h2>Rechazar el documento</h2>
    <p class="muted">El remitente va a recibir tu motivo y el sobre se cierra para todos.</p>
    <label>Motivo<textarea id="reason" rows="3" maxlength="500" required></textarea></label>
    <p class="form-error" role="alert" id="decline-err"></p>
    <div class="modal-actions"><button class="btn btn-ghost" value="cancel" type="button" id="decline-cancel">Volver</button><button class="btn btn-danger" type="submit">Rechazar</button></div></form>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.querySelector('#decline-cancel').addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.querySelector('#decline-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = dlg.querySelector('#reason').value.trim();
    if (!reason) return void (dlg.querySelector('#decline-err').textContent = 'Contanos el motivo.');
    try {
      await api(`${base}/rechazar`, { method: 'POST', headers: { 'X-Sign-Session': session }, body: { reason } });
      dlg.close();
      dlg.remove();
      document.querySelector('.sign-bar')?.remove();
      card('<h1>Rechazaste el documento</h1><p class="muted">Le avisamos al remitente. Ya podés cerrar esta ventana.</p>');
    } catch (ex) {
      dlg.querySelector('#decline-err').textContent = ex.message;
    }
  });
}

// ---------- Firma: dibujar o escribir ----------
function trimmedPng(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const px = ctx.getImageData(0, 0, width, height).data;
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
  const pad = 6;
  const out = document.createElement('canvas');
  out.width = maxX - minX + pad * 2;
  out.height = maxY - minY + pad * 2;
  out.getContext('2d').drawImage(canvas, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function openPad(type) {
  const isSig = type === 'signature';
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="modal"><h2>${isSig ? 'Tu firma' : 'Tus iniciales'}</h2>
    <div class="modal-tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-tab="draw">Dibujar</button><button type="button" role="tab" aria-selected="false" data-tab="type">Escribir</button></div>
    <div data-panel="draw"><canvas class="pad" aria-label="Área para dibujar la firma"></canvas><p class="fine">Dibujá con el dedo o el mouse.</p></div>
    <div data-panel="type" hidden><label>Escribí ${isSig ? 'tu nombre' : 'tus iniciales'}<input id="typed" maxlength="${isSig ? 60 : 6}" value="${esc(isSig ? data.name : data.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase())}"></label><div class="typed-preview" id="typed-preview"></div></div>
    <p class="form-error" role="alert" id="pad-err"></p>
    <div class="modal-actions"><button class="btn btn-ghost" type="button" id="pad-clear">Borrar</button><button class="btn btn-ghost" type="button" id="pad-cancel">Cancelar</button><button class="btn btn-primary" type="button" id="pad-ok">Usar ${isSig ? 'esta firma' : 'estas iniciales'}</button></div></div>`;
  document.body.appendChild(dlg);
  dlg.showModal();

  const canvas = dlg.querySelector('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1b2f6b';
  let drawing = false;
  let last = null;
  const point = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; last = point(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(...last);
    ctx.lineTo(...p);
    ctx.stroke();
    last = p;
  });
  canvas.addEventListener('pointerup', () => { drawing = false; });

  let mode = 'draw';
  const typed = dlg.querySelector('#typed');
  const preview = dlg.querySelector('#typed-preview');
  const syncPreview = () => { preview.textContent = typed.value; };
  typed.addEventListener('input', syncPreview);
  syncPreview();
  dlg.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => {
    mode = t.dataset.tab;
    dlg.querySelectorAll('[data-tab]').forEach((o) => o.setAttribute('aria-selected', String(o === t)));
    dlg.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== mode; });
  }));
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector('#pad-cancel').addEventListener('click', close);
  dlg.querySelector('#pad-clear').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    typed.value = '';
    syncPreview();
  });
  dlg.querySelector('#pad-ok').addEventListener('click', () => {
    let png = null;
    if (mode === 'draw') {
      png = trimmedPng(canvas);
    } else if (typed.value.trim()) {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 220;
      const tctx = c.getContext('2d');
      tctx.fillStyle = '#1b2f6b';
      tctx.font = '110px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive';
      tctx.textBaseline = 'middle';
      tctx.fillText(typed.value.trim(), 20, 115, 860);
      png = trimmedPng(c);
    }
    if (!png) return void (dlg.querySelector('#pad-err').textContent = isSig ? 'Dibujá o escribí tu firma.' : 'Dibujá o escribí tus iniciales.');
    if (isSig) signature = png; else initials = png;
    close();
    update();
  });
}
