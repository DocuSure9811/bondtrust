import { escapeHtml } from '../validate.js';
import { LOGO_SVG, page } from './layout.js';
import { PLANS_VIEW } from './marketing.js';

export function authPage(config, mode, { next = '/app', plan = 'gratis' } = {}) {
  const isSignup = mode === 'registro';
  const planOptions = PLANS_VIEW.map((p) => `<option value="${p.key}"${p.key === plan ? ' selected' : ''}>${p.name}${p.annual ? ` · US$${p.annual}` : ' · US$0'}</option>`).join('');
  const body = `<section class="auth"><div class="auth-card">
  <a class="logo" href="/" aria-label="DocSure, inicio">${LOGO_SVG}<span>DocSure</span></a>
  <h1>${isSignup ? 'Creá tu cuenta gratis' : 'Ingresá a DocSure'}</h1>
  <p class="muted">${isSignup ? 'Empezá a enviar documentos para firmar en un minuto.' : 'Accedé a tus documentos y firmas.'}</p>
  <form id="auth-form" data-mode="${mode}" data-next="${escapeHtml(next)}" novalidate>
    ${isSignup ? `<label>Nombre y apellido<input name="name" autocomplete="name" required maxlength="120"></label>
    <label>Empresa <span class="muted">(opcional)</span><input name="company" autocomplete="organization" maxlength="120"></label>` : ''}
    <label>Email<input name="email" type="email" autocomplete="email" required maxlength="254"></label>
    <label>Contraseña<input name="password" type="password" autocomplete="${isSignup ? 'new-password' : 'current-password'}" required minlength="${isSignup ? 10 : 1}" maxlength="200"></label>
    ${isSignup ? `<label>Plan<select name="plan">${planOptions}</select></label>
    <p class="fine">Al crear la cuenta aceptás los <a href="/legal/terminos">Términos</a> y la <a href="/legal/privacidad">Política de privacidad</a>.</p>` : ''}
    <p class="form-error" role="alert"></p>
    <button class="btn btn-primary btn-block btn-lg" type="submit">${isSignup ? 'Crear cuenta' : 'Ingresar'}</button>
  </form>
  <p class="auth-switch">${isSignup ? '¿Ya tenés cuenta? <a href="/ingresar">Ingresá</a>' : '¿No tenés cuenta? <a href="/registro">Creala gratis</a>'}</p>
</div></section>`;
  return page({
    config,
    path: `/${mode}`,
    title: isSignup ? 'Crear cuenta gratis' : 'Ingresar',
    description: isSignup ? 'Creá tu cuenta gratis de DocSure y enviá tus primeros documentos para firmar.' : 'Ingresá a tu cuenta de DocSure.',
    body,
    noindex: !isSignup,
    chrome: false,
    bodyClass: 'auth-body',
    scripts: ['/static/auth.js'],
  });
}

function appShell(config, user, { title, body, scripts, active = 'docs' }) {
  const shell = `<div class="app">
  <header class="app-header"><div class="wrap-app app-header-row">
    <a class="logo" href="/app" aria-label="DocSure, mis documentos">${LOGO_SVG}<span>DocSure</span></a>
    <nav class="app-nav" aria-label="Aplicación"><a href="/app"${active === 'docs' ? ' aria-current="page"' : ''}>Documentos</a><a href="/app/nuevo"${active === 'new' ? ' aria-current="page"' : ''}>Nuevo sobre</a></nav>
    <div class="app-user"><span class="app-user-name">${escapeHtml(user.name)}</span><button class="btn btn-ghost btn-sm" type="button" id="logout">Salir</button></div>
  </div></header>
  ${body}
</div>`;
  return page({ config, path: '/app', title, description: 'Panel de DocSure.', body: shell, noindex: true, chrome: false, bodyClass: 'app-body', scripts });
}

