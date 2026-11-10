import { api, esc } from './app-common.js';
import { renderPdf } from './pdfview.js';

const COLORS = ['--signer-0', '--signer-1', '--signer-2', '--signer-3', '--signer-4', '--signer-5'];
const TYPE_LABEL = { signature: 'Firma', initials: 'Iniciales', date: 'Fecha', name: 'Nombre', email: 'Email', text: 'Texto', checkbox: '☐' };
const DEFAULT_SIZE = { signature: [0.26, 0.06], initials: [0.1, 0.05], date: [0.18, 0.03], name: [0.26, 0.03], email: [0.3, 0.03], text: [0.26, 0.03], checkbox: [0.028, 0.02] };

const state = {
  id: null,
  pdf: null,
  title: '',
  message: '',
  sequential: false,
  recipients: [],
  fields: [],
  selected: null,
  activeType: 'signature',
  owner: null,
  rendered: false,
  idempotencyKey: crypto.randomUUID(),
};
let keySeq = 0;
const newKey = () => `r${Date.now().toString(36)}${(keySeq += 1)}`;
const $ = (id) => document.getElementById(id);

// ---------- Navegación entre pasos ----------
function go(step) {
  document.querySelectorAll('.step').forEach((s) => { s.hidden = s.dataset.step !== String(step); });
  [...$('wizard').children].forEach((li, i) => {
    li.classList.toggle('active', i === step - 1);
    li.classList.toggle('done', i < step - 1);
  });
  window.scrollTo({ top: 0 });
  if (step === 3) enterFields();
  if (step === 4) renderReview();
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.go))));

function colorOf(key) {
  const signers = state.recipients.filter((r) => r.role === 'signer');
  const i = Math.max(0, signers.findIndex((r) => r.key === key));
  return `var(${COLORS[i % COLORS.length]})`;
}

async function saveDraft() {
  state.title = $('title').value.trim() || state.title;
  state.message = $('message').value.trim();
  state.sequential = $('sequential').checked;
  await api(`/api/sobres/${state.id}`, {
    method: 'PUT',
    body: {
      title: state.title,
      message: state.message,
      sequential: state.sequential,
      language: $('opt-language').value,
      expire_days: Number($('opt-expire').value),
      reminder_days: Number($('opt-reminder').value),
      recipients: state.recipients.map((r, i) => ({ key: r.key, name: r.name, email: r.email, role: r.role, order: state.sequential ? Number(r.order) || i + 1 : 1 })),
      fields: state.fields.map(({ recipientKey, type, page, x, y, w, h, required, label }) => ({ recipientKey, type, page, x, y, w, h, required, label })),
    },
  });
}

