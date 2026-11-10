import { api, esc, fmtDate } from './app-common.js';

const $ = (id) => document.getElementById(id);

function copyButtons(root = document) {
  root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const text = $(b.dataset.copy).textContent;
    await navigator.clipboard.writeText(text).catch(() => {});
    const old = b.textContent;
    b.textContent = 'Copiado ✓';
    setTimeout(() => { b.textContent = old; }, 1500);
  }));
}

function showSecret(box, label, value) {
  box.hidden = false;
  box.innerHTML = `<p><strong>${esc(label)}</strong> Copiala ahora: no la vamos a volver a mostrar.</p>
    <pre class="code" id="${box.id}-value">${esc(value)}</pre><button class="btn btn-outline btn-sm" type="button" data-copy="${box.id}-value">Copiar</button>`;
  copyButtons(box);
}

async function loadKeys() {
  const { data } = await api('/api/claves');
  $('keys').innerHTML = data.length
    ? data.map((k) => `<li><div><strong>${esc(k.name)}</strong><small><code>${esc(k.prefix)}…</code> · creada ${fmtDate(k.created_at)}${k.created_via === 'agente' ? ' por un asistente' : ''} · ${k.last_used_at ? `último uso ${fmtDate(k.last_used_at, true)}` : 'sin uso'}</small></div>
      <button class="btn btn-danger btn-sm" data-revoke="${k.id}">Revocar</button></li>`).join('')
    : '<li class="muted">Todavía no creaste claves.</li>';
  $('keys').querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Revocar la clave? Las integraciones que la usen dejan de funcionar.')) return;
    await api(`/api/claves/${b.dataset.revoke}`, { method: 'DELETE' });
    await loadKeys();
  }));
}

async function loadHooks() {
  const { data } = await api('/api/webhooks');
  $('hooks').innerHTML = data.length
    ? data.map((h) => {
      const d = h.last_delivery;
      const status = d ? (d.status_code >= 200 && d.status_code < 300 ? `último envío OK (${d.status_code})` : `último envío falló (${esc(d.status_code || d.error || '—')})`) : 'sin envíos todavía';
      return `<li><div><strong>${esc(h.url)}</strong><small>${h.events.map(esc).join(', ')} · ${status}</small></div><button class="btn btn-danger btn-sm" data-del="${h.id}">Eliminar</button></li>`;
    }).join('')
    : '<li class="muted">Sin webhooks configurados.</li>';
  $('hooks').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/webhooks/${b.dataset.del}`, { method: 'DELETE' });
    await loadHooks();
  }));
}

$('key-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('key-err').textContent = '';
  try {
    const created = await api('/api/claves', { method: 'POST', body: { name: $('key-name').value } });
    $('key-name').value = '';
    showSecret($('new-key'), 'Clave creada.', created.key);
    await loadKeys();
  } catch (err) {
    $('key-err').textContent = err.message;
  }
});

$('hook-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('hook-err').textContent = '';
  try {
    const created = await api('/api/webhooks', { method: 'POST', body: { url: $('hook-url').value } });
    $('hook-url').value = '';
    showSecret($('new-hook'), 'Webhook creado. Este es su secreto de firma.', created.secret);
    await loadHooks();
  } catch (err) {
    $('hook-err').textContent = err.message;
  }
});

copyButtons();
await Promise.all([loadKeys(), loadHooks()]);
