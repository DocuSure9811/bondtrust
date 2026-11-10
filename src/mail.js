import { escapeHtml } from './validate.js';

export const LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it'];
const LOCALES = { es: 'es-AR', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', it: 'it-IT' };

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
  fr: {
    footer: 'Signature électronique sécurisée avec DocSure · docsure.app',
    signTitle: 'Vous avez un document à signer',
    signSubject: (s, t) => `${s} vous demande de signer : ${t}`,
    remindSubject: (s, t) => `Rappel : ${s} attend votre signature sur ${t}`,
    remindTitle: 'Rappel : votre signature est en attente',
    signIntro: (r, s, t) => `Bonjour ${r}, <strong>${s}</strong> vous a envoyé <strong>${t}</strong> à signer.`,
    signButton: 'Relire et signer',
    accessCode: (c, url) => `Vous préférez ne pas cliquer sur les liens ? Allez sur <strong>${url}</strong> et saisissez le code d’accès <strong style="letter-spacing:2px">${c}</strong>.`,
    signOutro: (d) => `Ce lien est personnel et expire le ${d}. Avant de signer, nous vous enverrons un code de vérification par e-mail. Ne transférez pas ce message.`,
    signText: (s, t, url, c, acc, d) => `${s} vous demande de signer « ${t} ». Signez ici : ${url} — ou allez sur ${acc} avec le code ${c}. Expire le ${d}.`,
    otpSubject: (c) => `Votre code de vérification DocSure : ${c}`,
    otpTitle: 'Code de vérification',
    otpIntro: (r, t) => `Bonjour ${r}, utilisez ce code pour signer <strong>${t}</strong> :`,
    otpOutro: 'Il expire dans 10 minutes. Si ce n’était pas vous, ignorez cet e-mail : personne ne peut signer sans ce code.',
    otpText: (c, t) => `Votre code de vérification pour signer « ${t} » est ${c}. Il expire dans 10 minutes.`,
    doneSubject: (t) => `Terminé : ${t}`,
    doneTitle: 'Document signé par toutes les parties',
    doneIntro: (r, t) => `Bonjour ${r}, <strong>${t}</strong> a été signé par tous. Téléchargez votre copie avec le certificat de finalisation et le cachet numérique.`,
    doneButton: 'Télécharger le document',
    doneOutro: 'Vous pouvez vérifier à tout moment que le document n’a pas été modifié sur docsure.app/verificar.',
    doneText: (t, url) => `« ${t} » a été signé par toutes les parties. Téléchargez-le ici : ${url}`,
  },
  de: {
    footer: 'Sichere elektronische Unterschrift mit DocSure · docsure.app',
    signTitle: 'Sie haben ein Dokument zu unterschreiben',
    signSubject: (s, t) => `${s} bittet Sie um Ihre Unterschrift: ${t}`,
    remindSubject: (s, t) => `Erinnerung: ${s} wartet auf Ihre Unterschrift für ${t}`,
    remindTitle: 'Erinnerung: Ihre Unterschrift steht noch aus',
    signIntro: (r, s, t) => `Hallo ${r}, <strong>${s}</strong> hat Ihnen <strong>${t}</strong> zur Unterschrift gesendet.`,
    signButton: 'Prüfen und unterschreiben',
    accessCode: (c, url) => `Sie möchten keine Links anklicken? Öffnen Sie <strong>${url}</strong> und geben Sie den Zugangscode <strong style="letter-spacing:2px">${c}</strong> ein.`,
    signOutro: (d) => `Dieser Link ist persönlich und läuft am ${d} ab. Vor der Unterschrift senden wir Ihnen einen Bestätigungscode per E-Mail. Leiten Sie diese Nachricht nicht weiter.`,
    signText: (s, t, url, c, acc, d) => `${s} bittet Sie, „${t}" zu unterschreiben. Hier unterschreiben: ${url} — oder öffnen Sie ${acc} mit dem Code ${c}. Läuft am ${d} ab.`,
    otpSubject: (c) => `Ihr DocSure-Bestätigungscode: ${c}`,
    otpTitle: 'Bestätigungscode',
    otpIntro: (r, t) => `Hallo ${r}, verwenden Sie diesen Code, um <strong>${t}</strong> zu unterschreiben:`,
    otpOutro: 'Er läuft in 10 Minuten ab. Wenn Sie das nicht waren, ignorieren Sie diese E-Mail: Ohne diesen Code kann niemand unterschreiben.',
    otpText: (c, t) => `Ihr Bestätigungscode zum Unterschreiben von „${t}" lautet ${c}. Er läuft in 10 Minuten ab.`,
    doneSubject: (t) => `Abgeschlossen: ${t}`,
    doneTitle: 'Dokument von allen Parteien unterschrieben',
    doneIntro: (r, t) => `Hallo ${r}, <strong>${t}</strong> wurde von allen unterschrieben. Laden Sie Ihre Kopie mit Abschlusszertifikat und digitalem Siegel herunter.`,
    doneButton: 'Dokument herunterladen',
    doneOutro: 'Unter docsure.app/verificar können Sie jederzeit prüfen, dass das Dokument nicht verändert wurde.',
    doneText: (t, url) => `„${t}" wurde von allen Parteien unterschrieben. Hier herunterladen: ${url}`,
  },
  it: {
    footer: 'Firma elettronica sicura con DocSure · docsure.app',
    signTitle: 'Hai un documento da firmare',
    signSubject: (s, t) => `${s} ti chiede di firmare: ${t}`,
    remindSubject: (s, t) => `Promemoria: ${s} attende la tua firma su ${t}`,
    remindTitle: 'Promemoria: la tua firma è in sospeso',
    signIntro: (r, s, t) => `Ciao ${r}, <strong>${s}</strong> ti ha inviato <strong>${t}</strong> da firmare.`,
    signButton: 'Rivedi e firma',
    accessCode: (c, url) => `Preferisci non cliccare sui link? Vai su <strong>${url}</strong> e inserisci il codice di accesso <strong style="letter-spacing:2px">${c}</strong>.`,
    signOutro: (d) => `Questo link è personale e scade il ${d}. Prima della firma ti invieremo un codice di verifica via email. Non inoltrare questo messaggio.`,
    signText: (s, t, url, c, acc, d) => `${s} ti chiede di firmare "${t}". Firma qui: ${url} — oppure vai su ${acc} con il codice ${c}. Scade il ${d}.`,
    otpSubject: (c) => `Il tuo codice di verifica DocSure: ${c}`,
    otpTitle: 'Codice di verifica',
    otpIntro: (r, t) => `Ciao ${r}, usa questo codice per firmare <strong>${t}</strong>:`,
    otpOutro: 'Scade tra 10 minuti. Se non sei stato tu, ignora questa email: nessuno può firmare senza questo codice.',
    otpText: (c, t) => `Il tuo codice di verifica per firmare "${t}" è ${c}. Scade tra 10 minuti.`,
    doneSubject: (t) => `Completato: ${t}`,
    doneTitle: 'Documento firmato da tutte le parti',
    doneIntro: (r, t) => `Ciao ${r}, <strong>${t}</strong> è stato firmato da tutti. Scarica la tua copia con il certificato di completamento e il sigillo digitale.`,
    doneButton: 'Scarica il documento',
    doneOutro: 'Puoi verificare in qualsiasi momento che il documento non sia stato modificato su docsure.app/verificar.',
    doneText: (t, url) => `"${t}" è stato firmato da tutte le parti. Scaricalo qui: ${url}`,
  },
};

