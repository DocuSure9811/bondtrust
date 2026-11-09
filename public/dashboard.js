import { api, esc, fmtDate, pill } from './app-common.js';

const list = document.getElementById('list');
const stats = document.getElementById('stats');
const tabs = [...document.querySelectorAll('#filters [data-filter]')];
let envelopes = [];
let filter = 'all';

function matches(e) {
  if (filter === 'all') return true;
  if (filter === 'closed') return e.status === 'declined' || e.status === 'voided';
  return e.status === filter;
}

function render() {
  const rows = envelopes.filter(matches);
  if (envelopes.length === 0) {
    list.innerHTML = `<div class="empty"><h2>Todavía no enviaste documentos</h2><p class="muted">Subí un PDF, agregá a los firmantes y enviálo en menos de un minuto.</p><a class="btn btn-primary" href="/app/nuevo">Crear mi primer sobre</a></div>`;
    return;
  }
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty"><p class="muted">No hay sobres en esta vista.</p></div>';
    return;
  }
  list.innerHTML = rows
    .map((e) => {
      const href = e.status === 'draft' ? `/app/nuevo?id=${e.id}` : `/app/sobres/${e.id}`;
      const progress = e.status === 'draft' ? 'Borrador sin enviar' : `${e.signed} de ${e.signers} firmas`;
      return `<a class="env-row" href="${href}"><div><h2>${esc(e.title)}</h2><p>${progress}</p></div>
        <span class="env-date muted small">${fmtDate(e.completed_at || e.sent_at || e.created_at)}</span>${pill(e.status)}</a>`;
    })
    .join('');
}

tabs.forEach((t) => t.addEventListener('click', () => {
  filter = t.dataset.filter;
  tabs.forEach((o) => o.setAttribute('aria-selected', String(o === t)));
  render();
}));

try {
  const [me, data] = await Promise.all([api('/api/me'), api('/api/sobres')]);
  envelopes = data.envelopes;
  const pending = envelopes.filter((e) => e.status === 'sent').length;
  const done = envelopes.filter((e) => e.status === 'completed').length;
  const limit = me.plan.monthlyEnvelopes;
  stats.innerHTML = [
    [pending, 'Esperando firmas'],
    [done, 'Completados'],
    [envelopes.filter((e) => e.status === 'draft').length, 'Borradores'],
    [limit === null ? `${me.usage.envelopesThisMonth}` : `${me.usage.envelopesThisMonth}/${limit}`, `Enviados este mes · plan ${me.plan.name}`],
  ].map(([n, label]) => `<div class="stat"><strong>${esc(n)}</strong><span>${esc(label)}</span></div>`).join('');
  render();
} catch (err) {
  list.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
}
