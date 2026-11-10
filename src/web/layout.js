import { escapeHtml } from '../validate.js';

export const LOGO_SVG = `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="#1f4e9c"/><path d="M10 6.5h8.2l5.3 5.3V25a1.5 1.5 0 0 1-1.5 1.5H10A1.5 1.5 0 0 1 8.5 25V8A1.5 1.5 0 0 1 10 6.5z" fill="#fff"/><path d="M12.4 18.6l2.7 2.7 5.3-5.8" stroke="#1f4e9c" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const NAV = [
  {
    label: 'Producto',
    groups: [
      {
        title: 'Plataforma',
        items: [
          ['/producto#firma', 'Firma electrónica', 'Enviá y firmá desde cualquier dispositivo'],
          ['/producto#preparacion', 'Preparación de documentos', 'Arrastrá campos sobre tu PDF en segundos'],
          ['/producto#sello', 'Sello digital y auditoría', 'Pruebas criptográficas en cada documento'],
          ['/producto#plantillas', 'Plantillas y envío masivo', 'Cientos de sobres desde un CSV'],
        ],
      },
      {
        title: 'Integraciones y verificación',
        items: [
          ['/integraciones', 'Integraciones', 'API, webhooks, Zapier, Make y n8n'],
          ['/verificar', 'Verificador público', 'Comprobá si un documento fue alterado'],
          ['/desarrolladores', 'API y conexión con IA', 'Integrá DocSure en minutos'],
        ],
      },
    ],
  },
  {
    label: 'Soluciones',
    groups: [
      {
        title: 'Por área',
        items: [
          ['/soluciones/ventas', 'Ventas', 'Cerrá acuerdos el mismo día'],
          ['/soluciones/recursos-humanos', 'Recursos Humanos', 'Contratos y altas sin papel'],
          ['/soluciones/legal', 'Legal', 'Control total y trazabilidad'],
          ['/soluciones/compras', 'Compras', 'Proveedores firmando en minutos'],
          ['/soluciones/experiencia-del-cliente', 'Experiencia del cliente', 'Firmas en minutos, con tu marca'],
        ],
      },
      {
        title: 'Por sector',
        items: [
          ['/soluciones/servicios-financieros', 'Servicios financieros', 'Altas de clientes con evidencia'],
          ['/soluciones/seguros', 'Seguros', 'Pólizas y siniestros sin papel'],
          ['/soluciones/inmobiliarias', 'Inmobiliario', 'Alquileres y reservas a distancia'],
          ['/soluciones/salud', 'Salud', 'Consentimientos informados'],
          ['/soluciones/ciencias-de-la-vida', 'Ciencias de la vida', 'Aprobaciones con auditoría'],
          ['/soluciones/educacion', 'Educación', 'Inscripciones y autorizaciones'],
        ],
      },
      {
        title: 'Por tamaño',
        items: [
          ['/soluciones/pymes', 'PyMEs', 'Empezá gratis, sin tarjeta'],
          ['/soluciones/grandes-empresas', 'Grandes empresas', 'Equipos, API y seguridad'],
          ['/soluciones', 'Ver todas las soluciones', 'Áreas, sectores y tamaños'],
        ],
      },
    ],
  },
  {
    label: 'Recursos',
    groups: [
      {
        title: 'Aprender',
        items: [
          ['/ayuda', 'Centro de ayuda', 'Guías paso a paso'],
          ['/validez-legal', 'Validez legal', 'eIDAS, ESIGN y Ley 25.506 explicados'],
          ['/tipos-de-firma', 'Tipos de firma', 'Simple, avanzada, cualificada y digital'],
          ['/blog', 'Blog', 'Guías de firma electrónica'],
        ],
      },
      {
        title: 'Herramientas y confianza',
        items: [
          ['/generador-de-firma', 'Generador de firma gratis', 'Creá tu firma en PNG'],
          ['/seguridad', 'Centro de confianza', 'Cómo protegemos tus documentos'],
          ['/comparar/docusign', 'DocSure vs. DocuSign', 'Más funciones por menos precio'],
          ['/precios#preguntas', 'Preguntas frecuentes', 'Todo sobre planes y sobres'],
        ],
      },
    ],
  },
];

function megaMenu() {
  return NAV.map(
    (menu) => `<li class="nav-item has-menu">
      <details class="menu">
        <summary>${menu.label}</summary>
        <div class="mega" style="--cols:${menu.groups.length}">${menu.groups
          .map(
            (g) => `<div class="mega-col"><p class="mega-title">${g.title}</p><ul>${g.items
              .map(([href, t, d]) => `<li><a href="${href}"><strong>${t}</strong><span>${d}</span></a></li>`)
              .join('')}</ul></div>`,
          )
          .join('')}</div>
      </details>
    </li>`,
  ).join('');
}

export function header({ user } = {}) {
  const actions = user
    ? `<a class="btn btn-primary" href="/app">Ir a mis documentos</a>`
    : `<a class="link-strong" href="/ingresar">Ingresar</a><a class="btn btn-primary" href="/registro">Empezar gratis</a>`;
  return `<a class="skip" href="#contenido">Saltar al contenido</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="logo" href="/" aria-label="DocSure, inicio">${LOGO_SVG}<span>DocSure</span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav" aria-label="Abrir menú"><span></span><span></span><span></span></button>
    <nav id="nav" class="nav" aria-label="Principal">
      <ul class="nav-list">
        ${megaMenu()}
        <li class="nav-item"><a href="/precios">Precios</a></li>
        <li class="nav-item"><a href="/desarrolladores">Desarrolladores</a></li>
        <li class="nav-item"><a href="/verificar">Verificar documento</a></li>
      </ul>
      <div class="nav-actions">${actions}</div>
    </nav>
  </div>
