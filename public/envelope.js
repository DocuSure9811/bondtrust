import { RECIPIENT_STATUS, api, esc, fmtDate, pill } from './app-common.js';

const root = document.getElementById('detail');
const id = location.pathname.split('/').pop();

const EVENT_LABELS = {
  created: 'Sobre creado',
  document_added: 'Documento agregado',
  document_removed: 'Documento quitado',
  attachment_uploaded: 'Archivo adjuntado',
  sent: 'Sobre enviado',
  email_sent: 'Invitación enviada',
  reminder_sent: 'Recordatorio enviado',
  viewed: 'Abrió el enlace',
  otp_sent: 'Se envió el código de verificación',
  otp_failed: 'Ingresó un código incorrecto',
  otp_verified: 'Verificó su identidad',
  in_person_started: 'Firma en persona iniciada',
  in_person_verified: 'Identidad atestiguada en persona',
  signed: 'Firmó el documento',
  declined: 'Rechazó el documento',
  resent: 'Se reenvió la invitación',
  extended: 'Se extendió el vencimiento',
  corrected: 'Sobre corregido',
  voided: 'Sobre anulado',
  expired: 'Sobre vencido',
  completed: 'Sobre completado y sellado',
  contract_updated: 'Se actualizó el vencimiento del contrato',
  version_created: 'Se creó una versión nueva',
  renewal_notified: 'Aviso de renovación enviado',
};
const LANG = { es: 'Español', en: 'English', pt: 'Português', fr: 'Français', de: 'Deutsch', it: 'Italiano' };
const NOTICE = [7, 15, 30, 60, 90];
const STATUS_TEXT = { draft: 'Borrador', sent: 'En curso', completed: 'Completado', declined: 'Rechazado', voided: 'Anulado', expired: 'Vencido' };

/** Texto del estado del aviso de renovación. */
function contractStatus(c) {
  if (!c.contract_end) return 'Cargá la fecha de vencimiento y te avisamos por email antes de que venza.';
  const end = new Date(`${c.contract_end}T12:00:00Z`);
  const days = Math.round((end - Date.now()) / 86400000);
  const when = days > 0 ? `Vence en ${days} día(s)` : days === 0 ? 'Vence hoy' : 'Venció';
  const notice = c.renewal_notified_at ? 'Ya te enviamos el aviso.' : `Te avisamos por email ${c.renewal_notice_days} días antes.`;
  return `${when} (${end.toLocaleDateString('es-AR', { timeZone: 'UTC' })}). ${notice}`;
}

async function download(which, title) {
  const res = await api(`/api/sobres/${id}/${which}.pdf`, { raw: true });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title}${which === 'final' ? ' - firmado' : ''}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function say(text, ok = false) {
  const msg = document.getElementById('msg');
  msg.className = ok ? 'form-ok' : 'form-error';
  msg.textContent = text;
}