const DEFAULT_BRAND = { name: 'DocSure', color: '#1f4e9c', logoUrl: null };

function layout({ title, intro, buttonText, buttonUrl, outro = '', brand = DEFAULT_BRAND, lang = 'es' }) {
  const color = /^#[0-9a-f]{6}$/i.test(brand.color || '') ? brand.color : DEFAULT_BRAND.color;
  const head = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" style="max-height:44px;max-width:200px">`
    : `<span style="font-size:20px;font-weight:700;color:${color}">${escapeHtml(brand.name)}</span>`;
  const button = buttonUrl
    ? `<p style="margin:28px 0"><a href="${escapeHtml(buttonUrl)}" style="background:${color};color:#ffffff;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(buttonText)}</a></p>`
    : '';
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f3f5f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#16202c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;border-top:4px solid ${color}">
<tr><td>${head}</td></tr>
<tr><td><h1 style="font-size:22px;margin:24px 0 12px">${escapeHtml(title)}</h1>
<div style="font-size:15px;line-height:1.6">${intro}</div>${button}
<div style="font-size:13px;line-height:1.6;color:#56606e">${outro}</div></td></tr>
</table>
<p style="font-size:12px;color:#717b88;margin-top:16px">${T[lang].footer}</p>
</td></tr></table></body></html>`;
}

export const templates = {
  signRequest({ lang, brand, senderName, recipientName, title, message, url, accessCode, accessUrl, expiresAt, reminder = false }) {
    const t = T[langOf(lang)];
    const note = message ? `<p style="background:#f3f5f8;border-radius:10px;padding:12px 16px">“${escapeHtml(message)}”</p>` : '';
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
  renewal({ ownerName, title, endDate, daysLeft, url }) {
    const when = daysLeft > 1 ? `vence en ${daysLeft} días` : daysLeft === 1 ? 'vence mañana' : daysLeft === 0 ? 'vence hoy' : 'ya venció';
    return {
      subject: `Contrato por vencer: ${title}`,
      html: layout({
        title: 'Un contrato está por vencer',
        intro: `<p>Hola ${escapeHtml(ownerName)}, el contrato <strong>${escapeHtml(title)}</strong> ${when} (${escapeHtml(endDate)}).</p><p>Si querés renovarlo, abrí el sobre y tocá <strong>Nueva versión</strong>: se arma un borrador con los mismos documentos, firmantes y campos.</p>`,
        buttonText: 'Ver el contrato',
        buttonUrl: url,
      }),
      text: `El contrato "${title}" ${when} (${endDate}). Para renovarlo, abrí el sobre y tocá "Nueva versión". Ver: ${url}`,
    };
  },
  sharedCopy({ senderName, title, url, days }) {
    return {
      subject: `Copia firmada: ${title}`,
      html: layout({
        title: 'Te enviaron un documento firmado',
        intro: `<p>${escapeHtml(senderName)} te envía una copia de <strong>${escapeHtml(title)}</strong>, firmado por todas las partes y sellado digitalmente.</p><p>El enlace funciona durante ${days} días.</p>`,
        buttonText: 'Descargar el PDF firmado',
        buttonUrl: url,
      }),
      text: `${senderName} te envía una copia firmada de "${title}". Descargala (el enlace vence en ${days} días): ${url}`,
    };
  },
  automationNotice({ trigger, title, ruleName, url }) {
    const what = { completed: 'se completó', declined: 'fue rechazado', expired: 'venció sin todas las firmas' }[trigger];
    return {
      subject: `Aviso: ${title} ${what}`,
      html: layout({
        title: `Un sobre ${what}`,
        intro: `<p>El sobre <strong>${escapeHtml(title)}</strong> ${what}.</p><p class="muted">Recibís este aviso por la automatización “${escapeHtml(ruleName)}”.</p>`,
        buttonText: 'Ver el sobre',
        buttonUrl: url,
      }),
      text: `El sobre "${title}" ${what}. Automatización: ${ruleName}. Ver: ${url}`,
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
