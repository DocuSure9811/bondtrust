import { api, esc, fmtDate } from './app-common.js';

const root = document.getElementById('team-root');
const ROLE = { admin: 'Administrador', member: 'Miembro' };

function msg(text, ok = false) {
  const el = document.getElementById('team-msg');
  el.className = ok ? 'form-ok' : 'form-error';
  el.textContent = text;
}

function renderEmpty() {
  root.innerHTML = `<div class="app-title-row"><h1>Equipo</h1></div>
  <section class="card"><h2>Trabajá en equipo</h2>
    <p class="muted">Creá un equipo para compartir plantillas con tus compañeros. Los administradores ven los sobres de todos y gestionan a los miembros.</p>
    <form id="team-create" class="inline-form" novalidate><label class="visually-hidden" for="team-name">Nombre del equipo</label><input id="team-name" maxlength="80" placeholder="Ej.: Comercial Acme" required><button class="btn btn-primary" type="submit">Crear equipo</button></form>
    <p class="form-error" role="alert" id="team-msg"></p>
    <p class="muted small">¿Te invitaron a un equipo? Abrí el enlace de la invitación con esta cuenta.</p>
  </section>`;
  document.getElementById('team-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/equipo', { method: 'POST', body: { name: document.getElementById('team-name').value } });
      await load();
    } catch (err) {
      msg(err.message);
    }
  });
}

function render(data) {
  const admin = data.role === 'admin';
  root.innerHTML = `<div class="app-title-row"><h1>${esc(data.team.name)}</h1><span class="status-pill status-completed">${ROLE[data.role]}</span></div>
  <p class="form-error" role="alert" id="team-msg"></p>
  ${admin ? `<section class="card"><h2>Invitar a una persona</h2>
    <form id="invite-form" class="inline-form" novalidate>
      <label class="visually-hidden" for="inv-email">Email</label><input id="inv-email" type="email" maxlength="254" placeholder="email@empresa.com" required>
      <label class="visually-hidden" for="inv-role">Rol</label><select id="inv-role"><option value="member">Miembro</option><option value="admin">Administrador</option></select>
      <button class="btn btn-primary" type="submit">Invitar</button></form>
    <div id="invite-link" class="new-secret" hidden></div>
    ${data.invites.length ? `<h3 class="small-title">Invitaciones pendientes</h3><ul class="rlist">${data.invites.map((i) => `<li data-invite="${i.id}"><div><strong>${esc(i.email)}</strong><small>${ROLE[i.role]} · vence ${fmtDate(i.expires_at)}</small></div><button class="btn btn-ghost btn-sm" type="button" data-revoke>Cancelar</button></li>`).join('')}</ul>` : ''}
  </section>` : ''}
  <section class="card"><h2>Miembros (${data.members.length})</h2><ul class="rlist">${data.members.map((m) => `
    <li data-member="${m.id}"><div><strong>${esc(m.name)}${m.id === data.me ? ' (vos)' : ''}</strong><small>${esc(m.email)} · ${m.envelopes_sent} sobres enviados · desde ${fmtDate(m.joined_at)}</small></div>
      <div class="tpl-actions">${admin && m.id !== data.me
        ? `<label class="visually-hidden" for="role-${m.id}">Rol de ${esc(m.name)}</label><select id="role-${m.id}" data-role>${Object.entries(ROLE).map(([k, v]) => `<option value="${k}"${k === m.role ? ' selected' : ''}>${v}</option>`).join('')}</select><button class="btn btn-ghost btn-sm" type="button" data-remove>Quitar</button>`
        : `<span class="muted small">${ROLE[m.role]}</span>`}</div></li>`).join('')}</ul>
    <p class="muted small">Todos los miembros usan las plantillas del equipo. ${admin ? 'Como administrador, en <a href="/app">Mis documentos</a> podés ver los sobres de todo el equipo.' : 'Los administradores pueden ver tus sobres.'}</p>
  </section>
  ${admin ? `<section class="card"><h2>Nombre del equipo</h2><form id="rename-form" class="inline-form" novalidate><label class="visually-hidden" for="rename">Nombre del equipo</label><input id="rename" maxlength="80" value="${esc(data.team.name)}" required><button class="btn btn-ghost" type="submit">Guardar</button></form></section>` : ''}
  <section class="card"><h2>Salir del equipo</h2><p class="muted small">Tus sobres y plantillas siguen siendo tuyos.${data.members.length === 1 ? ' Sos el único miembro: el equipo se elimina.' : ''}</p><button class="btn btn-danger btn-sm" type="button" id="leave">Salir del equipo</button></section>`;

  const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, (e) => fn(e, el).catch((err) => msg(err.message))));
  on('#invite-form', 'submit', async (e) => {
    e.preventDefault();
    const inv = await api('/api/equipo/invitaciones', { method: 'POST', body: { email: document.getElementById('inv-email').value, role: document.getElementById('inv-role').value } });
    await load();
    const box = document.getElementById('invite-link');
    box.hidden = false;
    box.innerHTML = `<p><strong>Invitación creada para ${esc(inv.email)}.</strong> También le enviamos un email. Podés compartirle este enlace (vence en 7 días, sirve una sola vez):</p>
      <pre class="code" id="inv-url">${esc(inv.url)}</pre><button class="btn btn-outline btn-sm" type="button" id="copy-inv">Copiar enlace</button>`;
    document.getElementById('copy-inv').addEventListener('click', async () => {
      await navigator.clipboard.writeText(inv.url).catch(() => {});
      document.getElementById('copy-inv').textContent = 'Copiado';
    });
  });
  on('[data-revoke]', 'click', async (e, el) => {
    await api(`/api/equipo/invitaciones/${el.closest('li').dataset.invite}`, { method: 'DELETE' });
    await load();
  });
  on('[data-role]', 'change', async (e, el) => {
    try {
      await api(`/api/equipo/miembros/${el.closest('li').dataset.member}`, { method: 'PUT', body: { role: el.value } });
      msg('Rol actualizado.', true);
    } catch (err) {
      await load();
      msg(err.message);
    }
  });
  on('[data-remove]', 'click', async (e, el) => {
    const li = el.closest('li');
    if (!confirm(`¿Quitar a ${li.querySelector('strong').textContent} del equipo? Sus sobres y plantillas siguen siendo suyos.`)) return;
    await api(`/api/equipo/miembros/${li.dataset.member}`, { method: 'DELETE' });
    await load();
  });
  on('#rename-form', 'submit', async (e) => {
    e.preventDefault();
    await api('/api/equipo', { method: 'PUT', body: { name: document.getElementById('rename').value } });
    await load();
    msg('Nombre guardado.', true);
  });
  on('#leave', 'click', async () => {
    if (!confirm('¿Salir del equipo?')) return;
    await api(`/api/equipo/miembros/${data.me}`, { method: 'DELETE' });
    await load();
  });
}

async function load() {
  const data = await api('/api/equipo');
  if (data.team) render(data); else renderEmpty();
}

load().catch((err) => { root.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; });
