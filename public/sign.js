import { api, esc } from './app-common.js';
import { evaluateFormula, formatNumber, parseNumber } from './formula.js';
import { pageLabeler, renderPdf } from './pdfview.js';
import { DICT, pickLang } from './sign-i18n.js';

const token = location.pathname.split('/').pop();
const root = document.getElementById('sign-root');
const info = document.getElementById('doc-info');
const base = `/api/firmar/${encodeURIComponent(token)}`;
let session = null;
let data = null;
let meta = null;
let lang = pickLang();
let t = DICT[lang];
let step = 'identity';
const values = {};
const files = {};
let signature = null;
let initials = null;

/** Mensaje de error en el idioma del firmante (el español usa el texto detallado del servidor). */
const errMsg = (e) => (lang === 'es' ? e.message : t.errors[e.code] || e.message);

function card(html) {
  root.innerHTML = `<div class="sign-card">${html}</div>`;
}

function fatal(e) {
  card(`<h1>${t.cantSign}</h1><p class="muted">${esc(errMsg(e))}</p><a class="btn btn-ghost" href="/">${t.knowDocsure}</a>`);
}

function header() {
  const b = meta.brand || {};
  const brand = b.logoUrl ? `<img alt="${esc(b.name)}" src="${esc(b.logoUrl)}">` : esc(b.name && b.name !== 'DocSure' ? b.name : '');
  info.innerHTML = `<strong>${esc(meta.title)}</strong>${esc(t.sentBy(meta.senderName))}`;
  const brandBox = document.querySelector('.sign-brand');
  if (brandBox) brandBox.innerHTML = brand;
  if (/^#[0-9a-f]{6}$/i.test(b.color || '')) {
    document.documentElement.style.setProperty('--brand', b.color);
    document.documentElement.style.setProperty('--brand-600', b.color);
  }
  let sw = document.querySelector('.lang-switch');
  if (!sw) {
    sw = document.createElement('div');
    sw.className = 'lang-switch';
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', 'Idioma / Language');
    document.querySelector('.sign-header-row').appendChild(sw);
    sw.addEventListener('click', (e) => {
      const l = e.target.dataset?.lang;
      if (!l || l === lang) return;
      setLang(l);
    });
  }
  sw.innerHTML = ['es', 'en', 'pt'].map((l) => `<button type="button" data-lang="${l}" aria-pressed="${l === lang}">${l.toUpperCase()}</button>`).join('');
  document.documentElement.lang = lang;
}

function setLang(l) {
  lang = l;
  t = DICT[l];
  header();
  if (step === 'identity') identityStep();
  else if (step === 'code') codeStep();
  else if (step === 'document') {
    document.getElementById('instructions').innerHTML = t.instructions;
    document.querySelector('.sign-bar')?.remove();
    document.querySelectorAll('.sbox').forEach((el) => el.remove());
    placeFields();
    renderBar();
  }
}

// ---------- 1. Abrir ----------
try {
  meta = await api(base);
} catch (err) {
  fatal(err);
}

if (meta) {
  lang = pickLang(meta.language);
  t = DICT[lang];
  document.title = `${meta.title} | DocSure`;
  const logo = document.querySelector('.sign-header .logo');
  logo.insertAdjacentHTML('afterend', '<span class="sign-brand"></span>');
  header();
  if (meta.inPerson) inPersonStep();
  else identityStep();
}

function inPersonStep() {
  step = 'identity';
  card(`<span class="ic ic-shield" aria-hidden="true"></span><h1>${t.inPersonTitle}</h1>
    <p>${t.inPersonText(esc(meta.recipientName))}</p>
    <button class="btn btn-primary btn-lg btn-block" id="start">${t.inPersonStart}</button>
    <p class="form-error" role="alert" id="err"></p>`);
  document.getElementById('start').addEventListener('click', async () => {
    try {
      session = (await api(`${base}/presencial`, { method: 'POST' })).session;
      await documentStep();
    } catch (e) {
      document.getElementById('err').textContent = errMsg(e);
    }
  });
}

