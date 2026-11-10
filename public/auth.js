import { api } from './app-common.js';

const form = document.getElementById('auth-form');
const error = form.querySelector('.form-error');
const next = form.dataset.next || '/app';

/** Segundo paso: código de la app autenticadora o código de recuperación. */
function askSecondFactor(ticket) {
  form.innerHTML = `<p class="muted">Abrí tu app autenticadora y escribí el código de 6 dígitos de DocSure.</p>
    <label>Código de verificación<input name="code" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="11" required autofocus></label>
    <p class="muted small">¿Sin el celular? Escribí uno de tus códigos de recuperación (XXXX-XXXX).</p>
    <p class="form-error" role="alert"></p>
    <button class="btn btn-primary btn-block btn-lg" type="submit">Verificar</button>`;
  const err = form.querySelector('.form-error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    err.textContent = '';
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const res = await api('/api/auth/dos-pasos', { method: 'POST', body: { ticket, code: form.code.value } });
      // Con un código de recuperación, llevamos a Ajustes para que vea cuántos le quedan.
      location.href = res.used_recovery_code ? '/app/ajustes#seguridad' : next;
    } catch (ex) {
      err.textContent = ex.message;
      button.disabled = false;
      form.code.select();
    }
  };
  form.code.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (form.onsubmit) return;
  error.textContent = '';
  const data = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const res = await api(form.dataset.mode === 'registro' ? '/api/auth/registro' : '/api/auth/ingresar', { method: 'POST', body: data });
    if (res.two_factor) return askSecondFactor(res.ticket);
    location.href = next;
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
  }
});
