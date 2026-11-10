import { api, esc, fmtDate } from './app-common.js';

const $ = (id) => document.getElementById(id);
const TRIGGER = { completed: 'se completa', declined: 'es rechazado', expired: 'vence sin firmas' };
const HINT = {
  move_folder: 'El sobre se mueve a la carpeta elegida apenas ocurre el evento.',
  send_copy: 'Le enviamos un enlace para descargar el PDF firmado y sellado. El enlace vence en 30 días.',
  notify: 'Le avisamos por email con un enlace al sobre en tu panel.',
};
let folders = [];

function say(text, ok = false) {
  $('au-msg').className = ok ? 'form-ok' : 'form-error';
  $('au-msg').textContent = text;
}

/** Muestra el campo que corresponde a la acción y bloquea combinaciones imposibles. */
function syncForm() {
  const action = $('au-action').value;
  const copy = $('au-action').querySelector('[value=send_copy]');
  copy.disabled = $('au-trigger').value !== 'completed';
  if (copy.disabled && action === 'send_copy') $('au-action').value = 'notify';
  const current = $('au-action').value;
  $('au-folder').hidden = current !== 'move_folder';
  $('au-email').hidden = current === 'move_folder';
  $('au-hint').textContent = HINT[current];
}

function sentence(r) {
  const when = `Cuando un sobre <strong>${TRIGGER[r.trigger]}</strong>`;
  const cond = r.title_contains ? ` y su título contiene <strong>“${esc(r.title_contains)}”</strong>` : '';
  const then = r.action === 'move_folder'
    ? (r.folder_name ? `moverlo a <strong>${esc(r.folder_name)}</strong>` : '<span class="form-error">la carpeta ya no existe</span>')
    : r.action === 'send_copy' ? `enviar una copia firmada a <strong>${esc(r.email)}</strong>` : `avisar a <strong>${esc(r.email)}</strong>`;
  return `${when}${cond}, ${then}.`;
}

async function load() {
  const [{ data: rules }, { data: f }] = await Promise.all([api('/api/automatizaciones'), api('/api/carpetas')]);
  folders = f;
  $('au-folder').innerHTML = folders.length ? folders.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('') : '<option value="">Primero creá una carpeta en Documentos</option>';
  $('au-count').textContent = rules.length ? `${rules.length} regla(s)` : '';
  $('au-list').innerHTML = rules.length ? rules.map((r) => `<li class="rule${r.active ? '' : ' is-paused'}"><div><strong>${esc(r.name)}</strong><small>${sentence(r)}</small>
      <small class="muted">${r.runs ? `Se ejecutó ${r.runs} vez/veces · última ${fmtDate(r.last_run_at, true)}` : 'Todavía no se ejecutó'}</small></div>
      <div class="tpl-actions"><label class="switch small"><input type="checkbox" data-toggle="${r.id}"${r.active ? ' checked' : ''}> Activa</label>
      <button class="btn btn-ghost btn-sm" type="button" data-del="${r.id}">Borrar</button></div></li>`).join('')
    : '<li class="muted">Todavía no tenés reglas. Creá la primera arriba.</li>';
}

$('au-trigger').addEventListener('change', syncForm);
$('au-action').addEventListener('change', syncForm);

$('au-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const action = $('au-action').value;
  const body = { trigger: $('au-trigger').value, action, title_contains: $('au-title').value.trim(), name: $('au-name').value.trim() };
  if (action === 'move_folder') body.folder_id = $('au-folder').value; else body.email = $('au-email').value.trim();
  try {
    await api('/api/automatizaciones', { method: 'POST', body });
    $('au-form').reset();
    syncForm();
    await load();
    say('Regla creada. Se aplica desde ahora a tus sobres.', true);
  } catch (err) {
    say(err.message);
  }
});

$('au-list').addEventListener('change', async (ev) => {
  const id = ev.target.dataset.toggle;
  if (!id) return;
  try {
    await api(`/api/automatizaciones/${id}`, { method: 'PUT', body: { active: ev.target.checked } });
    await load();
    say(ev.target.checked ? 'Regla activada.' : 'Regla pausada.', true);
  } catch (err) {
    ev.target.checked = !ev.target.checked;
    say(err.message);
  }
});

$('au-list').addEventListener('click', async (ev) => {
  const id = ev.target.dataset.del;
  if (!id || !confirm('¿Borrar esta regla?')) return;
  try {
    await api(`/api/automatizaciones/${id}`, { method: 'DELETE' });
    await load();
    say('Regla borrada.', true);
  } catch (err) {
    say(err.message);
  }
});

syncForm();
load().catch((err) => say(err.message));
