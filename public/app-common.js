export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { 'X-DocSure': '1', ...headers }, credentials: 'same-origin' };
  if (body instanceof ArrayBuffer || body instanceof Uint8Array) {
    opts.body = body;
    opts.headers['Content-Type'] = headers['Content-Type'] || 'application/pdf';
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, opts);
  if (res.status === 401 && location.pathname.startsWith('/app')) {
    location.href = `/ingresar?next=${encodeURIComponent(location.pathname)}`;
    throw new Error('Sesión vencida');
  }
  if (raw) {
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo descargar.');
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Ocurrió un error. Probá de nuevo.');
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const STATUS = {
  draft: 'Borrador',
  sent: 'En curso',
  completed: 'Completado',
  declined: 'Rechazado',
  voided: 'Anulado',
  expired: 'Vencido',
};

export const RECIPIENT_STATUS = {
  created: 'En espera',
  sent: 'Invitación enviada',
  viewed: 'Abrió el enlace',
  signed: 'Firmó',
  declined: 'Rechazó',
};

export function fmtDate(value, withTime = false) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-AR', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

export function pill(status) {
  return `<span class="status-pill status-${esc(status)}">${esc(STATUS[status] || status)}</span>`;
}

const logout = document.getElementById('logout');
if (logout) {
  logout.addEventListener('click', async () => {
    await api('/api/auth/salir', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });
}
