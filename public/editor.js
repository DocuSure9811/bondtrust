import { api, esc } from './app-common.js';
import { pageLabeler, renderPdf } from './pdfview.js';

const COLORS = ['--signer-0', '--signer-1', '--signer-2', '--signer-3', '--signer-4', '--signer-5'];
const TYPE_LABEL = { signature: 'Firma', initials: 'Iniciales', date: 'Fecha', name: 'Nombre', email: 'Email', text: 'Texto', checkbox: '☐', select: 'Lista', attachment: 'Adjunto' };
const DEFAULT_SIZE = { signature: [0.26, 0.06], initials: [0.1, 0.05], date: [0.18, 0.03], name: [0.26, 0.03], email: [0.3, 0.03], text: [0.26, 0.03], checkbox: [0.028, 0.02], select: [0.26, 0.03], attachment: [0.26, 0.04] };
const CONTROL_TYPES = new Set(['checkbox', 'select', 'text']);

const state = {
  id: null,
  pdf: null,
  documents: [],
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
      fields: state.fields.map(({ id, recipientKey, type, page, x, y, w, h, required, label, options, validation, showIf }) => ({ key: id, recipientKey, type, page, x, y, w, h, required, label, options, validation, showIf: showIf && state.fields.some((p) => p.id === showIf.key) ? showIf : null })),
    },
  });
}

// ---------- Paso 1: documentos ----------
const docName = (file) => file.name.replace(/\.pdf$/i, '').slice(0, 160) || 'Documento';

function renderDocs() {
  const list = $('docs');
  const many = state.documents.length > 1;
  list.hidden = state.documents.length === 0;
  list.innerHTML = state.documents.map((d, i) => `<li><div><strong>${i + 1}. ${esc(d.name)}</strong><small>${d.pages} página${d.pages === 1 ? '' : 's'}</small></div>
    ${many ? `<button class="btn btn-ghost btn-sm" type="button" data-remove-doc="${i}" aria-label="Quitar ${esc(d.name)}">Quitar</button>` : ''}</li>`).join('');
  $('drop-text').textContent = state.documents.length ? 'Agregar otro PDF' : 'Elegí o arrastrá uno o varios PDF';
  $('step1-actions').hidden = !state.id;
}

async function reloadPdf() {
  state.pdf = await (await api(`/api/sobres/${state.id}/original.pdf`, { raw: true })).arrayBuffer();
  state.rendered = false;
}

async function handleFiles(fileList) {
  const err = $('err1');
  err.textContent = '';
  const files = [...fileList];
  if (!files.length) return;
  for (const file of files) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return void (err.textContent = `${file.name} no es un PDF.`);
    if (file.size > 15 * 1024 * 1024) return void (err.textContent = `${file.name} supera 15 MB.`);
  }
  if (state.documents.length + files.length > 10) return void (err.textContent = 'Máximo 10 documentos por sobre.');
  const label = $('drop-text');
  const firstUpload = !state.id;
  try {
    for (const [n, file] of files.entries()) {
      label.textContent = files.length > 1 ? `Subiendo ${n + 1} de ${files.length}…` : 'Subiendo…';
      const bytes = await file.arrayBuffer();
      if (!state.id) {
        const title = $('title').value.trim() || docName(file);
        $('title').value = title;
        const res = await api(`/api/sobres?title=${encodeURIComponent(title)}&name=${encodeURIComponent(docName(file))}`, { method: 'POST', body: bytes });
        state.id = res.id;
        state.title = title;
        state.documents = res.documents;
        state.pdf = bytes;
        state.fields = [];
        state.selected = null;
        state.rendered = false;
        state.idempotencyKey = crypto.randomUUID();
        history.replaceState(null, '', `/app/nuevo?id=${res.id}`);
      } else {
        const res = await api(`/api/sobres/${state.id}/documentos?name=${encodeURIComponent(docName(file))}`, { method: 'POST', body: bytes });
        state.documents = res.documents;
      }
    }
    if (state.documents.length > 1) await reloadPdf();
    if (state.recipients.length === 0) addRecipient();
    if (firstUpload && files.length === 1) go(2);
  } catch (e) {
    err.textContent = e.message;
  } finally {
    $('file').value = '';
    renderDocs();
  }
}
$('file').addEventListener('change', (e) => handleFiles(e.target.files));
const drop = $('drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('drag')));
drop.addEventListener('drop', (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });

$('docs').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-remove-doc]');
  if (!b) return;
  const doc = state.documents[Number(b.dataset.removeDoc)];
  if (!confirm(`¿Quitar “${doc.name}” del sobre? Se borran los campos ubicados en sus páginas.`)) return;
  b.disabled = true;
  try {
    const res = await api(`/api/sobres/${state.id}/documentos/${b.dataset.removeDoc}`, { method: 'DELETE' });
    const { start, count } = res.removed;
    state.fields = state.fields
      .filter((f) => f.page < start || f.page >= start + count)
      .map((f) => (f.page >= start + count ? { ...f, page: f.page - count } : f));
    state.selected = null;
    state.documents = res.documents;
    await reloadPdf();
    renderDocs();
  } catch (err) {
    $('err1').textContent = err.message;
    b.disabled = false;
  }
});

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
    await renderPdf(state.pdf, container, { maxWidth: 860, label: pageLabeler(state.documents) });
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
    el.textContent = `${f.showIf ? '⤷ ' : ''}${f.type === 'checkbox' ? '✓' : `${TYPE_LABEL[f.type]}${f.required ? '' : ' (opc.)'}`}`;
    if (f.showIf) el.classList.add('conditional');
    const handle = document.createElement('span');
    handle.className = 'resize';
    el.appendChild(handle);
    wrap.appendChild(el);
  }
  renderProps();
}

