import { api, esc, fmtDate } from './app-common.js';

const list = document.getElementById('ct-list');
const msg = document.getElementById('ct-msg');
const form = document.getElementById('ct-form');
const search = document.getElementById('ct-search');
let contacts = [];
let editing = null;

function render() {
  const q = search.value.trim().toLowerCase();
  const shown = contacts.filter((c) => !q || c.name.toLowerCase().includes(q) || c.email.includes(q));
  document.getElementById('ct-count').textContent = `${contacts.length} contacto${contacts.length === 1 ? '' : 's'}`;
  if (!shown.length) {
    list.innerHTML = `<li class="muted">${contacts.length ? 'Ningún contacto coincide con la búsqueda.' : 'Todavía no tenés contactos. Se agregan solos cuando enviás un sobre.'}</li>`;
    return;
  }
  list.innerHTML = shown.map((c) => (editing === c.id
    ? `<li data-id="${c.id}"><form class="inline-form ct-edit" novalidate>
        <input name="name" value="${esc(c.name)}" maxlength="120" aria-label="Nombre" required>
        <input name="email" type="email" value="${esc(c.email)}" maxlength="254" aria-label="Email" required>
        <button class="btn btn-primary btn-sm" type="submit">Guardar</button><button class="btn btn-ghost btn-sm" type="button" data-cancel>Cancelar</button></form></li>`
    : `<li data-id="${c.id}"><div><strong>${esc(c.name)}</strong><small>${esc(c.email)} · ${c.uses ? `${c.uses} sobre${c.uses === 1 ? '' : 's'}, último ${fmtDate(c.last_used_at)}` : 'Agregado a mano'}</small></div>
        <div class="tpl-actions"><button class="btn btn-ghost btn-sm" type="button" data-edit>Editar</button><button class="btn btn-ghost btn-sm" type="button" data-del aria-label="Eliminar ${esc(c.name)}">Eliminar</button></div></li>`)).join('');
}

async function load() {
  contacts = (await api('/api/contactos')).data;
  render();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'form-error';
  msg.textContent = '';
  try {
    await api('/api/contactos', { method: 'POST', body: { name: form.querySelector('#ct-name').value, email: form.querySelector('#ct-email').value } });
    form.reset();
    msg.className = 'form-ok';
    msg.textContent = 'Contacto guardado.';
    await load();
  } catch (err) {
    msg.textContent = err.message;
  }
});

search.addEventListener('input', render);

list.addEventListener('click', async (e) => {
  const id = e.target.closest('li')?.dataset.id;
  if (!id) return;
  if (e.target.matches('[data-edit]')) { editing = id; render(); list.querySelector('.ct-edit input').focus(); }
  if (e.target.matches('[data-cancel]')) { editing = null; render(); }
  if (e.target.matches('[data-del]')) {
    const c = contacts.find((x) => x.id === id);
    if (!confirm(`¿Eliminar a ${c.name} de tus contactos?`)) return;
    await api(`/api/contactos/${id}`, { method: 'DELETE' });
    await load();
  }
});

list.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  msg.className = 'form-error';
  msg.textContent = '';
  try {
    await api(`/api/contactos/${f.closest('li').dataset.id}`, { method: 'PUT', body: { name: f.name.value, email: f.email.value } });
    editing = null;
    await load();
  } catch (err) {
    msg.textContent = err.message;
  }
});

load().catch((err) => { list.innerHTML = `<li class="form-error">${esc(err.message)}</li>`; });