function identityStep() {
  step = 'identity';
  if (meta.inPerson) return inPersonStep();
  card(`<h1>${esc(t.hello(meta.recipientName))}</h1>
    <p>${t.sentYou(esc(meta.senderName), esc(meta.title))}</p>
    <p class="muted">${t.protect(esc(meta.emailMasked))}</p>
    <button class="btn btn-primary btn-lg btn-block" id="send-code">${t.sendCode}</button>
    <p class="form-error" role="alert" id="err"></p>`);
  document.getElementById('send-code').addEventListener('click', sendCode);
}

async function sendCode() {
  const btn = document.getElementById('send-code');
  btn.disabled = true;
  try {
    await api(`${base}/codigo`, { method: 'POST' });
    codeStep();
  } catch (e) {
    document.getElementById('err').textContent = errMsg(e);
    btn.disabled = false;
    if (e.code === 'rate_limited') codeStep(errMsg(e));
  }
}

function codeStep(notice = '') {
  step = 'code';
  card(`<h1>${t.enterCode}</h1>
    <p class="muted">${t.codeSent(esc(meta.emailMasked))}</p>
    <form id="code-form" novalidate>
      <label class="visually-hidden" for="code">${t.codeLabel}</label>
      <input id="code" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
      <p class="form-error" role="alert" id="err">${esc(notice)}</p>
      <button class="btn btn-primary btn-lg btn-block" type="submit">${t.verify}</button>
    </form>
    <p class="fine"><button class="btn btn-ghost btn-sm" type="button" id="resend">${t.resendCode}</button></p>`);
  const input = document.getElementById('code');
  input.focus();
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
  document.getElementById('resend').addEventListener('click', async () => {
    try {
      await api(`${base}/codigo`, { method: 'POST' });
      document.getElementById('err').textContent = t.codeResent;
    } catch (e) {
      document.getElementById('err').textContent = errMsg(e);
    }
  });
  document.getElementById('code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('err');
    err.textContent = '';
    if (input.value.length !== 6) return void (err.textContent = t.codeDigits);
    try {
      session = (await api(`${base}/verificar`, { method: 'POST', body: { code: input.value } })).session;
      await documentStep();
    } catch (ex) {
      err.textContent = errMsg(ex);
      input.select();
    }
  });
}

// ---------- 2. Documento ----------
async function documentStep() {
  step = 'document';
  root.innerHTML = `<p class="muted">${t.loadingDoc}</p>`;
  const headers = { 'X-Sign-Session': session };
  const [pdfRes, fieldData] = await Promise.all([api(`${base}/documento`, { raw: true, headers }), api(`${base}/campos`, { headers })]);
  data = fieldData;
  for (const a of data.attachments || []) files[a.field_id] = a.name;
  const bytes = await pdfRes.arrayBuffer();
  root.innerHTML = `<p class="muted center" id="instructions">${t.instructions}</p><div class="sign-pages" id="pages"></div>`;
  await renderPdf(bytes, document.getElementById('pages'), { maxWidth: 880, label: pageLabeler(data.documents, t.pageWord) });
  placeFields();
  renderBar();
}

const FORMATS = {
  email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, mode: 'email' },
  number: { re: /^-?\d+([.,]\d+)?$/, mode: 'decimal' },
  id: { re: /^[0-9A-Za-z.\- ]{5,20}$/, mode: 'text' },
  phone: { re: /^\+?[\d\s().-]{7,20}$/, mode: 'tel' },
};

/** Valor que controla las condiciones (igual que en el servidor). */
function rawValue(f) {
  if (f.type === 'checkbox') return values[f.id] === true ? 'true' : 'false';
  if (f.type === 'select' || f.type === 'radio' || f.type === 'text') return String(values[f.id] || '').trim();
  return '';
}