export function dashboardPage(config, user) {
  return appShell(config, user, {
    title: 'Mis documentos',
    body: `<div class="wrap-app app-main">
  <div class="app-title-row"><h1>Mis documentos</h1><a class="btn btn-primary" href="/app/nuevo">+ Nuevo sobre</a></div>
  <section class="stats" id="stats" aria-label="Resumen"></section>
  <div class="tabs" role="tablist" id="filters">
    <button role="tab" aria-selected="true" data-filter="all">Todos</button><button role="tab" aria-selected="false" data-filter="sent">En curso</button>
    <button role="tab" aria-selected="false" data-filter="completed">Completados</button><button role="tab" aria-selected="false" data-filter="draft">Borradores</button>
    <button role="tab" aria-selected="false" data-filter="closed">Rechazados o anulados</button>
  </div>
  <div id="list" class="env-list" aria-live="polite"><p class="muted">Cargando…</p></div>
</div>`,
    scripts: ['/static/dashboard.js'],
  });
}

export function editorPage(config, user) {
  return appShell(config, user, {
    title: 'Nuevo sobre',
    active: 'new',
    body: `<div class="wrap-app app-main">
  <ol class="wizard" id="wizard"><li class="active">Documento</li><li>Destinatarios</li><li>Campos</li><li>Enviar</li></ol>

  <section class="step" data-step="1">
    <h1>Subí el documento</h1>
    <label>Nombre del documento<input id="title" maxlength="160" placeholder="Ej.: Contrato de servicios"></label>
    <div class="dropzone" id="drop"><input id="file" type="file" accept="application/pdf" class="visually-hidden">
      <label for="file" class="dropzone-label"><span class="ic ic-upload" aria-hidden="true"></span><strong>Elegí o arrastrá un PDF</strong><span>Hasta 15 MB</span></label></div>
    <p class="form-error" role="alert" id="err1"></p>
  </section>

  <section class="step" data-step="2" hidden>
    <h1>¿Quiénes reciben el documento?</h1>
    <label class="switch"><input type="checkbox" id="sequential"> Firmar en orden (cada uno recibe el enlace cuando firma el anterior)</label>
    <div id="recipients" class="recipients"></div>
    <button class="btn btn-outline" type="button" id="add-recipient">+ Agregar destinatario</button>
    <label>Mensaje para los firmantes <span class="muted">(opcional)</span><textarea id="message" maxlength="1000" rows="3"></textarea></label>
    <p class="form-error" role="alert" id="err2"></p>
    <div class="step-actions"><button class="btn btn-ghost" type="button" data-go="1">Atrás</button><button class="btn btn-primary" type="button" id="to-fields">Siguiente: ubicar campos</button></div>
  </section>

  <section class="step step-wide" data-step="3" hidden>
    <div class="editor">
      <aside class="palette" aria-label="Campos">
        <label>Campos de<select id="field-owner"></select></label>
        <p class="muted small">Elegí un tipo y hacé clic en el documento para ubicarlo. Arrastralo para moverlo.</p>
        <div class="palette-grid" id="palette">
          <button type="button" data-type="signature" class="active">Firma</button><button type="button" data-type="initials">Iniciales</button>
          <button type="button" data-type="date">Fecha de firma</button><button type="button" data-type="name">Nombre</button>
          <button type="button" data-type="email">Email</button><button type="button" data-type="text">Texto</button>
          <button type="button" data-type="checkbox">Casilla</button>
        </div>
        <div id="selected-props" class="props" hidden>
          <p class="props-title">Campo seleccionado</p>
          <label class="switch"><input type="checkbox" id="prop-required"> Obligatorio</label>
          <label>Etiqueta<input id="prop-label" maxlength="60"></label>
          <button class="btn btn-danger btn-sm" type="button" id="prop-delete">Eliminar campo</button>
        </div>
        <p class="form-error" role="alert" id="err3"></p>
        <div class="step-actions col"><button class="btn btn-primary btn-block" type="button" id="to-review">Siguiente: revisar</button><button class="btn btn-ghost btn-block" type="button" data-go="2">Atrás</button></div>
      </aside>
      <div class="pages" id="pages" aria-label="Documento"></div>
    </div>
  </section>

  <section class="step" data-step="4" hidden>
    <h1>Revisá y enviá</h1>
    <div id="review" class="review"></div>
    <p class="form-error" role="alert" id="err4"></p>
    <div class="step-actions"><button class="btn btn-ghost" type="button" data-go="3">Atrás</button><button class="btn btn-primary btn-lg" type="button" id="send">Enviar para firmar</button></div>
  </section>
</div>`,
    scripts: ['/static/editor.js'],
  });
}

