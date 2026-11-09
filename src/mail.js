import { escapeHtml } from './validate.js';

function layout({ title, intro, buttonText, buttonUrl, outro = '' }) {
  const button = buttonUrl
    ? `<p style="margin:28px 0"><a href="${escapeHtml(buttonUrl)}" style="background:#0e7c66;color:#ffffff;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(buttonText)}</a></p>`
    : '';
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f7f6;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#10231e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:20px;font-weight:700;color:#0e7c66">DocSure</td></tr>
<tr><td><h1 style="font-size:22px;margin:24px 0 12px">${escapeHtml(title)}</h1>
<div style="font-size:15px;line-height:1.6">${intro}</div>${button}
<div style="font-size:13px;line-height:1.6;color:#4b5f59">${outro}</div></td></tr>
</table>
<p style="font-size:12px;color:#6b7d78;margin-top:16px">DocSure · Firma electrónica segura · docsure.app</p>
</td></tr></table></body></html>`;
}

export const templates = {
  signRequest({ senderName, recipientName, title, message, url, expiresAt }) {
    const note = message ? `<p style="background:#f4f7f6;border-radius:10px;padding:12px 16px">“${escapeHtml(message)}”</p>` : '';
    return {
      subject: `${senderName} te pidió firmar: ${title}`,
      html: layout({
        title: 'Tenés un documento para firmar',
        intro: `<p>Hola ${escapeHtml(recipientName)}, <strong>${escapeHtml(senderName)}</strong> te envió <strong>${escapeHtml(title)}</strong> para firmar.</p>${note}`,
        buttonText: 'Revisar y firmar',
        buttonUrl: url,
        outro: `El enlace es personal, de un solo uso y vence el ${escapeHtml(expiresAt)}. Antes de firmar te vamos a enviar un código de verificación a este email. No reenvíes este mensaje.`,
      }),
      text: `${senderName} te pidió firmar "${title}". ${message ? `Mensaje: ${message}. ` : ''}Firmá acá: ${url} (vence el ${expiresAt}).`,
    };
  },
  otp({ recipientName, code, title }) {
    return {
      subject: `Tu código de verificación de DocSure: ${code}`,
      html: layout({
        title: 'Código de verificación',
        intro: `<p>Hola ${escapeHtml(recipientName)}, usá este código para firmar <strong>${escapeHtml(title)}</strong>:</p><p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:20px 0">${code}</p>`,
        outro: 'Vence en 10 minutos. Si no fuiste vos, ignorá este email: nadie puede firmar sin este código.',
      }),
      text: `Tu código de verificación para firmar "${title}" es ${code}. Vence en 10 minutos.`,
    };
  },
  completed({ recipientName, title, url }) {
    return {
      subject: `Completado: ${title}`,
      html: layout({
        title: 'Documento firmado por todas las partes',
        intro: `<p>Hola ${escapeHtml(recipientName)}, <strong>${escapeHtml(title)}</strong> ya tiene todas las firmas. Descargá tu copia con el certificado de finalización y el sello digital.</p>`,
        buttonText: 'Descargar documento',
        buttonUrl: url,
        outro: 'Podés comprobar en cualquier momento que el documento no fue alterado en docsure.app/verificar.',
      }),
      text: `"${title}" fue firmado por todas las partes. Descargalo acá: ${url}`,
    };
  },
  declined({ ownerName, title, recipientName, reason, url }) {
    return {
      subject: `Rechazado: ${title}`,
      html: layout({
        title: 'Un firmante rechazó el documento',
        intro: `<p>Hola ${escapeHtml(ownerName)}, <strong>${escapeHtml(recipientName)}</strong> rechazó firmar <strong>${escapeHtml(title)}</strong>.</p><p>Motivo: “${escapeHtml(reason)}”</p>`,
        buttonText: 'Ver el sobre',
        buttonUrl: url,
      }),
      text: `${recipientName} rechazó "${title}". Motivo: ${reason}. Ver: ${url}`,
    };
  },
};

export function createMailer({ pool, resendApiKey, mailFrom, forceOutbox = false }) {
  const useResend = Boolean(resendApiKey) && !forceOutbox;

  async function send({ to, subject, html, text, kind, envelopeId = null, dedupeKey, sensitive = false }) {
    const storedHtml = sensitive && useResend ? '[contenido sensible no almacenado]' : html;
    const storedText = sensitive && useResend ? '[contenido sensible no almacenado]' : text;
    const inserted = await pool.query(
      `INSERT INTO emails (envelope_id, kind, dedupe_key, to_email, subject, html, text_body, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [envelopeId, kind, dedupeKey, to, subject, storedHtml, storedText, useResend ? 'queued' : 'outbox'],
    );
    if (inserted.rowCount === 0) return { duplicate: true };
    const id = inserted.rows[0].id;
    if (!useResend) return { id, status: 'outbox' };

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': dedupeKey,
        },
        body: JSON.stringify({ from: mailFrom, to: [to], subject, html, text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `Resend respondió ${res.status}`);
      await pool.query(`UPDATE emails SET status = 'sent', provider_id = $2 WHERE id = $1`, [id, body.id]);
      return { id, status: 'sent' };
    } catch (err) {
      await pool.query(`UPDATE emails SET status = 'failed', error = $2 WHERE id = $1`, [id, String(err.message).slice(0, 500)]);
      return { id, status: 'failed' };
    }
  }

  return { send, mode: useResend ? 'resend' : 'outbox' };
}