/** Campos visibles según las respuestas actuales: un campo condicional se ve si su campo de control tiene el valor indicado. */
function visibleIds() {
  const byId = new Map(data.fields.map((f) => [f.id, f]));
  const memo = new Map();
  const visible = (f) => {
    if (memo.has(f.id)) return memo.get(f.id);
    memo.set(f.id, false);
    const parent = f.cond_field_id ? byId.get(f.cond_field_id) : null;
    const v = !f.cond_field_id || (parent ? visible(parent) && rawValue(parent) === f.cond_value : true);
    memo.set(f.id, v);
    return v;
  };
  return new Set(data.fields.filter(visible).map((f) => f.id));
}

function numberValue(f) {
  if (!f.formula) return parseNumber(values[f.id]);
  const byLabel = new Map(data.fields.filter((x) => x.type === 'number' && x.label).map((x) => [x.label.toLowerCase(), x]));
  try {
    return evaluateFormula(f.formula, (name) => {
      const ref = byLabel.get(name);
      return ref && ref !== f ? numberValue(ref) || 0 : 0;
    });
  } catch {
    return null;
  }
}

/** Ventana para elegir opciones (única o múltiple) o escribir el nombre del sello. */
function choiceDialog(f, el) {
  const multiple = f.type === 'multiple';
  const dlg = document.createElement('dialog');
  const current = multiple ? values[f.id] || [] : values[f.id] || '';
  const body = f.type === 'stamp'
    ? `<label>${t.stampCompany}<input id="ch-stamp" maxlength="80" value="${esc(current)}" autocomplete="organization"></label><p class="muted small">${t.stampHint}</p>`
    : `<fieldset class="choices"><legend class="visually-hidden">${esc(f.label || t.chooseOption)}</legend>${(f.options || []).map((o, i) => `<label class="choice"><input type="${multiple ? 'checkbox' : 'radio'}" name="ch" value="${esc(o)}" id="ch-${i}"${(multiple ? current.includes(o) : current === o) ? ' checked' : ''}> ${esc(o)}</label>`).join('')}</fieldset>`;
  dlg.innerHTML = `<form class="modal" method="dialog"><h2>${esc(f.label || (f.type === 'stamp' ? t.stampTitle : t.chooseOption))}</h2>${body}
    <div class="modal-actions"><button class="btn btn-ghost" value="cancel">${t.cancel}</button><button class="btn btn-primary" value="ok">${t.ok}</button></div></form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') {
      if (f.type === 'stamp') values[f.id] = dlg.querySelector('#ch-stamp').value.trim();
      else if (multiple) values[f.id] = [...dlg.querySelectorAll('input:checked')].map((i) => i.value);
      else values[f.id] = dlg.querySelector('input:checked')?.value || '';
      update();
    }
    dlg.remove();
    el.focus();
  });
  dlg.showModal();
}

function formatOk(f) {
  const v = String(values[f.id] || '').trim();
  return !v || !f.validation || !FORMATS[f.validation] || FORMATS[f.validation].re.test(v);
}

function fieldDone(f) {
  if (f.type === 'signature') return Boolean(signature);
  if (f.type === 'initials') return Boolean(initials);
  if (f.type === 'checkbox') return !f.required || values[f.id] === true;
  if (f.type === 'text') return (!f.required || Boolean(String(values[f.id] || '').trim())) && formatOk(f);
  if (f.type === 'select') return !f.required || Boolean(values[f.id]);
  if (f.type === 'attachment' || f.type === 'image') return !f.required || Boolean(files[f.id]);
  if (f.type === 'radio' || f.type === 'stamp') return !f.required || Boolean(String(values[f.id] || '').trim());
  if (f.type === 'multiple') return !f.required || (values[f.id] || []).length > 0;
  if (f.type === 'phone') return (!f.required || Boolean(String(values[f.id] || '').trim())) && (!String(values[f.id] || '').trim() || FORMATS.phone.re.test(String(values[f.id]).trim()));
  if (f.type === 'number') {
    if (f.formula) return true;
    const n = parseNumber(values[f.id]);
    return !Number.isNaN(n) && (!f.required || n !== null);
  }
  return true;
}

/** El firmante elige un archivo (foto o PDF) y se sube enseguida; puede reemplazarlo antes de finalizar. */
function pickFile(f, el) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = f.type === 'image' ? 'image/png,image/jpeg' : 'image/png,image/jpeg,application/pdf';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    const err = document.getElementById('bar-err');
    if (!file) return;
    err.textContent = '';
    if (file.size > 5 * 1024 * 1024) {
      err.dataset.kind = 'file';
      err.textContent = t.fileTooBig;
      return;
    }
    el.dataset.busy = '1';
    el.textContent = t.uploading;
    try {
      const res = await fetch(`${base}/adjuntos/${f.id}`, {
        method: 'PUT',
        headers: { 'X-DocSure': '1', 'X-Sign-Session': session, 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body.error || t.uploadFailed), { code: body.code });
      files[f.id] = body.name;
    } catch (e) {
      err.dataset.kind = 'file';
      err.textContent = errMsg(e);
    } finally {
      delete el.dataset.busy;
      update();
    }
  });
  input.click();
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
      input.value = values[f.id] || '';
      input.placeholder = f.label || (f.required ? t.required : t.optional);
      input.setAttribute('aria-label', f.label || t.text);
      if (FORMATS[f.validation]) input.inputMode = FORMATS[f.validation].mode;
      input.addEventListener('input', () => { values[f.id] = input.value; update(); });
      el.appendChild(input);
    } else if (f.type === 'select') {
      el = document.createElement('div');
      const select = document.createElement('select');
      select.setAttribute('aria-label', f.label || t.chooseOption);
      select.innerHTML = `<option value="">${esc(f.label || t.chooseOption)}</option>${(f.options || []).map((o) => `<option${values[f.id] === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}`;
      select.addEventListener('change', () => { values[f.id] = select.value; update(); });
      el.appendChild(select);
    } else if (f.type === 'checkbox') {
      el = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = values[f.id] === true;
      input.setAttribute('aria-label', f.label || t.checkbox);
      input.addEventListener('change', () => { values[f.id] = input.checked; update(); });
      el.appendChild(input);
    } else if (f.type === 'attachment' || f.type === 'image') {
      el = document.createElement('button');
      el.type = 'button';
      el.addEventListener('click', () => pickFile(f, el));
    } else if (f.type === 'radio' || f.type === 'multiple' || f.type === 'stamp') {
      el = document.createElement('button');
      el.type = 'button';
      el.addEventListener('click', () => choiceDialog(f, el));
    } else if (f.type === 'number' && f.formula) {
      el = document.createElement('div');
      el.setAttribute('aria-live', 'polite');
      el.title = t.calculated;
    } else if (f.type === 'number' || f.type === 'phone') {
      el = document.createElement('div');
      const input = document.createElement('input');
      input.type = f.type === 'phone' ? 'tel' : 'text';
      input.inputMode = f.type === 'phone' ? 'tel' : 'decimal';
      input.maxLength = f.type === 'phone' ? 30 : 30;
      input.value = values[f.id] || '';
      input.placeholder = f.label || (f.required ? t.required : t.optional);
      input.setAttribute('aria-label', f.label || (f.type === 'phone' ? t.phone : t.number));
      input.addEventListener('input', () => { values[f.id] = input.value; update(); });
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
  window.removeEventListener('resize', fitFonts);
  window.addEventListener('resize', fitFonts);
  update();
}

/** Ajusta la letra de cada campo a la altura de su casillero. */
function fitFonts() {
  document.querySelectorAll('.sbox').forEach((el) => {
    const px = `${Math.max(8, Math.min(15, el.clientHeight * 0.62))}px`;
    el.style.fontSize = px;
    const input = el.querySelector('input[type="text"], input[type="tel"], select');
    if (input) input.style.fontSize = px;
  });
}

function update() {
  const shown = visibleIds();
  for (const f of data.fields) {
    const el = document.querySelector(`.sbox[data-id="${f.id}"]`);
    if (!el) continue;
    el.hidden = !shown.has(f.id);
    el.classList.toggle('invalid', f.type === 'text' && !formatOk(f));
    const done = fieldDone(f);
    el.classList.toggle('filled', done);
    if (done) el.classList.remove('missing');
    if (f.type === 'radio') el.textContent = values[f.id] || `${f.label || t.chooseOption} ▾`;
    if (f.type === 'multiple') el.textContent = (values[f.id] || []).length ? values[f.id].join(', ') : `${f.label || t.chooseOptions} ▾`;
    if (f.type === 'stamp') {
      el.classList.toggle('stamp-on', Boolean(values[f.id]));
      el.innerHTML = values[f.id] ? `<span><strong>${esc(values[f.id])}</strong><br>${esc(data.name)}<br>${esc(data.today)}</span>` : esc(f.label || t.stampTitle);
    }
    if (f.type === 'number' && f.formula) el.textContent = formatNumber(numberValue(f)) || '0';
    if (f.type === 'number' && !f.formula) el.classList.toggle('invalid', Number.isNaN(parseNumber(values[f.id])));
    if ((f.type === 'attachment' || f.type === 'image') && !el.dataset.busy) {
      el.textContent = files[f.id] ? `✓ ${files[f.id]}` : `${t.attach}${f.label ? `: ${f.label}` : ''}`;
      el.title = files[f.id] ? t.replaceFile : t.attachHint;
    }
    if (f.type === 'signature' || f.type === 'initials') {
      const img = f.type === 'signature' ? signature : initials;
      el.innerHTML = img ? `<img alt="${f.type === 'signature' ? t.yourSignatureAlt : t.yourInitialsAlt}" src="${img}">` : (f.type === 'signature' ? t.signHere : t.initialsBox);
    }
  }
  const counted = data.fields.filter((f) => shown.has(f.id) && !['date', 'name', 'email'].includes(f.type));
  const done = counted.filter(fieldDone).length;
  const p = document.getElementById('progress');
  if (p) p.textContent = t.progress(done, counted.length);
  const barErr = document.getElementById('bar-err');
  if (barErr && done === counted.length && barErr.dataset.kind === 'fields') barErr.textContent = '';
}

function renderBar() {
  const bar = document.createElement('div');
  bar.className = 'sign-bar';
  bar.innerHTML = `<div class="wrap-app sign-bar-row">
    <label class="consent"><input type="checkbox" id="consent"> ${t.consent}</label>
    <div class="sign-bar-actions"><span class="progress" id="progress"></span>
      <button class="btn btn-ghost" type="button" id="decline">${t.decline}</button>
      <button class="btn btn-primary" type="button" id="finish">${t.finish}</button></div>
  </div><p class="form-error wrap-app" role="alert" id="bar-err"></p>`;
  document.body.appendChild(bar);
  update();
  document.getElementById('finish').addEventListener('click', finish);
  document.getElementById('decline').addEventListener('click', openDecline);
}

async function finish() {
  const err = document.getElementById('bar-err');
  err.textContent = '';
  const shown = visibleIds();
  const pending = data.fields.find((f) => shown.has(f.id) && !fieldDone(f));
  if (pending) {
    const el = document.querySelector(`.sbox[data-id="${pending.id}"]`);
    el.classList.add('missing');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    err.dataset.kind = 'fields';
    err.textContent = (pending.type === 'text' && !formatOk(pending)) || pending.type === 'number' || pending.type === 'phone' ? t.invalidFormat : t.completeFields;
    return;
  }
  if (!document.getElementById('consent').checked) {
    err.dataset.kind = 'consent';
    err.textContent = t.acceptConsent;
    return;
  }
  const btn = document.getElementById('finish');
  btn.disabled = true;
  btn.textContent = t.signing;
  try {
    await api(`${base}/firmar`, { method: 'POST', headers: { 'X-Sign-Session': session }, body: { signature, initials, values, consent: true } });
    document.querySelector('.sign-bar').remove();
    step = 'done';
    card(`<span class="ic ic-shield" aria-hidden="true"></span><h1>${t.doneTitle}</h1><p class="muted">${t.doneText}</p><a class="btn btn-ghost" href="/">${t.knowDocsure}</a>`);
    window.scrollTo({ top: 0 });
  } catch (e) {
    err.dataset.kind = 'server';
    err.textContent = errMsg(e);
    btn.disabled = false;
    btn.textContent = t.finish;
    if (e.code === 'session_expired') setTimeout(() => { document.querySelector('.sign-bar')?.remove(); identityStep(); }, 1500);
  }
}

// ---------- Rechazo ----------
function openDecline() {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form class="modal" method="dialog" id="decline-form"><h2>${t.declineTitle}</h2>
    <p class="muted">${t.declineText}</p>
    <label>${t.reason}<textarea id="reason" rows="3" maxlength="500" required></textarea></label>
    <p class="form-error" role="alert" id="decline-err"></p>
    <div class="modal-actions"><button class="btn btn-ghost" type="button" id="decline-cancel">${t.back}</button><button class="btn btn-danger" type="submit">${t.decline}</button></div></form>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.querySelector('#decline-cancel').addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.querySelector('#decline-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = dlg.querySelector('#reason').value.trim();
    if (!reason) return void (dlg.querySelector('#decline-err').textContent = t.reasonRequired);
    try {
      await api(`${base}/rechazar`, { method: 'POST', headers: { 'X-Sign-Session': session }, body: { reason } });
      dlg.close();
      dlg.remove();
      document.querySelector('.sign-bar')?.remove();
      step = 'done';
      card(`<h1>${t.declinedTitle}</h1><p class="muted">${t.declinedText}</p>`);
    } catch (ex) {
      dlg.querySelector('#decline-err').textContent = errMsg(ex);
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
  const initialsGuess = data.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase();
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="modal"><h2>${isSig ? t.yourSignature : t.yourInitials}</h2>
    <div class="modal-tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-tab="draw">${t.draw}</button><button type="button" role="tab" aria-selected="false" data-tab="type">${t.type}</button></div>
    <div data-panel="draw"><canvas class="pad" aria-label="${t.padArea}"></canvas><p class="fine">${t.drawHint}</p></div>
    <div data-panel="type" hidden><label>${isSig ? t.typeName : t.typeInitials}<input id="typed" maxlength="${isSig ? 60 : 6}" value="${esc(isSig ? data.name : initialsGuess)}"></label><div class="typed-preview" id="typed-preview"></div></div>
    <p class="form-error" role="alert" id="pad-err"></p>
    <div class="modal-actions"><button class="btn btn-ghost" type="button" id="pad-clear">${t.clear}</button><button class="btn btn-ghost" type="button" id="pad-cancel">${t.cancel}</button><button class="btn btn-primary" type="button" id="pad-ok">${isSig ? t.useSignature : t.useInitials}</button></div></div>`;
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
  dlg.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
    mode = tab.dataset.tab;
    dlg.querySelectorAll('[data-tab]').forEach((o) => o.setAttribute('aria-selected', String(o === tab)));
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
    if (!png) return void (dlg.querySelector('#pad-err').textContent = isSig ? t.needSignature : t.needInitials);
    if (isSig) signature = png; else initials = png;
    close();
    update();
  });
}