</header>`;
}

export function footer() {
  const year = new Date().getUTCFullYear();
  return `<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="footer-brand">
      <a class="logo logo-light" href="/" aria-label="DocSure, inicio">${LOGO_SVG}<span>DocSure</span></a>
      <p>Firma electrónica con pruebas criptográficas en cada documento. Más funciones, menos precio.</p>
    </div>
    <div><p class="footer-title">Producto</p><ul>
      <li><a href="/producto">Funcionalidades</a></li><li><a href="/precios">Precios</a></li>
      <li><a href="/verificar">Verificar un documento</a></li><li><a href="/desarrolladores">API para desarrolladores</a></li><li><a href="/integraciones">Integraciones</a></li><li><a href="/comparar/docusign">DocSure vs. DocuSign</a></li><li><a href="/registro">Crear cuenta gratis</a></li></ul></div>
    <div><p class="footer-title">Soluciones</p><ul>
      <li><a href="/soluciones/ventas">Ventas</a></li><li><a href="/soluciones/recursos-humanos">Recursos Humanos</a></li>
      <li><a href="/soluciones/legal">Legal</a></li><li><a href="/soluciones/seguros">Seguros</a></li><li><a href="/soluciones/inmobiliarias">Inmobiliario</a></li><li><a href="/soluciones/pymes">PyMEs</a></li><li><a href="/soluciones/grandes-empresas">Grandes empresas</a></li><li><a href="/soluciones">Ver todas</a></li></ul></div>
    <div><p class="footer-title">Recursos</p><ul>
      <li><a href="/ayuda">Centro de ayuda</a></li><li><a href="/generador-de-firma">Generador de firma gratis</a></li><li><a href="/seguridad">Centro de confianza</a></li><li><a href="/validez-legal">Validez legal</a></li>
      <li><a href="/precios#preguntas">Preguntas frecuentes</a></li><li><a href="/tipos-de-firma">Tipos de firma</a></li><li><a href="/blog">Blog</a></li><li><a href="/acceder">Firmar con código de acceso</a></li></ul></div>
    <div><p class="footer-title">Legal</p><ul>
      <li><a href="/legal/terminos">Términos y condiciones</a></li><li><a href="/legal/privacidad">Política de privacidad</a></li>
      <li><a href="/legal/cookies">Cookies</a></li></ul></div>
  </div>
  <div class="wrap footer-bottom"><p>© ${year} DocSure. Todos los derechos reservados.</p><p>docsure.app</p></div>
</footer>`;
}

export function page({ config, path, title, description, body, user, jsonLd = [], noindex = false, scripts = [], bodyClass = '', chrome = true }) {
  const canonical = `${config.siteUrl}${path === '/' ? '/' : path}`;
  const fullTitle = path === '/' ? title : `${title} | DocSure`;
  const ld = jsonLd.map((obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`).join('');
  const v = config.assetVersion;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${canonical}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="DocSure">
<meta property="og:locale" content="es_AR">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${config.appUrl}/static/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="DocSure: firma electrónica con sello digital">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${config.appUrl}/static/og.png">
<meta name="theme-color" content="#1f4e9c">
<link rel="icon" href="/static/favicon.svg?v=${v}" type="image/svg+xml">
<link rel="stylesheet" href="/static/site.css?v=${v}">
${ld}
</head>
<body class="${bodyClass}">
${chrome ? header({ user }) : ''}
<main id="contenido">${body}</main>
${chrome ? footer() : ''}
<script src="/static/site.js?v=${v}" defer></script>
${scripts.map((s) => `<script type="module" src="${s}?v=${v}"></script>`).join('')}
</body>
</html>`;
}