const selectedField = () => state.fields.find((x) => x.id === state.selected);
const fieldName = (f) => f.label || `${f.type === 'checkbox' ? 'Casilla' : TYPE_LABEL[f.type]} (pág. ${f.page})`;

function renderProps() {
  const f = selectedField();
  $('selected-props').hidden = !f;
  if (!f) return;
  $('prop-required').checked = f.required;
  $('prop-label').value = f.label;
  $('prop-format-wrap').hidden = f.type !== 'text';
  $('prop-format').value = f.validation || '';
  $('prop-options-wrap').hidden = f.type !== 'select';
  if (f.type === 'select') $('prop-options').value = (f.options || []).join('\n');
  // Condición: la controla una casilla, lista o texto del mismo firmante (la firma siempre se ve).
  const controllers = state.fields.filter((c) => c !== f && c.recipientKey === f.recipientKey && CONTROL_TYPES.has(c.type) && !dependsOn(c, f.id));
  $('prop-cond-wrap').hidden = f.type === 'signature';
  $('prop-cond-field').innerHTML = `<option value="">Siempre</option>${controllers.map((c) => `<option value="${c.id}"${f.showIf?.key === c.id ? ' selected' : ''}>Solo si “${esc(fieldName(c))}”…</option>`).join('')}`;
  renderCondValue(f);
}

/** ¿El campo c depende (directa o indirectamente) del campo con ese id? Evita ciclos. */
function dependsOn(c, id) {
  for (let cur = c, n = 0; cur?.showIf && n < 50; n += 1) {
    if (cur.showIf.key === id) return true;
    cur = state.fields.find((x) => x.id === cur.showIf.key);
  }
  return false;
}

function renderCondValue(f) {
  const box = $('prop-cond-value');
  const parent = f.showIf && state.fields.find((x) => x.id === f.showIf.key);
  if (!parent) {
    box.innerHTML = '';
    return;
  }
  const v = f.showIf.equals;
  if (parent.type === 'checkbox') {
    box.innerHTML = `<label>…está<select id="prop-cond-eq"><option value="true"${v === 'true' ? ' selected' : ''}>marcada</option><option value="false"${v === 'false' ? ' selected' : ''}>sin marcar</option></select></label>`;
  } else if (parent.type === 'select') {
    box.innerHTML = `<label>…es<select id="prop-cond-eq">${(parent.options || []).map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  } else {
    box.innerHTML = `<label>…es igual a<input id="prop-cond-eq" maxlength="80" value="${esc(v)}"></label>`;
  }
}

$('prop-format').addEventListener('change', (e) => {
  const f = selectedField();
  if (f) f.validation = e.target.value || null;
});
$('prop-options').addEventListener('input', (e) => {
  const f = selectedField();
  if (!f) return;
  f.options = [...new Set(e.target.value.split('\n').map((o) => o.trim().slice(0, 80)).filter(Boolean))].slice(0, 30);
  // Las condiciones que usaban una opción borrada pasan a la primera opción disponible.
  state.fields.filter((d) => d.showIf?.key === f.id && !f.options.includes(d.showIf.equals)).forEach((d) => { d.showIf.equals = f.options[0] || ''; });
});
$('prop-cond-field').addEventListener('change', (e) => {
  const f = selectedField();
  if (!f) return;
  const parent = state.fields.find((x) => x.id === e.target.value);
  f.showIf = parent ? { key: parent.id, equals: parent.type === 'checkbox' ? 'true' : parent.type === 'select' ? (parent.options || [])[0] || '' : '' } : null;
  drawFields();
});
$('prop-cond-value').addEventListener('input', (e) => {
  const f = selectedField();
  if (f?.showIf && e.target.id === 'prop-cond-eq') f.showIf.equals = e.target.value.slice(0, 80);
});
$('prop-cond-value').addEventListener('change', (e) => {
  const f = selectedField();
  if (f?.showIf && e.target.id === 'prop-cond-eq') f.showIf.equals = e.target.value;
});

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
  state.fields.forEach((d) => { if (d.showIf?.key === state.selected) d.showIf = null; });
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
    options: state.activeType === 'select' ? ['Opción 1', 'Opción 2'] : null,
    validation: null,
    showIf: null,
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
  if (state.fields.some((f) => f.type === 'select' && !f.options?.length)) return void (err.textContent = 'Cada lista necesita al menos una opción.');
  if (state.fields.some((f) => f.showIf && !f.showIf.equals)) return void (err.textContent = 'Completá el valor de cada condición.');
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
      state.documents = envelope.documents;
      renderDocs();
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
        id: f.id,
        recipientKey: state.recipients[f.recipient_index]?.key,
        type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label,
        options: f.options, validation: f.validation,
        showIf: f.cond_field_id ? { key: f.cond_field_id, equals: f.cond_value } : null,
      })).filter((f) => f.recipientKey);
      if (state.recipients.length === 0) addRecipient();
      go(2);
    }
  } catch (e) {
    $('err1').textContent = e.message;
  }
}
