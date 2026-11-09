import { api, esc, fmtDate } from './app-common.js';

const input = document.getElementById('verify-file');
const zone = document.getElementById('verify-form');
const out = document.getElementById('verify-result');

async function check(file) {
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) {
    out.innerHTML = '<div class="result-card result-bad"><p>El archivo supera 15 MB.</p></div>';
    return;
  }
  out.innerHTML = '<p class="muted">Verificando…</p>';
  try {
    const { seal, record, sha256 } = await api('/api/verificar', { method: 'POST', body: await file.arrayBuffer() });
    let cls = 'result-bad';
    let title = 'El documento no es válido';
    if (seal.intact && seal.issuedByDocSure && record) {
      cls = 'result-ok';
      title = 'Documento auténtico y sin alteraciones';
    } else if (seal.intact && seal.issuedByDocSure) {
      cls = 'result-ok';
      title = 'Sello de DocSure válido';
    } else if (!seal.signed) {
      cls = 'result-warn';
      title = 'Este PDF no tiene sello digital';
    }
    const signers = record?.signers?.length
      ? `<p><strong>Firmantes</strong></p><ul>${record.signers.map((s) => `<li>${esc(s.name)} (${esc(s.email)}) · ${fmtDate(s.signedAt, true)}</li>`).join('')}</ul>`
      : '';
    out.innerHTML = `<div class="result-card ${cls}"><h2>${title}</h2>
      <p>${esc(seal.reason)}</p>
      ${seal.signed && !seal.issuedByDocSure && seal.intact ? '<p>El sello es íntegro pero no fue emitido por DocSure.</p>' : ''}
      ${record ? `<p><strong>${esc(record.title)}</strong> · completado ${fmtDate(record.completed_at, true)} · ID ${esc(record.id)}</p>${signers}` : ''}
      <p class="fine">SHA-256 del archivo: <code class="hash">${esc(sha256)}</code></p></div>`;
  } catch (err) {
    out.innerHTML = `<div class="result-card result-bad"><p>${esc(err.message)}</p></div>`;
  }
}

input.addEventListener('change', () => check(input.files[0]));
['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, () => zone.classList.remove('drag')));
zone.addEventListener('drop', (e) => { e.preventDefault(); check(e.dataTransfer.files[0]); });
zone.addEventListener('submit', (e) => e.preventDefault());
