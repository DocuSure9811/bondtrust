import { STATUS, api, esc, fmtDate, pill } from './app-common.js';

const $ = (id) => document.getElementById(id);
const list = $('list');
const stats = $('stats');
const tabs = [...document.querySelectorAll('#filters [data-filter]')];
let envelopes = [];
let folders = [];
let filter = 'all';
let scope = 'mine';
const selected = new Set();
let me = null;

const folderName = (id) => folders.find((f) => f.id === id)?.name || '';

function matches(e) {
  if (filter === 'closed' && !['declined', 'voided', 'expired'].includes(e.status)) return false;
  if (!['all', 'closed'].includes(filter) && e.status !== filter) return false;
  const folder = $('folder').value;
  if (folder === 'none' ? e.folder_id : folder && e.folder_id !== folder) return false;
  const q = $('q').value.trim().toLowerCase();
  if (q && !e.title.toLowerCase().includes(q) && !e.recipients.some((r) => r.name.toLowerCase().includes(q) || r.email.includes(q))) return false;
  const day = new Date(e.created_at).toISOString().slice(0, 10);
  if ($('from').value && day < $('from').value) return false;
  if ($('to').value && day > $('to').value) return false;
  return true;
}

const visible = () => envelopes.filter(matches);

function render() {
  const rows = visible();
  $('count').textContent = envelopes.length ? `${rows.length} de ${envelopes.length} sobres` : '';
  renderBulk();
  if (envelopes.length === 0) {
    list.innerHTML = `<div class="empty"><h2>Todavía no enviaste documentos</h2><p class="muted">Subí un PDF, agregá a los firmantes y enviálo en menos de un minuto.</p><a class="btn btn-primary" href="/app/nuevo">Crear mi primer sobre</a></div>`;
    return;
  }
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty"><p class="muted">No hay sobres con estos filtros.</p></div>';
    return;
  }
  list.innerHTML = rows.map((e) => {
    const mine = e.owner_id === me.user.id;
    const href = e.status === 'draft' && mine ? `/app/nuevo?id=${e.id}` : `/app/sobres/${e.id}`;
    const people = e.recipients.map((r) => r.name).join(', ');
    const progress = e.status === 'draft' ? 'Borrador sin enviar' : `${e.signed} de ${e.signers} firmas`;
    const folder = e.folder_id && mine ? `<span class="folder-tag">${esc(folderName(e.folder_id))}</span>` : '';
    const by = mine ? '' : `<span class="owner-tag">${esc(e.owner_name)}</span>`;
    return `<div class="env-item">${mine ? `<input type="checkbox" class="env-check" data-id="${e.id}" aria-label="Seleccionar ${esc(e.title)}"${selected.has(e.id) ? ' checked' : ''}>` : '<span></span>'}
      <a class="env-row" href="${href}"><div><h2>${esc(e.title)} ${folder}${by}</h2><p>${progress}${people ? ` · ${esc(people)}` : ''}</p></div>
      <span class="env-date muted small">${fmtDate(e.completed_at || e.sent_at || e.created_at)}</span>${pill(e.status)}</a></div>`;
  }).join('');
}

function renderFolders() {
  const keep = $('folder').value;
  $('folder').innerHTML = `<option value="">Todas las carpetas</option>${folders.map((f) => `<option value="${f.id}">${esc(f.name)} (${f.envelopes})</option>`).join('')}<option value="none">Sin carpeta</option>`;
  $('folder').value = [...$('folder').options].some((o) => o.value === keep) ? keep : '';
  $('bulk-folder').innerHTML = `${folders.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}<option value="">Sacar de la carpeta</option>`;
  $('folder-list').innerHTML = folders.length
    ? folders.map((f) => `<li data-id="${f.id}"><div><strong>${esc(f.name)}</strong><small>${f.envelopes} sobre${f.envelopes === 1 ? '' : 's'}</small></div>
      <div class="tpl-actions"><button class="btn btn-ghost btn-sm" type="button" data-rename>Renombrar</button><button class="btn btn-ghost btn-sm" type="button" data-delete>Borrar</button></div></li>`).join('')
    : '<li class="muted">Todavía no tenés carpetas.</li>';
}

function renderBulk() {
  $('bulk').hidden = selected.size === 0;
  $('bulk-count').textContent = `${selected.size} seleccionado${selected.size === 1 ? '' : 's'}`;
  if (!folders.length) $('bulk-folder').innerHTML = '<option value="">Primero creá una carpeta</option>';
  $('bulk-move').disabled = !folders.length;
}

async function reload() {
  [envelopes, folders] = await Promise.all([api(`/api/sobres${scope === 'team' ? '?alcance=equipo' : ''}`).then((d) => d.envelopes), api('/api/carpetas').then((d) => d.data)]);
  for (const id of [...selected]) if (!envelopes.some((e) => e.id === id)) selected.delete(id);
  renderFolders();
  render();
}