// ---------- Paso 1: documento ----------
async function handleFile(file) {
  const err = $('err1');
  err.textContent = '';
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    err.textContent = 'Elegí un archivo PDF.';
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    err.textContent = 'El PDF supera 15 MB.';
    return;
  }
  const title = $('title').value.trim() || file.name.replace(/\.pdf$/i, '').slice(0, 160);
  $('title').value = title;
  const bytes = await file.arrayBuffer();
  const label = document.querySelector('#drop .dropzone-label strong');
  label.textContent = 'Subiendo…';
  try {
    const res = await api(`/api/sobres?title=${encodeURIComponent(title)}`, { method: 'POST', body: bytes });
    state.id = res.id;
    state.pdf = bytes;
    state.title = title;
    state.fields = [];
    state.selected = null;
    state.rendered = false;
    state.idempotencyKey = crypto.randomUUID();
    history.replaceState(null, '', `/app/nuevo?id=${res.id}`);
    if (state.recipients.length === 0) addRecipient();
    go(2);
  } catch (e) {
    err.textContent = e.message;
  } finally {
    label.textContent = 'Elegí o arrastrá un PDF';
  }
}
$('file').addEventListener('change', (e) => handleFile(e.target.files[0]));
const drop = $('drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('drag')));
drop.addEventListener('drop', (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });

// ---------- Paso 2: destinatarios ----------
function addRecipient(data = {}) {
  state.recipients.push({ key: data.key || newKey(), name: data.name || '', email: data.email || '', role: data.role || 'signer', order: data.order || state.recipients.length + 1 });
  renderRecipients();
}

function renderRecipients() {
  const box = $('recipients');
  box.innerHTML = state.recipients.map((r, i) => `
    <div class="recipient" data-key="${r.key}" style="--c:${r.role === 'signer' ? colorOf(r.key) : 'var(--line)'}">
      <span class="handle">${i + 1}</span>
      <label>Orden<input class="order" type="number" min="1" max="50" value="${esc(r.order)}" data-f="order" ${$('sequential').checked ? '' : 'disabled'}></label>
      <label>Nombre<input value="${esc(r.name)}" data-f="name" maxlength="120" autocomplete="off"></label>
      <label>Email<input type="email" value="${esc(r.email)}" data-f="email" maxlength="254" autocomplete="off"></label>
      <label>Rol<select data-f="role"><option value="signer"${r.role === 'signer' ? ' selected' : ''}>Firma</option><option value="cc"${r.role === 'cc' ? ' selected' : ''}>Recibe copia</option></select></label>
      <button class="icon-btn" type="button" data-remove aria-label="Quitar destinatario ${i + 1}">✕</button>
    </div>`).join('');
}
$('recipients').addEventListener('input', (e) => {
  const row = e.target.closest('.recipient');
  const r = state.recipients.find((x) => x.key === row?.dataset.key);
  if (!r || !e.target.dataset.f) return;
  r[e.target.dataset.f] = e.target.value;
  if (e.target.dataset.f === 'role') {
    state.fields = state.fields.filter((f) => f.recipientKey !== r.key || r.role === 'signer');
    renderRecipients();
  }
  if (e.target.dataset.f === 'name' || e.target.dataset.f === 'email') showSuggest(row, e.target, r);
});

// ---------- Sugerencias desde la libreta de contactos ----------
let contacts = [];
api('/api/contactos').then((res) => { contacts = res.data; }).catch(() => {});
const suggest = document.createElement('ul');
suggest.className = 'suggest';
suggest.id = 'suggest';
suggest.setAttribute('role', 'listbox');
suggest.hidden = true;
let suggestFor = null;

function showSuggest(row, input, r) {
  const q = input.value.trim().toLowerCase();
  const used = new Set(state.recipients.filter((x) => x !== r).map((x) => x.email.trim().toLowerCase()));
  const matches = q.length < 2 ? [] : contacts.filter((c) => !used.has(c.email) && (c.name.toLowerCase().includes(q) || c.email.includes(q))).slice(0, 6);
  if (!matches.length) return hideSuggest();
  suggestFor = { row, r, input, matches, active: -1 };
  suggest.innerHTML = matches.map((c, i) => `<li role="option" id="sg-${i}" data-i="${i}"><strong>${esc(c.name)}</strong><span>${esc(c.email)}</span></li>`).join('');
  input.setAttribute('aria-controls', 'suggest');
  row.appendChild(suggest);
  suggest.hidden = false;
}
function hideSuggest() {
  suggest.hidden = true;
  suggestFor = null;
}
function pickSuggest(i) {
  const { r, matches } = suggestFor;
  r.name = matches[i].name;
  r.email = matches[i].email;
  hideSuggest();
  renderRecipients();
}
suggest.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li[data-i]');
  if (!li) return;
  e.preventDefault();
  pickSuggest(Number(li.dataset.i));
});
$('recipients').addEventListener('keydown', (e) => {
  if (!suggestFor || suggest.hidden) return;
  const n = suggestFor.matches.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    suggestFor.active = (suggestFor.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    suggest.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === suggestFor.active)));
  } else if (e.key === 'Enter' && suggestFor.active >= 0) {
    e.preventDefault();
    pickSuggest(suggestFor.active);
  } else if (e.key === 'Escape') {
    hideSuggest();
  }
});
$('recipients').addEventListener('focusout', () => setTimeout(() => {
  if (!$('recipients').contains(document.activeElement)) hideSuggest();
}, 0));
$('recipients').addEventListener('click', (e) => {
  if (!e.target.matches('[data-remove]')) return;
  const key = e.target.closest('.recipient').dataset.key;
  state.recipients = state.recipients.filter((r) => r.key !== key);
  state.fields = state.fields.filter((f) => f.recipientKey !== key);
  renderRecipients();
});
$('add-recipient').addEventListener('click', () => addRecipient());
$('sequential').addEventListener('change', renderRecipients);

$('to-fields').addEventListener('click', async () => {
  const err = $('err2');
  err.textContent = '';
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const seen = new Set();
  for (const [i, r] of state.recipients.entries()) {
    r.name = r.name.trim();
    r.email = r.email.trim().toLowerCase();
    if (!r.name) return void (err.textContent = `Falta el nombre del destinatario ${i + 1}.`);
    if (!emailRe.test(r.email)) return void (err.textContent = `El email del destinatario ${i + 1} no es válido.`);
    if (seen.has(r.email)) return void (err.textContent = `El email ${r.email} está repetido.`);
    seen.add(r.email);
  }
  if (!state.recipients.some((r) => r.role === 'signer')) return void (err.textContent = 'Agregá al menos un firmante.');
  try {
    await saveDraft();
    go(3);
  } catch (e) {
    err.textContent = e.message;
  }
});

