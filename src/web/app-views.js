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
  <p class="auth-switch">${(() => {
    const q = next !== '/app' ? `?next=${encodeURIComponent(next)}` : '';
    return isSignup ? `¿Ya tenés cuenta? <a href="/ingresar${q}">Ingresá</a>` : `¿No tenés cuenta? <a href="/registro${q}">Creala gratis</a>`;
  })()}</p>
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
    <nav class="app-nav" aria-label="Aplicación"><a href="/app"${active === 'docs' ? ' aria-current="page"' : ''}>Documentos</a><a href="/app/nuevo"${active === 'new' ? ' aria-current="page"' : ''}>Nuevo sobre</a><a href="/app/plantillas"${active === 'tpl' ? ' aria-current="page"' : ''}>Plantillas</a><a href="/app/contactos"${active === 'contacts' ? ' aria-current="page"' : ''}>Contactos</a><a href="/app/equipo"${active === 'team' ? ' aria-current="page"' : ''}>Equipo</a><a href="/app/api"${active === 'api' ? ' aria-current="page"' : ''}>API</a><a href="/app/ajustes"${active === 'settings' ? ' aria-current="page"' : ''}>Ajustes</a></nav>
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
    <button role="tab" aria-selected="false" data-filter="closed">Rechazados, anulados o vencidos</button>
  </div>
  <div class="toolbar">
    <label class="visually-hidden" for="q">Buscar sobres</label><input id="q" type="search" placeholder="Buscar por documento, nombre o email" autocomplete="off">
    <label class="visually-hidden" for="folder">Carpeta</label><select id="folder"><option value="">Todas las carpetas</option></select>
    <label class="date-filter">Desde<input type="date" id="from"></label>
    <label class="date-filter">Hasta<input type="date" id="to"></label>
    <button class="btn btn-ghost btn-sm" type="button" id="folders-btn">Carpetas</button>
    <button class="btn btn-ghost btn-sm" type="button" id="export">Exportar CSV</button>
  </div>
  <div class="bulk-bar" id="bulk" hidden>
    <span id="bulk-count"></span>
    <label class="visually-hidden" for="bulk-folder">Mover a</label><select id="bulk-folder"></select>
    <button class="btn btn-primary btn-sm" type="button" id="bulk-move">Mover</button>
    <button class="btn btn-ghost btn-sm" type="button" id="bulk-clear">Cancelar</button>
  </div>
  <p class="muted small" id="count" aria-live="polite"></p>
  <div id="list" class="env-list" aria-live="polite"><p class="muted">Cargando…</p></div>
  <dialog id="folders-dialog" aria-labelledby="folders-title"><div class="modal">
    <h2 id="folders-title">Carpetas</h2>
    <form id="folder-form" class="inline-form" novalidate><label class="visually-hidden" for="folder-name">Nombre de la carpeta</label><input id="folder-name" maxlength="60" placeholder="Nueva carpeta" required><button class="btn btn-primary" type="submit">Crear</button></form>
    <p class="form-error" role="alert" id="folder-msg"></p>
    <ul class="rlist" id="folder-list"></ul>
    <div class="modal-actions"><button class="btn btn-ghost" type="button" id="folders-close">Cerrar</button></div>
  </div></dialog>
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
    <h1>Subí los documentos</h1>
    <label>Nombre del sobre<input id="title" maxlength="160" placeholder="Ej.: Contrato de servicios"></label>
    <ul class="rlist doc-list" id="docs" hidden></ul>
    <div class="dropzone" id="drop"><input id="file" type="file" accept="application/pdf,image/png,image/jpeg" multiple class="visually-hidden">
      <label for="file" class="dropzone-label"><span class="ic ic-upload" aria-hidden="true"></span><strong id="drop-text">Elegí o arrastrá PDF o fotos</strong><span>PDF, JPG o PNG de hasta 15 MB · 10 documentos por sobre</span></label></div>
    <p class="form-error" role="alert" id="err1"></p>
    <div class="step-actions" id="step1-actions" hidden><span></span><button class="btn btn-primary" type="button" data-go="2">Siguiente: destinatarios</button></div>
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
        <button class="btn btn-outline btn-sm btn-block" type="button" id="detect">Detectar campos del PDF</button>
        <p class="muted small" id="detect-msg" aria-live="polite"></p>
        <div class="palette-grid" id="palette">
          <button type="button" data-type="signature" class="active">Firma</button><button type="button" data-type="initials">Iniciales</button>
          <button type="button" data-type="date">Fecha de firma</button><button type="button" data-type="name">Nombre</button>
          <button type="button" data-type="email">Email</button><button type="button" data-type="text">Texto</button>
          <button type="button" data-type="checkbox">Casilla</button><button type="button" data-type="select">Lista</button><button type="button" data-type="radio">Opción única</button><button type="button" data-type="multiple">Selección múltiple</button><button type="button" data-type="number">Número</button><button type="button" data-type="phone">Teléfono</button><button type="button" data-type="attachment">Adjunto</button><button type="button" data-type="image">Imagen</button><button type="button" data-type="stamp">Sello</button>
        </div>
        <div id="selected-props" class="props" hidden>
          <p class="props-title" id="prop-title">Campo seleccionado</p>
          <label class="switch"><input type="checkbox" id="prop-required"> Obligatorio</label>
          <label>Etiqueta<input id="prop-label" maxlength="60"></label>
          <label id="prop-format-wrap" hidden>Formato<select id="prop-format"><option value="">Texto libre</option><option value="email">Email</option><option value="number">Número</option><option value="id">Documento de identidad</option><option value="phone">Teléfono</option></select></label>
          <label id="prop-formula-wrap" hidden>Fórmula <span class="muted">(opcional)</span><input id="prop-formula" maxlength="300" placeholder="{Precio} * {Cantidad}"><span class="muted small">Usá las etiquetas de otros campos Número entre llaves. Se calcula sola.</span></label>
          <label id="prop-options-wrap" hidden>Opciones <span class="muted">(una por línea)</span><textarea id="prop-options" rows="4" maxlength="2500"></textarea></label>
          <div id="prop-cond-wrap" hidden>
            <label>Mostrar este campo<select id="prop-cond-field"></select></label>
            <div id="prop-cond-value"></div>
          </div>
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
    <div class="options-grid">
      <label>Idioma para los firmantes<select id="opt-language"><option value="es">Español</option><option value="en">English</option><option value="pt">Português</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="it">Italiano</option></select></label>
      <label>Vence en<select id="opt-expire"><option value="7">7 días</option><option value="15">15 días</option><option value="30" selected>30 días</option><option value="60">60 días</option><option value="90">90 días</option><option value="120">120 días</option></select></label>
      <label>Recordatorios<select id="opt-reminder"><option value="0">Sin recordatorios</option><option value="1">Cada día</option><option value="2" selected>Cada 2 días</option><option value="3">Cada 3 días</option><option value="5">Cada 5 días</option><option value="7">Cada 7 días</option></select></label>
    </div>
    <label class="switch"><input type="checkbox" id="opt-template"> Guardar también como plantilla</label>
    <label id="opt-template-name-wrap" hidden>Nombre de la plantilla<input id="opt-template-name" maxlength="120"></label>
    <p class="form-error" role="alert" id="err4"></p>
    <div class="step-actions"><button class="btn btn-ghost" type="button" data-go="3">Atrás</button><button class="btn btn-primary btn-lg" type="button" id="send">Enviar para firmar</button></div>
  </section>
