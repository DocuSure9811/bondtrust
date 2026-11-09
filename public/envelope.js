import { RECIPIENT_STATUS, api, esc, fmtDate, pill } from './app-common.js';

const root = document.getElementById('detail');
const id = location.pathname.split('/').pop();

const EVENT_LABELS = {
  created: 'Sobre creado',
  sent: 'Sobre enviado',
  email_sent: 'Invitación enviada',
  viewed: 'Abrió el enlace',
  otp_sent: 'Se envió el código de verificación',
  otp_failed: 'Ingresó un código incorrecto',
  otp_verified: 'Verificó su identidad',
  signed: 'Firmó el documento',
  declined: 'Rechazó el documento',
  resent: 'Se reenvió la invitación',
  voided: 'Sobre anulado',
  completed: 'Sobre completado y sellado',
};

async function download(which, title) {
  const res = await api(`/api/sobres/${id}/${which}.pdf`, { raw: true });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title}${which === 'final' ? ' - firmado' : ''}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function load() {
  const { envelope: e, recipients, events } = await api(`/api/sobres/${id}`);
  const byId = new Map(recipients.map((r) => [r.id, r]));
  document.title = `${e.title} | DocSure`;
  root.innerHTML = `
  <div class="detail-head">
    <div><a href="/app" class="small">← Mis documentos</a><h1>${esc(e.title)}</h1>${pill(e.status)}
      <span class="muted small"> Enviado ${fmtDate(e.sent_at, true)}${e.completed_at ? ` · Completado ${fmtDate(e.completed_at, true)}` : ''}</span></div>
    <div class="detail-actions">
      ${e.status === 'completed' ? '<button class="btn btn-primary" data-dl="final">Descargar firmado</button>' : ''}
      <button class="btn btn-ghost" data-dl="original">Descargar original</button>
      ${e.status === 'sent' ? '<button class="btn btn-danger" id="void">Anular sobre</button>' : ''}
    </div>
  </div>
  <p class="form-error" role="alert" id="msg"></p>
  <div class="detail-grid">
    <section class="card"><h2>Destinatarios</h2><ul class="rlist">${recipients.map((r) => `
      <li><div><strong>${esc(r.name)}</strong><small>${esc(r.email)} · ${r.role === 'cc' ? 'Recibe copia' : `Firmante${e.sequential ? ` · orden ${r.routing_order}` : ''}`}</small>
        ${r.decline_reason ? `<small>Motivo: “${esc(r.decline_reason)}”</small>` : ''}</div>
        <div>${r.role === 'signer' ? `<span class="status-pill status-${r.status === 'signed' ? 'completed' : r.status === 'declined' ? 'declined' : 'sent'}">${esc(RECIPIENT_STATUS[r.status])}</span>` : ''}
        ${e.status === 'sent' && ['sent', 'viewed'].includes(r.status) ? `<button class="btn btn-ghost btn-sm" data-resend="${r.id}">Reenviar</button>` : ''}</div></li>`).join('')}</ul>
      ${e.final_sha256 ? `<p class="fine">Huella SHA-256 del documento final: <code class="hash">${esc(e.final_sha256)}</code></p>` : ''}
      <p class="fine">Huella SHA-256 del original: <code class="hash">${esc(e.original_sha256)}</code></p>
    </section>
    <section class="card"><h2>Historial</h2><ol class="timeline">${events.map((ev) => `
      <li><time datetime="${esc(ev.created_at)}">${fmtDate(ev.created_at, true)}</time>${esc(EVENT_LABELS[ev.type] || ev.type)}${ev.recipient_id && byId.get(ev.recipient_id) ? ` · ${esc(byId.get(ev.recipient_id).name)}` : ''}</li>`).join('')}</ol></section>
  </div>`;

  const msg = document.getElementById('msg');
  root.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => download(b.dataset.dl, e.title).catch((err) => { msg.textContent = err.message; })));
  root.querySelectorAll('[data-resend]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api(`/api/sobres/${id}/destinatarios/${b.dataset.resend}/reenviar`, { method: 'POST' });
      msg.className = 'form-ok';
      msg.textContent = 'Invitación reenviada. El enlace anterior dejó de funcionar.';
      await load();
    } catch (err) {
      msg.className = 'form-error';
      msg.textContent = err.message;
      b.disabled = false;
    }
  }));
  const voidBtn = document.getElementById('void');
  if (voidBtn) voidBtn.addEventListener('click', async () => {
    if (!confirm('¿Anular el sobre? Los firmantes ya no podrán firmar.')) return;
    try {
      await api(`/api/sobres/${id}/anular`, { method: 'POST' });
      await load();
    } catch (err) {
      msg.textContent = err.message;
    }
  });
}

load().catch((err) => {
  root.innerHTML = `<div class="empty"><h1>No se pudo abrir el sobre</h1><p class="muted">${esc(err.message)}</p><a class="btn btn-primary" href="/app">Volver</a></div>`;
});
