import { api, esc } from './app-common.js';

const box = document.getElementById('connect');
const code = new URLSearchParams(location.search).get('codigo') || '';

function done(title, text) {
  box.innerHTML = `<h1>${esc(title)}</h1><p class="muted">${esc(text)}</p><a class="btn btn-ghost" href="/app/api">Ver mis claves</a>`;
}

try {
  const info = await api(`/api/agente?codigo=${encodeURIComponent(code)}`);
  box.innerHTML = `<span class="ic ic-shield" aria-hidden="true"></span>
    <h1>Conectar ${esc(info.clientName)}</h1>
    <p><strong>${esc(info.clientName)}</strong> quiere acceso a tu cuenta de DocSure para crear y enviar documentos a firmar en tu nombre.</p>
    <p class="muted">Confirmá que tu asistente te muestra este mismo código:</p>
    <p class="device-code">${esc(info.userCode)}</p>
    <p class="form-error" role="alert" id="err"></p>
    <div class="modal-actions center-actions"><button class="btn btn-ghost" id="deny">Cancelar</button><button class="btn btn-primary btn-lg" id="approve">Autorizar</button></div>
    <p class="fine">Se crea una clave de API con su nombre. Podés revocarla cuando quieras desde API.</p>`;
  const decide = async (aprobar) => {
    try {
      await api('/api/agente', { method: 'POST', body: { codigo: info.userCode, aprobar } });
      if (aprobar) done('¡Listo! Tu asistente quedó conectado', 'Volvé a tu editor: tu asistente ya puede usar DocSure por vos.');
      else done('Conexión cancelada', 'Tu asistente no recibió acceso.');
    } catch (err) {
      document.getElementById('err').textContent = err.message;
    }
  };
  document.getElementById('approve').addEventListener('click', () => decide(true));
  document.getElementById('deny').addEventListener('click', () => decide(false));
} catch (err) {
  done('No se puede conectar', err.message);
}
