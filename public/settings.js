import { api, esc } from './app-common.js';

const form = document.getElementById('account-form');
const accountMsg = document.getElementById('account-msg');
const logoMsg = document.getElementById('logo-msg');
const preview = document.getElementById('logo-preview');
const delBtn = document.getElementById('logo-delete');
const controls = [...form.elements, document.getElementById('logo-file')];
controls.forEach((c) => { c.disabled = true; });

function fill(s) {
  form.name.value = s.name;
  form.company.value = s.company || '';
  form.brand_color.value = s.brand_color || '#0e7c66';
  preview.innerHTML = s.logo_url ? `<img alt="Tu logo" src="${esc(s.logo_url)}?t=${Date.now()}">` : '<p class="muted small">Sin logo: se muestra el nombre de tu empresa.</p>';
  delBtn.hidden = !s.logo_url;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  accountMsg.className = 'form-error';
  accountMsg.textContent = '';
  try {
    fill(await api('/api/ajustes', { method: 'PUT', body: { name: form.name.value, company: form.company.value, brand_color: form.brand_color.value } }));
    accountMsg.className = 'form-ok';
    accountMsg.textContent = 'Guardado.';
  } catch (err) {
    accountMsg.textContent = err.message;
  }
});

document.getElementById('logo-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  logoMsg.textContent = '';
  if (!file) return;
  if (!['image/png', 'image/jpeg'].includes(file.type)) return void (logoMsg.textContent = 'El logo debe ser PNG o JPG.');
  if (file.size > 200 * 1024) return void (logoMsg.textContent = 'El logo supera 200 KB.');
  try {
    const res = await fetch('/api/ajustes/logo', { method: 'PUT', headers: { 'X-DocSure': '1', 'Content-Type': file.type }, body: file, credentials: 'same-origin' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'No se pudo subir el logo.');
    fill(body);
  } catch (err) {
    logoMsg.textContent = err.message;
  }
});

delBtn.addEventListener('click', async () => fill(await api('/api/ajustes/logo', { method: 'DELETE' })));

const [settings, me] = await Promise.all([api('/api/ajustes'), api('/api/me')]);
fill(settings);
controls.forEach((c) => { c.disabled = false; });
const limit = me.plan.monthlyEnvelopes;
document.getElementById('plan-info').textContent = `Plan ${me.plan.name}: ${limit === null ? 'sobres ilimitados' : `${me.usage.envelopesThisMonth} de ${limit} sobres usados este mes`}. Los sobres anulados o corregidos no cuentan.`;
