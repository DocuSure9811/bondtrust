import { api, esc, fmtDate } from './app-common.js';

const $ = (id) => document.getElementById(id);
const EVENT = {
  signup: 'Cuenta creada',
  login: 'Ingreso',
  login_failed: 'Contraseña incorrecta',
  login_recovery_code: 'Ingreso con código de recuperación',
  two_factor_failed: 'Código de verificación incorrecto',
  two_factor_enabled: 'Verificación en dos pasos activada',
  two_factor_disabled: 'Verificación en dos pasos desactivada',
  password_changed: 'Contraseña cambiada',
  password_change_failed: 'Intento fallido de cambiar la contraseña',
  session_revoked: 'Sesión cerrada desde Ajustes',
  sessions_revoked: 'Se cerraron las demás sesiones',
};
const RISKY = new Set(['login_failed', 'two_factor_failed', 'password_change_failed', 'login_recovery_code']);

/** Nombre legible del navegador y sistema a partir del user-agent. */
function device(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} en ${os}` : browser;
}

function say(id, text, ok = false) {
  $(id).className = ok ? 'form-ok' : 'form-error';
  $(id).textContent = text;
}

function renderTwoFactor(tf) {
  const box = $('tfa');
  if (tf.enabled) {
    box.innerHTML = `<p><span class="status-pill status-completed">Activada</span> desde el ${fmtDate(tf.enabled_at)}. Te quedan <strong>${tf.recovery_left}</strong> códigos de recuperación.</p>
      ${tf.recovery_left <= 3 ? '<p class="form-error">Te quedan pocos códigos de recuperación: desactivá y volvé a activar la verificación para generar códigos nuevos.</p>' : ''}
      <details><summary>Desactivar</summary><form id="tfa-off" class="stack-form" novalidate>
        <label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label>
        <label>Código de la app o de recuperación<input name="code" autocomplete="one-time-code" maxlength="11" required></label>
        <p class="form-error" role="alert" id="tfa-msg"></p>
        <button class="btn btn-danger btn-sm" type="submit">Desactivar verificación en dos pasos</button></form></details>`;
    $('tfa-off').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/seguridad/dos-pasos/desactivar', { method: 'POST', body: { password: e.target.password.value, code: e.target.code.value } });
        await load();
      } catch (err) {
        say('tfa-msg', err.message);
      }
    });
    return;
  }
  box.innerHTML = `<p class="muted">Además de la contraseña, te vamos a pedir un código de tu celular al ingresar. Funciona con Google Authenticator, Microsoft Authenticator, 1Password, Authy y similares.</p>
    <button class="btn btn-primary" type="button" id="tfa-start">Activar verificación en dos pasos</button>`;
  $('tfa-start').addEventListener('click', async () => {
    const setup = await api('/api/seguridad/dos-pasos/iniciar', { method: 'POST' });
    box.innerHTML = `<ol class="tfa-steps">
        <li>Escaneá este código con tu app autenticadora:<div class="qr" role="img" aria-label="Código QR para la app autenticadora">${setup.qr_svg}</div>
          <p class="muted small">¿No podés escanear? Cargá esta clave a mano: <code class="hash" id="tfa-secret">${esc(setup.secret)}</code></p></li>
        <li><form id="tfa-on" class="inline-form" novalidate><label class="visually-hidden" for="tfa-code">Código de 6 dígitos</label>
          <input id="tfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="Código de 6 dígitos" required>
          <button class="btn btn-primary" type="submit">Confirmar</button></form><p class="form-error" role="alert" id="tfa-msg"></p></li>
      </ol>`;
    $('tfa-on').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api('/api/seguridad/dos-pasos/activar', { method: 'POST', body: { code: $('tfa-code').value } });
        box.innerHTML = `<p class="form-ok"><strong>Listo, la verificación en dos pasos está activa.</strong></p>
          <div class="new-secret"><p><strong>Guardá estos códigos de recuperación</strong> en un lugar seguro. Cada uno sirve una sola vez si perdés el celular. No los vamos a volver a mostrar.</p>
          <pre class="code recovery" id="recovery-codes">${res.recovery_codes.map(esc).join('\n')}</pre>
          <button class="btn btn-outline btn-sm" type="button" id="copy-codes">Copiar códigos</button> <button class="btn btn-ghost btn-sm" type="button" id="tfa-done">Ya los guardé</button></div>`;
        $('copy-codes').addEventListener('click', async () => {
          await navigator.clipboard.writeText(res.recovery_codes.join('\n')).catch(() => {});
          $('copy-codes').textContent = 'Copiados';
        });
        $('tfa-done').addEventListener('click', load);
        await loadLists();
      } catch (err) {
        say('tfa-msg', err.message);
      }
    });
    $('tfa-code').focus();
  });
}

function renderLists(data) {
  $('sessions').innerHTML = data.sessions.map((s) => `<li data-session="${s.id}"><div><strong>${esc(device(s.user_agent || ''))}${s.current ? ' · esta sesión' : ''}</strong>
    <small>IP ${esc(s.ip || '—')} · última actividad ${fmtDate(s.last_seen_at, true)} · inició ${fmtDate(s.created_at)}</small></div>
    ${s.current ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-close>Cerrar</button>'}</li>`).join('');
  $('close-others').hidden = data.sessions.length < 2;
  $('activity').innerHTML = data.events.length
    ? data.events.map((ev) => `<li class="${RISKY.has(ev.type) ? 'risky' : ''}"><time datetime="${esc(ev.created_at)}">${fmtDate(ev.created_at, true)}</time> ${esc(EVENT[ev.type] || ev.type)} <span class="muted">· ${esc(device(ev.user_agent || ''))} · IP ${esc(ev.ip || '—')}</span></li>`).join('')
    : '<li class="muted">Sin movimientos todavía.</li>';
}

async function loadLists() {
  renderLists(await api('/api/seguridad'));
}

async function load() {
  const data = await api('/api/seguridad');
  renderTwoFactor(data.two_factor);
  renderLists(data);
}

$('sessions').addEventListener('click', async (e) => {
  if (!e.target.matches('[data-close]')) return;
  try {
    await api(`/api/seguridad/sesiones/${e.target.closest('li').dataset.session}`, { method: 'DELETE' });
    await loadLists();
  } catch (err) {
    say('sess-msg', err.message);
  }
});
$('close-others').addEventListener('click', async () => {
  const res = await api('/api/seguridad/sesiones/cerrar-otras', { method: 'POST' });
  say('sess-msg', `Se cerraron ${res.closed} sesión(es).`, true);
  await loadLists();
});
$('pwd-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/seguridad/contrasena', { method: 'POST', body: { current_password: f.current_password.value, new_password: f.new_password.value } });
    f.reset();
    say('pwd-msg', 'Contraseña cambiada. Cerramos tus otras sesiones.', true);
    await loadLists();
  } catch (err) {
    say('pwd-msg', err.message);
  }
});

load().catch((err) => { $('tfa').innerHTML = `<p class="form-error">${esc(err.message)}</p>`; });
