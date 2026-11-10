import { api, esc, fmtDate } from './app-common.js';

const list = document.getElementById('tpl-list');
const msg = document.getElementById('tpl-msg');
let templates = [];

function dialog(html) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  return { dlg, close };
}

function useDialog(t) {
  const { dlg, close } = dialog(`<h2>Usar “${esc(t.name)}”</h2>
    <p class="muted small">Completá quién ocupa cada rol.</p>
    <form id="use-form" novalidate>
      ${t.roles.map((r, i) => `<fieldset class="role-set"><legend>${esc(r.label)}${r.role === 'cc' ? ' · recibe copia' : ''}</legend>
        <label>Nombre<input data-i="${i}" data-f="name" maxlength="120" required></label>
        <label>Email<input data-i="${i}" data-f="email" type="email" maxlength="254" required></label></fieldset>`).join('')}
      <p class="form-error" role="alert" id="use-err"></p>
      <div class="modal-actions"><button class="btn btn-ghost" type="button" data-close>Cancelar</button>
        <button class="btn btn-outline" type="submit" data-mode="edit">Revisar antes de enviar</button>
        <button class="btn btn-primary" type="submit" data-mode="send">Enviar ahora</button></div>
    </form>`);
  const form = dlg.querySelector('#use-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = e.submitter?.dataset.mode || 'send';
    const recipients = t.roles.map((_, i) => ({
      name: form.querySelector(`[data-i="${i}"][data-f="name"]`).value.trim(),
      email: form.querySelector(`[data-i="${i}"][data-f="email"]`).value.trim(),
    }));
    try {
      const { id } = await api(`/api/plantillas/${t.id}/usar`, { method: 'POST', body: { recipients, send: mode === 'send' } });
      close();
      location.href = mode === 'send' ? `/app/sobres/${id}` : `/app/nuevo?id=${id}`;
    } catch (err) {
      dlg.querySelector('#use-err').textContent = err.message;
    }
  });
}

function parseCsv(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((line) => line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, '')))
    .filter(([a, b]) => !(/^nombre$/i.test(a) && /^e-?mail$/i.test(b)))
    .map(([name, email]) => ({ name, email }));
}

function bulkDialog(t) {
  const { dlg } = dialog(`<h2>Envío masivo: “${esc(t.name)}”</h2>
    <p class="muted small">Una fila por firmante: <code>nombre,email</code>. Podés pegar desde Excel o subir un CSV. Máximo 200 filas.</p>
    <input type="file" id="bulk-file" accept=".csv,text/csv,text/plain">
    <label>Filas<textarea id="bulk-rows" rows="8" placeholder="Ana Pérez,ana@empresa.com&#10;Juan Gómez,juan@empresa.com"></textarea></label>
    <p class="muted small" id="bulk-count">0 filas</p>
    <p class="form-error" role="alert" id="bulk-err"></p>
    <div class="bulk-result" id="bulk-result"></div>
    <div class="modal-actions"><button class="btn btn-ghost" type="button" data-close>Cerrar</button><button class="btn btn-primary" type="button" id="bulk-send">Enviar</button></div>`);
  const area = dlg.querySelector('#bulk-rows');
  const count = () => { dlg.querySelector('#bulk-count').textContent = `${parseCsv(area.value).length} filas`; };
  area.addEventListener('input', count);
  dlg.querySelector('#bulk-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) { area.value = await f.text(); count(); }
  });
  dlg.querySelector('#bulk-send').addEventListener('click', async (e) => {
    const rows = parseCsv(area.value);
    const err = dlg.querySelector('#bulk-err');
    err.textContent = '';
    if (!rows.length) return void (err.textContent = 'Cargá al menos una fila.');
    e.target.disabled = true;
    e.target.textContent = 'Enviando…';
    try {
      const out = await api(`/api/plantillas/${t.id}/masivo`, { method: 'POST', body: { rows } });
      dlg.querySelector('#bulk-result').innerHTML = `<p class="form-ok">${out.sent} de ${rows.length} sobres enviados.</p><ul class="rlist">${out.results.map((r) => `<li><span>${r.row}. ${esc(r.email || '')}</span><span class="status-pill status-${r.status === 'sent' ? 'completed' : 'declined'}">${r.status === 'sent' ? 'Enviado' : esc(r.error)}</span></li>`).join('')}</ul>`;
      e.target.textContent = 'Listo';
    } catch (ex) {
      err.textContent = ex.message;
      e.target.disabled = false;
      e.target.textContent = 'Enviar';
    }
  });
}

function render() {
  if (!templates.length) {
    list.innerHTML = '<div class="empty"><h2>Todavía no tenés plantillas</h2><p class="muted">Abrí un sobre y tocá “Guardar como plantilla”.</p><a class="btn btn-primary" href="/app">Ir a mis documentos</a></div>';
    return;
  }
  list.innerHTML = templates.map((t) => {
    const single = t.roles.length === 1 && t.roles[0].role === 'signer';
    return `<div class="env-row"><div><h2>${esc(t.name)}${t.mine ? '' : ` <span class="owner-tag">De ${esc(t.owner_name)}</span>`}</h2><p>${t.roles.map((r) => esc(r.label)).join(', ')} · ${t.field_count} campos · ${t.page_count} pág. · ${fmtDate(t.created_at)}</p></div>
      <div class="tpl-actions"><button class="btn btn-primary btn-sm" data-use="${t.id}">Usar</button>
      ${single ? `<button class="btn btn-outline btn-sm" data-bulk="${t.id}">Envío masivo</button>` : ''}
      ${t.can_delete ? `<button class="btn btn-danger btn-sm" data-del="${t.id}">Eliminar</button>` : ''}</div><span></span></div>`;
  }).join('');
  list.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => useDialog(templates.find((t) => t.id === b.dataset.use))));
  list.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', () => bulkDialog(templates.find((t) => t.id === b.dataset.bulk))));
  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Eliminar la plantilla? Los sobres ya enviados no cambian.')) return;
    try {
      await api(`/api/plantillas/${b.dataset.del}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      msg.textContent = err.message;
    }
  }));
}

async function load() {
  templates = (await api('/api/plantillas')).data;
  render();
}

load().catch((err) => { list.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; });
