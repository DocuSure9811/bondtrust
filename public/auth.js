import { api } from './app-common.js';

const form = document.getElementById('auth-form');
const error = form.querySelector('.form-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  const data = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api(form.dataset.mode === 'registro' ? '/api/auth/registro' : '/api/auth/ingresar', { method: 'POST', body: data });
    location.href = form.dataset.next || '/app';
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
  }
});
