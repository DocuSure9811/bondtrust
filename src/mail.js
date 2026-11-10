import { escapeHtml } from './validate.js';

export const LANGUAGES = ['es', 'en', 'pt'];
const LOCALES = { es: 'es-AR', en: 'en-US', pt: 'pt-BR' };

export function langOf(value) {
  return LANGUAGES.includes(value) ? value : 'es';
}

export function formatLongDate(d, lang = 'es') {
  return new Date(d).toLocaleDateString(LOCALES[langOf(lang)], { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const T = {
  es: {
    footer: 'Firma electrónica segura con DocSure · docsure.app',
    signTitle: 'Tenés un documento para firmar',
    signSubject: (s, t) => `${s} te pidió firmar: ${t}`,
    remindSubject: (s, t) => `Recordatorio: ${s} espera tu firma en ${t}`,
    remindTitle: 'Recordatorio: tu firma está pendiente',
    signIntro: (r, s, t) => `Hola ${r}, <strong>${s}</strong> te envió <strong>${t}</strong> para firmar.`,
    signButton: 'Revisar y firmar',
    accessCode: (c, url) => `¿Preferís no tocar enlaces? Entrá en <strong>${url}</strong> y escribí el código de acceso <strong style="letter-spacing:2px">${c}</strong>.`,
    signOutro: (d) => `El enlace es personal y vence el ${d}. Antes de firmar te vamos a enviar un código de verificación a este email. No reenvíes este mensaje.`,
    signText: (s, t, url, c, acc, d) => `${s} te pidió firmar "${t}". Firmá acá: ${url} — o entrá en ${acc} con el código ${c}. Vence el ${d}.`,
    otpSubject: (c) => `Tu código de verificación de DocSure: ${c}`,
    otpTitle: 'Código de verificación',
    otpIntro: (r, t) => `Hola ${r}, usá este código para firmar <strong>${t}</strong>:`,
    otpOutro: 'Vence en 10 minutos. Si no fuiste vos, ignorá este email: nadie puede firmar sin este código.',
    otpText: (c, t) => `Tu código de verificación para firmar "${t}" es ${c}. Vence en 10 minutos.`,
    doneSubject: (t) => `Completado: ${t}`,
    doneTitle: 'Documento firmado por todas las partes',
    doneIntro: (r, t) => `Hola ${r}, <strong>${t}</strong> ya tiene todas las firmas. Descargá tu copia con el certificado de finalización y el sello digital.`,
    doneButton: 'Descargar documento',
    doneOutro: 'Podés comprobar en cualquier momento que el documento no fue alterado en docsure.app/verificar.',
    doneText: (t, url) => `"${t}" fue firmado por todas las partes. Descargalo acá: ${url}`,
  },
  en: {
    footer: 'Secure e-signature with DocSure · docsure.app',
    signTitle: 'You have a document to sign',
    signSubject: (s, t) => `${s} asked you to sign: ${t}`,
    remindSubject: (s, t) => `Reminder: ${s} is waiting for your signature on ${t}`,
    remindTitle: 'Reminder: your signature is pending',
    signIntro: (r, s, t) => `Hi ${r}, <strong>${s}</strong> sent you <strong>${t}</strong> to sign.`,
    signButton: 'Review and sign',
    accessCode: (c, url) => `Prefer not to click links? Go to <strong>${url}</strong> and type the access code <strong style="letter-spacing:2px">${c}</strong>.`,
    signOutro: (d) => `This link is personal and expires on ${d}. Before signing we will email you a verification code. Do not forward this message.`,
    signText: (s, t, url, c, acc, d) => `${s} asked you to sign "${t}". Sign here: ${url} — or go to ${acc} and use code ${c}. Expires on ${d}.`,
    otpSubject: (c) => `Your DocSure verification code: ${c}`,
    otpTitle: 'Verification code',
    otpIntro: (r, t) => `Hi ${r}, use this code to sign <strong>${t}</strong>:`,
    otpOutro: 'It expires in 10 minutes. If this wasn’t you, ignore this email: nobody can sign without this code.',
    otpText: (c, t) => `Your verification code to sign "${t}" is ${c}. It expires in 10 minutes.`,
    doneSubject: (t) => `Completed: ${t}`,
    doneTitle: 'Document signed by all parties',
    doneIntro: (r, t) => `Hi ${r}, <strong>${t}</strong> has been signed by everyone. Download your copy with the certificate of completion and the digital seal.`,
    doneButton: 'Download document',
    doneOutro: 'You can verify at any time that the document was not altered at docsure.app/verificar.',
    doneText: (t, url) => `"${t}" was signed by all parties. Download it here: ${url}`,
  },
  pt: {
    footer: 'Assinatura eletrônica segura com DocSure · docsure.app',
    signTitle: 'Você tem um documento para assinar',
    signSubject: (s, t) => `${s} pediu sua assinatura em: ${t}`,
    remindSubject: (s, t) => `Lembrete: ${s} aguarda sua assinatura em ${t}`,
    remindTitle: 'Lembrete: sua assinatura está pendente',
    signIntro: (r, s, t) => `Olá ${r}, <strong>${s}</strong> enviou <strong>${t}</strong> para você assinar.`,
    signButton: 'Revisar e assinar',
    accessCode: (c, url) => `Prefere não clicar em links? Acesse <strong>${url}</strong> e digite o código de acesso <strong style="letter-spacing:2px">${c}</strong>.`,
    signOutro: (d) => `O link é pessoal e vence em ${d}. Antes de assinar enviaremos um código de verificação para este e-mail. Não encaminhe esta mensagem.`,
    signText: (s, t, url, c, acc, d) => `${s} pediu sua assinatura em "${t}". Assine aqui: ${url} — ou acesse ${acc} com o código ${c}. Vence em ${d}.`,
    otpSubject: (c) => `Seu código de verificação DocSure: ${c}`,
    otpTitle: 'Código de verificação',
    otpIntro: (r, t) => `Olá ${r}, use este código para assinar <strong>${t}</strong>:`,
    otpOutro: 'Vence em 10 minutos. Se não foi você, ignore este e-mail: ninguém pode assinar sem este código.',
    otpText: (c, t) => `Seu código de verificação para assinar "${t}" é ${c}. Vence em 10 minutos.`,
    doneSubject: (t) => `Concluído: ${t}`,
    doneTitle: 'Documento assinado por todas as partes',
    doneIntro: (r, t) => `Olá ${r}, <strong>${t}</strong> já tem todas as assinaturas. Baixe sua cópia com o certificado de conclusão e o selo digital.`,
    doneButton: 'Baixar documento',
    doneOutro: 'Você pode verificar a qualquer momento que o documento não foi alterado em docsure.app/verificar.',
    doneText: (t, url) => `"${t}" foi assinado por todas as partes. Baixe aqui: ${url}`,
  },
};

const DEFAULT_BRAND = { name: 'DocSure', color: '#0e7c66', logoUrl: null };

function layout({ title, intro, buttonText, buttonUrl, outro = '', brand = DEFAULT_BRAND, lang = 'es' }) {
  const color = /^#[0-9a-f]{6}$/i.test(brand.color || '') ? brand.color : DEFAULT_BRAND.color;
  const head = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" style="max-height:44px;max-width:200px">`
    : `<span style="font-size:20px;font-weight:700;color:${color}">${escapeHtml(brand.name)}</span>`;
  const button = buttonUrl
    ? `<p style="margin:28px 0"><a href="${escapeHtml(buttonUrl)}" style="background:${color};color:#ffffff;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(buttonText)}</a></p>`
    : '';
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f4f7f6;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#10231e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;border-top:4px solid ${color}">
<tr><td>${head}</td></tr>
<tr><td><h1 style="font-size:22px;margin:24px 0 12px">${escapeHtml(title)}</h1>
<div style="font-size:15px;line-height:1.6">${intro}</div>${button}
<div style="font-size:13px;line-height:1.6;color:#4b5f59">${outro}</div></td></tr>
</table>
<p style="font-size:12px;color:#6b7d78;margin-top:16px">${T[lang].footer}</p>
</td></tr></table></body></html>`;
}

export const templates = {
  signRequest({ lang, brand, senderName, recipientName, title, message, url, accessCode, accessUrl, expiresAt, reminder = false }) {
    const t = T[langOf(lang)];
    const note = message ? `<p style="background:#f4f7f6;border-radius:10px;padding:12px 16px">“${escapeHtml(message)}”</p>` : '';
    return {
      subject: reminder ? t.remindSubject(senderName, title) : t.signSubject(senderName, title),
      html: layout({
        lang, brand,
        title: reminder ? t.remindTitle : t.signTitle,
        intro: `<p>${t.signIntro(escapeHtml(recipientName), escapeHtml(senderName), escapeHtml(title))}</p>${note}`,
        buttonText: t.signButton,
        buttonUrl: url,
        outro: `<p>${t.accessCode(escapeHtml(accessCode), escapeHtml(accessUrl))}</p><p>${t.signOutro(escapeHtml(expiresAt))}</p>`,
      }),
      text: t.signText(senderName, title, url, accessCode, accessUrl, expiresAt),
    };
  },
  otp({ lang, brand, recipientName, code, title }) {
    const t = T[langOf(lang)];
    return {
      subject: t.otpSubject(code),
      html: layout({
        lang, brand,
        title: t.otpTitle,
        intro: `<p>${t.otpIntro(escapeHtml(recipientName), escapeHtml(title))}</p><p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:20px 0">${code}</p>`,
        outro: t.otpOutro,
      }),
      text: t.otpText(code, title),
    };
  },
  completed({ lang, brand, recipientName, title, url }) {
    const t = T[langOf(lang)];
    return {
      subject: t.doneSubject(title),
      html: layout({ lang, brand, title: t.doneTitle, intro: `<p>${t.doneIntro(escapeHtml(recipientName), escapeHtml(title))}</p>`, buttonText: t.doneButton, buttonUrl: url, outro: t.doneOutro }),
      text: t.doneText(title, url),
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
  teamInvite({ inviterName, teamName, role, url }) {
    const roleText = role === 'admin' ? 'administrador' : 'miembro';
    return {
      subject: `${inviterName} te invitó al equipo ${teamName} en DocSure`,
      html: layout({
        title: `Te invitaron a ${teamName}`,
        intro: `<p><strong>${escapeHtml(inviterName)}</strong> te invitó a sumarte al equipo <strong>${escapeHtml(teamName)}</strong> en DocSure como ${roleText}.</p><p>Vas a poder usar las plantillas del equipo y seguir enviando tus documentos como siempre.</p>`,
        buttonText: 'Unirme al equipo',
        buttonUrl: url,
        outro: 'La invitación vence en 7 días. Si no esperabas este email, ignoralo.',
      }),
      text: `${inviterName} te invitó al equipo ${teamName} en DocSure como ${roleText}. Unite acá: ${url} (vence en 7 días).`,
    };
  },
  expired({ ownerName, title, url }) {
    return {
      subject: `Vencido: ${title}`,
      html: layout({
        title: 'Un sobre venció sin todas las firmas',
        intro: `<p>Hola ${escapeHtml(ownerName)}, <strong>${escapeHtml(title)}</strong> llegó a su fecha de vencimiento sin todas las firmas.</p><p>Podés corregirlo y volver a enviarlo en un clic: los sobres corregidos no consumen tu cupo.</p>`,
        buttonText: 'Ver el sobre',
        buttonUrl: url,
      }),
      text: `"${title}" venció sin todas las firmas. Ver: ${url}`,
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