export function envelopePage(config, user) {
  return appShell(config, user, {
    title: 'Detalle del sobre',
    body: `<div class="wrap-app app-main" id="detail" aria-live="polite"><p class="muted">Cargando…</p></div>`,
    scripts: ['/static/envelope.js'],
  });
}

export function signPage(config) {
  const body = `<div class="sign-app">
  <header class="sign-header"><div class="wrap-app sign-header-row">
    <span class="logo">${LOGO_SVG}<span>DocSure</span></span>
    <div class="sign-doc-info" id="doc-info"></div>
  </div></header>
  <div class="wrap-app sign-main" id="sign-root" aria-live="polite"><p class="muted">Cargando…</p></div>
</div>`;
  return page({ config, path: '/firmar', title: 'Firmar documento', description: 'Firma segura con DocSure.', body, noindex: true, chrome: false, bodyClass: 'sign-body', scripts: ['/static/sign.js'] });
}

export function documentPage(config, { token, title, completedAt, sha }) {
  const body = `<section class="auth"><div class="auth-card auth-card-wide">
  <a class="logo" href="/" aria-label="DocSure, inicio">${LOGO_SVG}<span>DocSure</span></a>
  <p class="status-pill status-completed">Completado</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="muted">Firmado por todas las partes el ${escapeHtml(new Date(completedAt).toLocaleString('es-AR', { timeZone: 'UTC' }))} UTC.</p>
  <a class="btn btn-primary btn-lg btn-block" href="/documento/${escapeHtml(token)}/pdf">Descargar PDF firmado</a>
  <p class="fine">Huella SHA-256: <code class="hash">${escapeHtml(sha)}</code></p>
  <p class="fine">Podés comprobar el sello en <a href="/verificar">docsure.app/verificar</a>.</p>
</div></section>`;
  return page({ config, path: '/documento', title: 'Documento firmado', description: 'Descargá tu documento firmado.', body, noindex: true, chrome: false, bodyClass: 'auth-body' });
}

export function errorPage(config, user, status, message) {
  const title = status === 404 ? 'Página no encontrada' : status === 410 ? 'Enlace no disponible' : 'Algo salió mal';
  const body = `<section class="page-hero"><div class="wrap narrow center">
  <p class="eyebrow">Error ${status}</p><h1>${title}</h1><p class="lead">${escapeHtml(message)}</p>
  <a class="btn btn-primary" href="/">Ir al inicio</a></div></section>`;
  return page({ config, user, path: '/error', title, description: message, body, noindex: true });
}

export function adminEmailsPage(config, rows) {
  const body = `<section class="section section-tight"><div class="wrap">
  <h1>Bandeja de salida de emails</h1>
  <p class="muted">Se muestran los últimos 100 emails. Sin RESEND_API_KEY los emails quedan acá en lugar de enviarse.</p>
  <div class="table-wrap"><table class="compare admin-table"><thead><tr><th>Fecha (UTC)</th><th>Para</th><th>Tipo</th><th>Estado</th><th>Asunto</th><th></th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${escapeHtml(new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' '))}</td><td>${escapeHtml(r.to_email)}</td><td>${escapeHtml(r.kind)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.subject)}</td><td><a href="/admin/correos/${r.id}">Ver</a></td></tr>`).join('')}
  </tbody></table></div></div></section>`;
  return page({ config, path: '/admin', title: 'Admin · Emails', description: 'Admin', body, noindex: true });
}
