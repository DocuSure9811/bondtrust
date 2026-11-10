import { api, esc } from './app-common.js';

const box = document.getElementById('join');
const token = new URLSearchParams(location.search).get('token') || '';
const ROLE = { admin: 'administrador', member: 'miembro' };

try {
  const info = await api(`/api/equipo/invitacion?token=${encodeURIComponent(token)}`);
  if (!info.matches) {
    box.innerHTML = `<h1>Invitación para otra cuenta</h1><p class="muted">Esta invitación es para <strong>${esc(info.email)}</strong>. Salí e ingresá con esa cuenta (o creala) para aceptarla.</p>`;
  } else {
    box.innerHTML = `<h1>Sumate a ${esc(info.team)}</h1><p class="muted">${esc(info.inviter || 'Un administrador')} te invitó como ${ROLE[info.role]}. Vas a poder usar las plantillas del equipo.</p>
      <p class="form-error" role="alert" id="join-err"></p><button class="btn btn-primary btn-lg" type="button" id="accept">Unirme al equipo</button>`;
    document.getElementById('accept').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await api('/api/equipo/unirse', { method: 'POST', body: { token } });
        location.href = '/app/equipo';
      } catch (err) {
        document.getElementById('join-err').textContent = err.message;
        e.target.disabled = false;
      }
    });
  }
} catch (err) {
  box.innerHTML = `<h1>No se puede usar esta invitación</h1><p class="muted">${esc(err.message)}</p><a class="btn btn-ghost" href="/app">Ir a mis documentos</a>`;
}