async function load() {
  const [{ envelope: e, recipients, events, attachments }, { data: folders }, contract] = await Promise.all([api(`/api/sobres/${id}`), api('/api/carpetas'), api(`/api/sobres/${id}/contrato`)]);
  if (e.status === 'draft' && e.can_edit) return location.replace(`/app/nuevo?id=${id}`);
  const edit = e.can_edit;
  const byId = new Map(recipients.map((r) => [r.id, r]));
  const canCorrect = ['sent', 'declined', 'expired', 'voided'].includes(e.status);
  document.title = `${e.title} | DocSure`;
  root.innerHTML = `
  <div class="detail-head">
    <div><a href="/app" class="small">← Mis documentos</a><h1>${esc(e.title)}</h1>${pill(e.status)}
      <span class="muted small"> Enviado ${fmtDate(e.sent_at, true)}${e.completed_at ? ` · Completado ${fmtDate(e.completed_at, true)}` : ''}${e.status === 'sent' && e.expires_at ? ` · Vence ${fmtDate(e.expires_at)}` : ''}</span>
      <p class="muted small">Idioma: ${LANG[e.language] || 'Español'} · ${e.reminder_days ? `Recordatorios cada ${e.reminder_days} día(s)` : 'Sin recordatorios'}${e.corrected_from ? ` · <a href="/app/sobres/${esc(e.corrected_from)}">Corrige un sobre anterior</a>` : ''}</p>
      ${edit ? '' : `<p class="muted small">Enviado por <strong>${esc(e.owner_name)}</strong> (${esc(e.owner_email)}) · vista de administrador del equipo, solo lectura.</p>`}
      <label class="inline-select"${edit ? '' : ' hidden'}>Carpeta <select id="env-folder"><option value="">Sin carpeta</option>${folders.map((f) => `<option value="${f.id}"${f.id === e.folder_id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label></div>
    <div class="detail-actions">
      ${e.status === 'completed' ? '<button class="btn btn-primary" data-dl="final">Descargar firmado</button>' : ''}
      <button class="btn btn-ghost" data-dl="original">Descargar original</button>
      ${edit && e.status === 'sent' ? '<button class="btn btn-ghost" id="extend">Extender vencimiento</button>' : ''}
      ${edit && canCorrect ? '<button class="btn btn-ghost" id="correct">Corregir</button>' : ''}
      ${edit ? '<button class="btn btn-ghost" id="save-tpl">Guardar como plantilla</button>' : ''}
      ${edit && e.status === 'sent' ? '<button class="btn btn-danger" id="void">Anular</button>' : ''}
    </div>
  </div>
  <p class="form-error" role="alert" id="msg"></p>
  <div class="detail-grid">
    <section class="card"><h2>Destinatarios</h2><ul class="rlist">${recipients.map((r) => `
      <li><div><strong>${esc(r.name)}</strong><small>${esc(r.email)} · ${r.role === 'cc' ? 'Recibe copia' : `Firmante${e.sequential ? ` · orden ${r.routing_order}` : ''}`}</small>
        ${r.decline_reason ? `<small>Motivo: “${esc(r.decline_reason)}”</small>` : ''}</div>
        <div class="tpl-actions">${r.role === 'signer' ? `<span class="status-pill status-${r.status === 'signed' ? 'completed' : r.status === 'declined' ? 'declined' : 'sent'}">${esc(RECIPIENT_STATUS[r.status])}</span>` : ''}
        ${edit && e.status === 'sent' && ['sent', 'viewed'].includes(r.status) ? `<button class="btn btn-ghost btn-sm" data-resend="${r.id}">Reenviar</button><button class="btn btn-ghost btn-sm" data-inperson="${r.id}">Firmar en persona</button>` : ''}</div></li>`).join('')}</ul>
      ${attachments.length ? `<h3 class="small-title">Archivos adjuntos</h3><ul class="rlist">${attachments.map((a) => `<li><div><strong>${esc(a.name)}</strong><small>${esc(a.label || 'Adjunto')} · ${esc(byId.get(a.recipient_id)?.name || '')} · ${Math.ceil(a.size / 1024)} KB</small></div><button class="btn btn-ghost btn-sm" data-attachment="${a.id}" data-name="${esc(a.name)}">Descargar</button></li>`).join('')}</ul>` : ''}
      ${e.final_sha256 ? `<p class="fine">Huella SHA-256 del documento final: <code class="hash">${esc(e.final_sha256)}</code></p>` : ''}
      <p class="fine">Huella SHA-256 del original: <code class="hash">${esc(e.original_sha256)}</code></p>
      ${e.documents.length > 1 ? `<p class="fine"><strong>Documentos (${e.documents.length}):</strong> ${e.documents.map((d) => `${esc(d.name)} (${d.pages} pág.)`).join(' · ')}</p>` : ''}
    </section>
    <section class="card" id="contract"><h2>Contrato</h2>
      <div class="contract-row">
        <label>Vencimiento del contrato<input type="date" id="c-end" value="${esc(contract.contract_end || '')}"${edit ? '' : ' disabled'}></label>
        <label>Avisarme<select id="c-notice"${edit ? '' : ' disabled'}>${NOTICE.map((d) => `<option value="${d}"${d === contract.renewal_notice_days ? ' selected' : ''}>${d} días antes</option>`).join('')}</select></label>
        ${edit ? '<button class="btn btn-ghost btn-sm" id="c-save" type="button">Guardar</button>' : ''}
      </div>
      <p class="fine" id="c-status">${contractStatus(contract)}</p>
      <h3 class="small-title">Versiones</h3>
      <ol class="versions">${contract.versions.map((v) => `<li${v.id === id ? ' aria-current="true"' : ''}><a href="/app/sobres/${esc(v.id)}">Versión ${v.version}</a> · ${esc(STATUS_TEXT[v.status] || v.status)} · ${fmtDate(v.completed_at || v.created_at)}</li>`).join('')}</ol>
      ${edit ? '<button class="btn btn-ghost btn-sm" id="new-version" type="button">Nueva versión</button>' : ''}
    </section>
    <section class="card"><h2>Historial</h2><ol class="timeline">${events.map((ev) => `
      <li><time datetime="${esc(ev.created_at)}">${fmtDate(ev.created_at, true)}</time>${esc(EVENT_LABELS[ev.type] || ev.type)}${ev.recipient_id && byId.get(ev.recipient_id) ? ` · ${esc(byId.get(ev.recipient_id).name)}` : ''}</li>`).join('')}</ol></section>
  </div>`;

  const on = (sel, fn) => root.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => fn(b).catch((err) => { say(err.message); b.disabled = false; })));
  on('[data-dl]', (b) => download(b.dataset.dl, e.title));
  root.querySelector('#env-folder').addEventListener('change', async (ev) => {
    try {
      await api(`/api/sobres/${id}/carpeta`, { method: 'PUT', body: { folderId: ev.target.value || null } });
      say('Carpeta actualizada.', true);
    } catch (err) {
      say(err.message);
    }
  });
  on('[data-attachment]', async (b) => {
    const res = await api(`/api/sobres/${id}/adjuntos/${b.dataset.attachment}`, { raw: true });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = b.dataset.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  on('[data-resend]', async (b) => {
    b.disabled = true;
    await api(`/api/sobres/${id}/destinatarios/${b.dataset.resend}/reenviar`, { method: 'POST' });
    await load();
    say('Invitación reenviada. El enlace y el código anteriores dejaron de funcionar.', true);
  });
  on('[data-inperson]', async (b) => {
    if (!confirm('Vas a abrir la firma en este dispositivo para que el firmante firme frente a vos. El enlace del email deja de funcionar. ¿Continuar?')) return;
    b.disabled = true;
    const { url } = await api(`/api/sobres/${id}/destinatarios/${b.dataset.inperson}/en-persona`, { method: 'POST' });
    location.href = url;
  });
  on('#extend', async () => {
    const days = prompt('¿Cuántos días más, contando desde hoy? (1 a 120)', '15');
    if (!days) return;
    await api(`/api/sobres/${id}/extender`, { method: 'POST', body: { days: Number(days) } });
    await load();
    say(`Vencimiento extendido ${days} días.`, true);
  });
  on('#correct', async () => {
    const extra = e.status === 'sent' ? ' El sobre actual se anula (no consume tu cupo).' : '';
    if (!confirm(`Se crea un borrador idéntico para que lo edites y lo vuelvas a enviar.${extra} ¿Continuar?`)) return;
    const { id: newId } = await api(`/api/sobres/${id}/corregir`, { method: 'POST' });
    location.href = `/app/nuevo?id=${newId}`;
  });
  on('#c-save', async (b) => {
    b.disabled = true;
    const saved = await api(`/api/sobres/${id}/contrato`, { method: 'PUT', body: { contract_end: root.querySelector('#c-end').value || null, renewal_notice_days: Number(root.querySelector('#c-notice').value) } });
    root.querySelector('#c-status').textContent = contractStatus(saved);
    b.disabled = false;
    say(saved.contract_end ? 'Vencimiento guardado.' : 'Vencimiento quitado.', true);
  });
  on('#new-version', async () => {
    if (!confirm('Se crea un borrador con los mismos documentos, firmantes y campos, enlazado como versión nueva. ¿Continuar?')) return;
    const { id: newId } = await api(`/api/sobres/${id}/nueva-version`, { method: 'POST' });
    location.href = `/app/nuevo?id=${newId}`;
  });
  on('#save-tpl', async () => {
    const name = prompt('Nombre de la plantilla', e.title);
    if (!name) return;
    await api('/api/plantillas', { method: 'POST', body: { envelopeId: id, name } });
    say('Plantilla guardada. La encontrás en Plantillas.', true);
  });
  on('#void', async () => {
    if (!confirm('¿Anular el sobre? Los firmantes ya no podrán firmar. Los sobres anulados no consumen cupo.')) return;
    await api(`/api/sobres/${id}/anular`, { method: 'POST' });
    await load();
  });
}

load().catch((err) => {
  root.innerHTML = `<div class="empty"><h1>No se pudo abrir el sobre</h1><p class="muted">${esc(err.message)}</p><a class="btn btn-primary" href="/app">Volver</a></div>`;
});