// ---------- Paso 3: campos ----------
const pagesEl = $('pages');

async function enterFields() {
  const owner = $('field-owner');
  const signers = state.recipients.filter((r) => r.role === 'signer');
  owner.innerHTML = signers.map((r) => `<option value="${r.key}">${esc(r.name || r.email)}</option>`).join('');
  if (!signers.some((s) => s.key === state.owner)) state.owner = signers[0]?.key;
  owner.value = state.owner;
  if (!state.rendered) {
    pagesEl.innerHTML = '<p class="muted">Cargando documento…</p>';
    const container = document.createElement('div');
    container.className = 'pages';
    pagesEl.replaceChildren(container);
    await renderPdf(state.pdf, container, { maxWidth: 860 });
    container.querySelectorAll('.page-wrap').forEach((wrap) => wrap.addEventListener('pointerdown', onPagePointerDown));
    state.rendered = true;
  }
  drawFields();
}
$('field-owner').addEventListener('change', (e) => { state.owner = e.target.value; });
$('palette').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-type]');
  if (!b) return;
  state.activeType = b.dataset.type;
  $('palette').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
});

function drawFields() {
  pagesEl.querySelectorAll('.fbox').forEach((n) => n.remove());
  for (const f of state.fields) {
    const wrap = pagesEl.querySelector(`.page-wrap[data-page="${f.page}"]`);
    if (!wrap) continue;
    const el = document.createElement('div');
    el.className = `fbox${state.selected === f.id ? ' selected' : ''}`;
    el.dataset.id = f.id;
    el.style.cssText = `left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%;--c:${colorOf(f.recipientKey)}`;
    const who = state.recipients.find((r) => r.key === f.recipientKey);
    el.title = `${TYPE_LABEL[f.type]} · ${who?.name || ''}`;
    el.textContent = f.type === 'checkbox' ? '✓' : `${TYPE_LABEL[f.type]}${f.required ? '' : ' (opc.)'}`;
    const handle = document.createElement('span');
    handle.className = 'resize';
    el.appendChild(handle);
    wrap.appendChild(el);
  }
  renderProps();
}