tabs.forEach((t) => t.addEventListener('click', () => {
  filter = t.dataset.filter;
  tabs.forEach((o) => o.setAttribute('aria-selected', String(o === t)));
  render();
}));
['q', 'folder', 'from', 'to'].forEach((id) => $(id).addEventListener('input', render));

list.addEventListener('change', (e) => {
  if (!e.target.matches('.env-check')) return;
  if (e.target.checked) selected.add(e.target.dataset.id); else selected.delete(e.target.dataset.id);
  renderBulk();
});
$('bulk-clear').addEventListener('click', () => { selected.clear(); render(); });
$('bulk-move').addEventListener('click', async () => {
  const btn = $('bulk-move');
  btn.disabled = true;
  try {
    for (const id of selected) await api(`/api/sobres/${id}/carpeta`, { method: 'PUT', body: { folderId: $('bulk-folder').value || null } });
    selected.clear();
    await reload();
  } finally {
    btn.disabled = false;
  }
});

// ---------- Carpetas ----------
const dialog = $('folders-dialog');
const folderMsg = (text) => { $('folder-msg').textContent = text; };
$('folders-btn').addEventListener('click', () => { folderMsg(''); dialog.showModal(); });
$('folders-close').addEventListener('click', () => dialog.close());
$('folder-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  folderMsg('');
  try {
    await api('/api/carpetas', { method: 'POST', body: { name: $('folder-name').value } });
    $('folder-name').value = '';
    await reload();
  } catch (err) {
    folderMsg(err.message);
  }
});
$('folder-list').addEventListener('click', async (e) => {
  const id = e.target.closest('li')?.dataset.id;
  const f = folders.find((x) => x.id === id);
  if (!f) return;
  folderMsg('');
  try {
    if (e.target.matches('[data-rename]')) {
      const name = prompt('Nuevo nombre de la carpeta', f.name);
      if (!name || name === f.name) return;
      await api(`/api/carpetas/${id}`, { method: 'PUT', body: { name } });
    } else if (e.target.matches('[data-delete]')) {
      if (!confirm(`¿Borrar la carpeta “${f.name}”? Sus sobres no se borran: quedan sin carpeta.`)) return;
      await api(`/api/carpetas/${id}`, { method: 'DELETE' });
    } else {
      return;
    }
    await reload();
  } catch (err) {
    folderMsg(err.message);
  }
});

// ---------- Exportar CSV (lo que se ve con los filtros actuales) ----------
function csvCell(value) {
  let v = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`; // evita que una planilla lo ejecute como fórmula
  return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
const isoDay = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '');
$('export').addEventListener('click', () => {
  const header = ['ID', 'Documento', 'Estado', 'Carpeta', 'Remitente', 'Creado (UTC)', 'Enviado (UTC)', 'Completado (UTC)', 'Firmas', 'Destinatarios'];
  const lines = visible().map((e) => [
    e.id, e.title, STATUS[e.status] || e.status, e.owner_id === me.user.id ? folderName(e.folder_id) : '', e.owner_name, isoDay(e.created_at), isoDay(e.sent_at), isoDay(e.completed_at),
    `${e.signed}/${e.signers}`, e.recipients.map((r) => `${r.name} <${r.email}>${r.role === 'cc' ? ' (copia)' : ''}`).join(', '),
  ]);
  const csv = `﻿${[header, ...lines].map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `docsure-sobres-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

try {
  me = await api('/api/me');
  if (me.team?.role === 'admin') {
    $('q').insertAdjacentHTML('beforebegin', '<label class="visually-hidden" for="scope">Qué sobres ver</label><select id="scope"><option value="mine">Mis sobres</option><option value="team">Todo el equipo</option></select>');
    $('scope').addEventListener('change', async (ev) => {
      scope = ev.target.value;
      selected.clear();
      await reload();
    });
  }
  await reload();
  const pending = envelopes.filter((e) => e.status === 'sent').length;
  const done = envelopes.filter((e) => e.status === 'completed').length;
  const limit = me.plan.monthlyEnvelopes;
  const used = me.usage.envelopesThisMonth;
  const pct = limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  stats.insertAdjacentHTML('beforebegin', `<section class="usage" aria-label="Uso del plan">
    <strong>Plan ${esc(me.plan.name)}</strong> · ${limit === null ? `${used} sobres enviados este mes (ilimitados)` : `${used} de ${limit} sobres usados este mes`}
    ${limit === null ? '' : `<div class="usage-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${used}"><span style="width:${pct}%"></span></div>`}
    <span class="muted small">Los sobres anulados o corregidos no cuentan. El cupo se renueva el día 1 de cada mes.</span></section>`);
  stats.innerHTML = [
    [pending, 'Esperando firmas'],
    [done, 'Completados'],
    [envelopes.filter((e) => e.status === 'draft').length, 'Borradores'],
    [limit === null ? `${used}` : `${used}/${limit}`, `Enviados este mes · plan ${me.plan.name}`],
  ].map(([n, label]) => `<div class="stat"><strong>${esc(n)}</strong><span>${esc(label)}</span></div>`).join('');
} catch (err) {
  list.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
}