</div>`,
    scripts: ['/static/editor.js'],
  });
}

export function apiPage(config, user) {
  const base = config.appUrl;
  return appShell(config, user, {
    title: 'API y desarrolladores',
    active: 'api',
    body: `<div class="wrap-app app-main">
  <div class="app-title-row"><h1>API y desarrolladores</h1><a class="btn btn-ghost" href="/desarrolladores">Ver documentación</a></div>
  <section class="card api-hint">
    <h2>Integrá DocSure con tu asistente de IA</h2>
    <p>Pegale esto a Claude, Cursor o tu IDE y hace la integración completa por vos:</p>
    <pre class="code" id="ai-prompt">Integrá DocSure en este proyecto para enviar documentos a firmar. Seguí las instrucciones de ${config.appUrl}/llms.txt (API base: ${base}/api/v1). Conectate con el flujo de agente para obtener la clave sin que yo la copie.</pre>
    <button class="btn btn-outline btn-sm" type="button" data-copy="ai-prompt">Copiar instrucción</button>
  </section>
  <section class="card">
    <div class="card-head"><h2>Claves de API</h2></div>
    <p class="muted small">Usalas en el encabezado <code>Authorization: Bearer ds_live_…</code>. La clave se muestra una sola vez.</p>
    <form id="key-form" class="inline-form"><label class="visually-hidden" for="key-name">Nombre de la clave</label><input id="key-name" maxlength="80" placeholder="Ej.: Integración CRM" required><button class="btn btn-primary" type="submit">Crear clave</button></form>
    <div id="new-key" class="new-secret" hidden></div>
    <p class="form-error" role="alert" id="key-err"></p>
    <ul class="rlist" id="keys"></ul>
  </section>
  <section class="card">
    <div class="card-head"><h2>Firma embebida</h2></div>
    <p class="muted small">Mostrá la firma dentro de tu sitio o app con <code>&lt;docsure-signing&gt;</code>. Indicá los dominios que pueden mostrarla (uno por línea, ej. <code>https://app.tuempresa.com</code>).</p>
    <form id="embed-form" novalidate><label class="visually-hidden" for="embed-origins">Dominios autorizados</label><textarea id="embed-origins" rows="3" maxlength="1000" placeholder="https://app.tuempresa.com"></textarea>
    <p class="form-error" role="alert" id="embed-msg"></p><button class="btn btn-primary btn-sm" type="submit">Guardar dominios</button></form>
  </section>
  <section class="card">
    <div class="card-head"><h2>Webhooks</h2></div>
    <p class="muted small">Te avisamos por HTTPS cuando algo cambia. Cada aviso va firmado con HMAC-SHA256 en <code>DocSure-Signature</code>.</p>
    <form id="hook-form" class="inline-form"><label class="visually-hidden" for="hook-url">URL del webhook</label><input id="hook-url" type="url" maxlength="500" placeholder="https://tu-app.com/webhooks/docsure" required><button class="btn btn-primary" type="submit">Agregar webhook</button></form>
    <div id="new-hook" class="new-secret" hidden></div>
    <p class="form-error" role="alert" id="hook-err"></p>
    <ul class="rlist" id="hooks"></ul>
  </section>
</div>`,
    scripts: ['/static/api-panel.js'],
  });
}

export function templatesPage(config, user) {
  return appShell(config, user, {
    title: 'Plantillas',
    active: 'tpl',
    body: `<div class="wrap-app app-main">
  <div class="app-title-row"><h1>Plantillas</h1></div>
  <p class="muted">Para crear una plantilla, abrí cualquier sobre y tocá <strong>Guardar como plantilla</strong>, o marcá la opción al enviarlo.</p>
  <p class="form-error" role="alert" id="tpl-msg"></p>
  <div id="tpl-list" class="env-list" aria-live="polite"><p class="muted">Cargando…</p></div>
</div>`,
    scripts: ['/static/templates.js'],
  });
}

export function contactsPage(config, user) {
  return appShell(config, user, {
    title: 'Contactos',
    active: 'contacts',
    body: `<div class="wrap-app app-main">
  <div class="app-title-row"><h1>Contactos</h1><span class="muted small" id="ct-count"></span></div>
  <p class="muted">Cada persona a la que le enviás un sobre se guarda acá sola. Al escribir un destinatario nuevo te la sugerimos.</p>
  <section class="card">
    <h2>Agregar contacto</h2>
    <form id="ct-form" class="inline-form" novalidate>
      <label class="visually-hidden" for="ct-name">Nombre</label><input id="ct-name" maxlength="120" placeholder="Nombre y apellido" autocomplete="off" required>
      <label class="visually-hidden" for="ct-email">Email</label><input id="ct-email" type="email" maxlength="254" placeholder="email@empresa.com" autocomplete="off" required>
      <button class="btn btn-primary" type="submit">Agregar</button>
    </form>
    <p class="form-error" role="alert" id="ct-msg"></p>
  </section>
  <section class="card">
    <label class="visually-hidden" for="ct-search">Buscar contacto</label>
    <input id="ct-search" type="search" placeholder="Buscar por nombre o email" autocomplete="off">
    <ul class="rlist" id="ct-list" aria-live="polite"><li class="muted">Cargando…</li></ul>
  </section>
</div>`,
    scripts: ['/static/contacts.js'],
  });
}

export function teamPage(config, user) {
  return appShell(config, user, {
    title: 'Equipo',
    active: 'team',
    body: `<div class="wrap-app app-main" id="team-root" aria-live="polite"><p class="muted">Cargando…</p></div>`,
    scripts: ['/static/team.js'],
  });
}

export function joinPage(config, user) {
  return appShell(config, user, {
    title: 'Unirme a un equipo',
    active: 'team',
    body: `<div class="wrap-app app-main"><div class="sign-card" id="join"><p class="muted">Cargando…</p></div></div>`,
    scripts: ['/static/join.js'],
  });
}

export function settingsPage(config, user) {
  return appShell(config, user, {
    title: 'Ajustes',
    active: 'settings',
    body: `<div class="wrap-app app-main">
  <div class="app-title-row"><h1>Ajustes</h1></div>
  <section class="card"><h2>Tu cuenta</h2>
    <form id="account-form" novalidate>
      <label>Nombre<input name="name" maxlength="120" required></label>
      <label>Empresa <span class="muted">(se muestra como remitente en tus emails)</span><input name="company" maxlength="120"></label>
      <label>Color de marca<input name="brand_color" type="color" class="color-input"></label>
      <p class="form-error" role="alert" id="account-msg"></p>
      <button class="btn btn-primary" type="submit">Guardar</button>
    </form>
  </section>
  <section class="card"><h2>Logo</h2>
    <p class="muted small">PNG o JPG de hasta 200 KB. Aparece en tus emails y en la pantalla de firma.</p>
    <div class="logo-preview" id="logo-preview"></div>
    <input id="logo-file" type="file" accept="image/png,image/jpeg">
    <p class="form-error" role="alert" id="logo-msg"></p>
    <button class="btn btn-ghost btn-sm" type="button" id="logo-delete" hidden>Quitar logo</button>
  </section>
  <section class="card"><h2>Plan</h2><p id="plan-info" class="muted">Cargando…</p><a class="link-strong" href="/precios">Ver planes</a></section>
  <section class="card" id="seguridad"><h2>Verificación en dos pasos</h2><div id="tfa"><p class="muted">Cargando…</p></div></section>
  <section class="card"><h2>Cambiar contraseña</h2>
    <form id="pwd-form" novalidate>
      <label>Contraseña actual<input name="current_password" type="password" autocomplete="current-password" maxlength="200" required></label>
      <label>Nueva contraseña <span class="muted">(mínimo 10 caracteres)</span><input name="new_password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></label>
      <p class="form-error" role="alert" id="pwd-msg"></p>
      <button class="btn btn-primary" type="submit">Cambiar contraseña</button>
      <p class="muted small">Al cambiarla se cierran tus otras sesiones abiertas.</p>
    </form>
  </section>
  <section class="card"><div class="card-head"><h2>Sesiones abiertas</h2><button class="btn btn-ghost btn-sm" type="button" id="close-others">Cerrar las demás</button></div>
    <p class="form-error" role="alert" id="sess-msg"></p><ul class="rlist" id="sessions"></ul></section>
  <section class="card"><h2>Actividad de la cuenta</h2><p class="muted small">Últimos 50 movimientos de seguridad.</p><ul class="activity" id="activity"></ul></section>
</div>`,
    scripts: ['/static/settings.js', '/static/security.js'],
  });
}

export function accessPage(config) {
  const body = `<section class="auth"><div class="auth-card">
  <a class="logo" href="/" aria-label="DocSure, inicio">${LOGO_SVG}<span>DocSure</span></a>
  <h1>Firmar con código de acceso</h1>
  <p class="muted">Escribí el código de 12 caracteres que figura en tu invitación. Así llegás a tu documento sin tocar enlaces del email.</p>
  <p class="muted small" lang="en">Sign with your access code · Assinar com código de acesso · Signer avec votre code · Mit Zugangscode unterschreiben · Firma con il codice</p>
  <form id="access-form" novalidate>
    <label for="access-code">Código de acceso</label>
    <input id="access-code" class="otp-input access-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="14" placeholder="XXXX-XXXX-XXXX" required>
    <p class="form-error" role="alert" id="access-err"></p>
    <button class="btn btn-primary btn-block btn-lg" type="submit">Continuar</button>
  </form>
</div></section>`;
  return page({ config, path: '/acceder', title: 'Firmar con código de acceso', description: 'Entrá a tu documento de DocSure escribiendo el código de acceso de tu invitación, sin tocar enlaces del email.', body, chrome: false, bodyClass: 'auth-body', scripts: ['/static/access.js'] });
}

export function connectPage(config, user) {
  return appShell(config, user, {
    title: 'Conectar asistente',
    active: 'api',
    body: `<div class="wrap-app app-main"><div class="sign-card" id="connect"><p class="muted">Cargando…</p></div></div>`,
    scripts: ['/static/connect.js'],
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