function renderProps() {
  const f = state.fields.find((x) => x.id === state.selected);
  $('selected-props').hidden = !f;
  if (!f) return;
  $('prop-required').checked = f.required;
  $('prop-label').value = f.label;
}
$('prop-required').addEventListener('change', (e) => {
  const f = state.fields.find((x) => x.id === state.selected);
  if (f) { f.required = e.target.checked; drawFields(); }
});
$('prop-label').addEventListener('input', (e) => {
  const f = state.fields.find((x) => x.id === state.selected);
  if (f) f.label = e.target.value.slice(0, 60);
});
function deleteSelected() {
  state.fields = state.fields.filter((x) => x.id !== state.selected);
  state.selected = null;
  drawFields();
}
$('prop-delete').addEventListener('click', deleteSelected);
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected && !e.target.matches('input, textarea, select')) {
    e.preventDefault();
    deleteSelected();
  }
});

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function onPagePointerDown(e) {
  const wrap = e.currentTarget;
  const rect = wrap.getBoundingClientRect();
  const box = e.target.closest('.fbox');
  if (box) {
    e.preventDefault();
    const f = state.fields.find((x) => x.id === box.dataset.id);
    state.selected = f.id;
    drawFields();
    const resizing = e.target.classList.contains('resize');
    const start = { px: e.clientX, py: e.clientY, x: f.x, y: f.y, w: f.w, h: f.h };
    const move = (ev) => {
      const dx = (ev.clientX - start.px) / rect.width;
      const dy = (ev.clientY - start.py) / rect.height;
      if (resizing) {
        f.w = clamp(start.w + dx, 0.015, 1 - f.x);
        f.h = clamp(start.h + dy, 0.01, 1 - f.y);
      } else {
        f.x = clamp(start.x + dx, 0, 1 - f.w);
        f.y = clamp(start.y + dy, 0, 1 - f.h);
      }
      const el = wrap.querySelector(`.fbox[data-id="${f.id}"]`);
      if (el) el.style.cssText = `left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%;--c:${colorOf(f.recipientKey)}`;
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return;
  }
  if (!state.owner) return;
  const [w0, h0] = DEFAULT_SIZE[state.activeType];
  const aspect = rect.width / rect.height;
  const w = w0;
  const h = state.activeType === 'checkbox' ? w0 * aspect : h0;
  const f = {
    id: crypto.randomUUID(),
    recipientKey: state.owner,
    type: state.activeType,
    page: Number(wrap.dataset.page),
    x: clamp((e.clientX - rect.left) / rect.width - w / 2, 0, 1 - w),
    y: clamp((e.clientY - rect.top) / rect.height - h / 2, 0, 1 - h),
    w,
    h,
    required: state.activeType !== 'checkbox',
    label: '',
  };
  state.fields.push(f);
  state.selected = f.id;
  drawFields();
}

$('to-review').addEventListener('click', async () => {
  const err = $('err3');
  err.textContent = '';
  const missing = state.recipients.filter((r) => r.role === 'signer' && !state.fields.some((f) => f.recipientKey === r.key && f.type === 'signature'));
  if (missing.length) return void (err.textContent = `Falta un campo de firma para: ${missing.map((m) => m.name).join(', ')}.`);
  try {
    await saveDraft();
    go(4);
  } catch (e) {
    err.textContent = e.message;
  }
});

// ---------- Paso 4: revisar y enviar ----------
function renderReview() {
  const signers = state.recipients.filter((r) => r.role === 'signer');
  const ccs = state.recipients.filter((r) => r.role === 'cc');
  $('review').innerHTML = `
    <div class="review-row"><strong>Documento</strong><span>${esc(state.title)}</span></div>
    <div class="review-row"><strong>Firmantes</strong><span>${signers.map((s) => `${esc(s.name)}${state.sequential ? ` (${esc(s.order)}º)` : ''}`).join(', ')}</span></div>
    ${ccs.length ? `<div class="review-row"><strong>Reciben copia</strong><span>${ccs.map((s) => esc(s.name)).join(', ')}</span></div>` : ''}
    <div class="review-row"><strong>Campos</strong><span>${state.fields.length}</span></div>
    <div class="review-row"><strong>Orden de firma</strong><span>${state.sequential ? 'En orden' : 'Todos a la vez'}</span></div>
    ${state.message ? `<div class="review-row"><strong>Mensaje</strong><span>${esc(state.message)}</span></div>` : ''}`;
}

$('opt-template').addEventListener('change', (e) => {
  $('opt-template-name-wrap').hidden = !e.target.checked;
  if (e.target.checked && !$('opt-template-name').value) $('opt-template-name').value = state.title;
});

$('send').addEventListener('click', async () => {
  const err = $('err4');
  const btn = $('send');
  err.textContent = '';
  const tplName = $('opt-template').checked ? $('opt-template-name').value.trim() : '';
  if ($('opt-template').checked && !tplName) return void (err.textContent = 'Poné un nombre a la plantilla.');
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    await saveDraft();
    await api(`/api/sobres/${state.id}/enviar`, { method: 'POST', headers: { 'Idempotency-Key': state.idempotencyKey } });
    if (tplName) await api('/api/plantillas', { method: 'POST', body: { envelopeId: state.id, name: tplName } }).catch(() => {});
    location.href = `/app/sobres/${state.id}`;
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
    btn.textContent = 'Enviar para firmar';
  }
});

// ---------- Reanudar un borrador ----------
const draftId = new URLSearchParams(location.search).get('id');
if (draftId) {
  try {
    const { envelope, recipients, fields } = await api(`/api/sobres/${draftId}`);
    if (envelope.status !== 'draft') {
      location.replace(`/app/sobres/${draftId}`);
    } else {
      const res = await api(`/api/sobres/${draftId}/original.pdf`, { raw: true });
      state.pdf = await res.arrayBuffer();
      state.id = draftId;
      state.title = envelope.title;
      state.message = envelope.message;
      $('title').value = envelope.title;
      $('message').value = envelope.message;
      $('sequential').checked = envelope.sequential;
      $('opt-language').value = envelope.language || 'es';
      $('opt-expire').value = String([7, 15, 30, 60, 90, 120].includes(envelope.expire_days) ? envelope.expire_days : 30);
      $('opt-reminder').value = String(envelope.reminder_days ?? 2);
      recipients.forEach((r) => addRecipient({ name: r.name, email: r.email, role: r.role, order: r.routing_order }));
      state.fields = fields.map((f) => ({
        id: crypto.randomUUID(),
        recipientKey: state.recipients[f.recipient_index]?.key,
        type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label,
      })).filter((f) => f.recipientKey);
      if (state.recipients.length === 0) addRecipient();
      go(2);
    }
  } catch (e) {
    $('err1').textContent = e.message;
  }
}
