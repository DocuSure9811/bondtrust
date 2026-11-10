import { page } from './layout.js';

const check = '<span class="ic-check" aria-hidden="true"></span>';
const soon = '<span class="badge-soon">Pronto</span>';

function hero(title, lead, cta = '') {
  return `<section class="page-hero"><div class="wrap narrow center"><h1>${title}</h1><p class="lead">${lead}</p>${cta}</div></section>`;
}

export function integrations(config, user) {
  const items = [
    ['API REST', 'Creá, enviá, consultá y descargá sobres desde cualquier lenguaje. Una sola llamada envía un documento a firmar.', '/desarrolladores#enviar', 'Ver la API'],
    ['Webhooks firmados', 'Tu sistema se entera al instante cuando alguien abre, firma o rechaza. Cada aviso va firmado con HMAC-SHA256.', '/desarrolladores#webhooks', 'Ver webhooks'],
    ['Asistentes de IA', 'Claude, Cursor, Copilot y otros asistentes se conectan con un clic y hacen la integración por vos, sin copiar claves.', '/desarrolladores#ia', 'Conectar mi IA'],
    ['Zapier, Make y n8n', 'Conectá DocSure con miles de apps usando sus módulos de webhook y de solicitudes HTTP. Sin conectores nativos todavía.', '/desarrolladores#webhooks', 'Cómo hacerlo'],
    ['Plantillas y envío masivo', 'Guardá documentos con sus campos como plantilla y enviá cientos de sobres desde un CSV, también por API.', '/producto#plantillas', 'Ver plantillas'],
    ['OpenAPI 3.1', 'Generá clientes en cualquier lenguaje e importá la especificación en Postman o Insomnia.', '/openapi.json', 'Descargar especificación'],
  ];
  const body = `${hero('Integraciones', 'DocSure se conecta con tus sistemas por API, webhooks o directamente desde tu asistente de IA.')}
<section class="section section-tight"><div class="wrap feature-grid">
${items.map(([t, d, href, cta]) => `<article class="feature"><span class="ic ic-list" aria-hidden="true"></span><h2 class="h3">${t}</h2><p>${d}</p><p><a class="link-strong" href="${href}">${cta} →</a></p></article>`).join('')}
</div></section>
<section class="section section-soft"><div class="wrap narrow center">
  <h2 class="section-title">Incluido en todos los planes</h2>
  <p class="section-lead">La API, los webhooks y la conexión con IA están disponibles desde el plan Gratis.</p>
  <a class="btn btn-primary btn-lg" href="/registro">Crear cuenta gratis</a>
</div></section>`;
  return page({ config, user, path: '/integraciones', title: 'Integraciones: API, webhooks y asistentes de IA', description: 'Integrá la firma electrónica de DocSure con tu sistema por API REST, webhooks firmados, Zapier, Make, n8n o tu asistente de IA.', body });
}

export function signatureTypes(config, user) {
  const rows = [
    ['Firma electrónica simple (SES)', 'Reconocida en la UE (eIDAS), EE. UU. (ESIGN/UETA) y como firma electrónica en Argentina (Ley 25.506). Ideal para la gran mayoría de contratos comerciales.', `${check}Incluida en todos los planes`],
    ['Firma electrónica avanzada (AES)', 'Vinculada de forma única al firmante, con identificación reforzada y control exclusivo de los datos de firma.', soon],
    ['Firma electrónica cualificada (QES)', 'Equivale a la firma manuscrita en la UE. Requiere un prestador cualificado de servicios de confianza.', soon],
    ['Firma digital (Argentina)', 'Requiere un certificado emitido por un certificador licenciado. Se usa para actos en los que la ley la exige.', 'Fuera del alcance actual'],
  ];
  const body = `${hero('Tipos de firma electrónica', 'Qué nivel de firma necesita tu documento y cuál ofrece DocSure hoy.')}
<section class="section section-tight"><div class="wrap">
  <div class="table-wrap"><table class="compare"><thead><tr><th scope="col">Tipo</th><th scope="col">Qué es</th><th scope="col">En DocSure</th></tr></thead>
  <tbody>${rows.map(([t, d, s]) => `<tr><th scope="row">${t}</th><td>${d}</td><td>${s}</td></tr>`).join('')}</tbody></table></div>
  <div class="prose" style="margin-top:32px">
    <h2>Qué evidencia respalda cada firma de DocSure</h2>
    <ul><li>Verificación del firmante con código de un solo uso enviado a su email, o firma en persona atestiguada por el remitente.</li>
    <li>Registro de auditoría con fecha, IP y navegador de cada paso, incluido en el certificado de finalización.</li>
    <li>Sello digital X.509 (PKCS#7, SHA-256) que detecta cualquier modificación del documento.</li>
    <li>Huellas SHA-256 del original y del documento final, verificables en <a href="/verificar">/verificar</a>.</li></ul>
    <p class="note">Información general, no constituye asesoramiento legal. Ver también <a href="/validez-legal">Validez legal</a>.</p>
  </div>
</div></section>`;
  return page({ config, user, path: '/tipos-de-firma', title: 'Tipos de firma: simple, avanzada, cualificada y digital', description: 'Diferencias entre firma electrónica simple, avanzada, cualificada y firma digital, y qué tipo de firma ofrece DocSure hoy.', body });
}

export function compareDocusign(config, user) {
  const extras = [
    ['Plan gratis permanente', '5 sobres por mes para siempre, sin tarjeta.'],
    ['API, webhooks y conexión con IA en todos los planes', 'Integrá desde el primer día sin contratar un plan aparte.'],
    ['Corregir no consume cupo', 'Los sobres anulados o corregidos no cuentan para tu límite mensual.'],
    ['Código de acceso anti-phishing', 'El firmante puede entrar en docsure.app/acceder y escribir su código, sin tocar enlaces del email.'],
    ['Verificador público del sello', 'Cualquiera puede comprobar que un documento firmado no fue alterado.'],
    ['Recordatorios y vencimientos configurables', 'Elegí cada cuántos días recordar y extendé el vencimiento con un clic.'],
  ];
  const body = `${hero('DocSure vs. DocuSign', 'Todo lo que necesitás de una plataforma de firma electrónica, por menos.', '<a class="btn btn-primary btn-lg" href="/registro">Probar DocSure gratis</a>')}
<section class="section section-tight"><div class="wrap narrow">
  <h2 class="section-title">Precios del plan de entrada</h2>
  <p class="section-lead">Según los precios públicos de DocuSign (noviembre de 2026, facturación anual).</p>
  <div class="table-wrap"><table class="compare"><thead><tr><th scope="col"></th><th scope="col">DocSure</th><th scope="col">DocuSign</th></tr></thead><tbody>
    <tr><th scope="row">Plan gratuito para enviar</th><td>${check}5 sobres por mes</td><td>Solo prueba</td></tr>
    <tr><th scope="row">Precio del plan de entrada</th><td>US$7 por mes</td><td>9 € por mes</td></tr>
    <tr><th scope="row">Sobres en el plan de entrada</th><td>25 por mes</td><td>5 por mes</td></tr>
  </tbody></table></div>
</div></section>
<section class="section section-soft"><div class="wrap">
  <h2 class="section-title">Lo que DocSure suma</h2>
  <p class="section-lead">Funciones pensadas a partir de lo que más reclaman los usuarios de plataformas de firma.</p>
  <div class="feature-grid">${extras.map(([t, d]) => `<article class="feature"><span class="ic ic-shield" aria-hidden="true"></span><h3>${t}</h3><p>${d}</p></article>`).join('')}</div>
</div></section>`;
  return page({ config, user, path: '/comparar/docusign', title: 'DocSure vs. DocuSign: comparación de precios y funciones', description: 'Compará DocSure con DocuSign: plan gratis permanente, más sobres por menos precio, API incluida y protección anti-phishing para firmantes.', body });
}

export const POSTS = {
  'que-es-la-firma-electronica': {
    title: 'Qué es la firma electrónica y cuándo es válida',
    description: 'Guía clara sobre la firma electrónica: qué es, qué validez legal tiene en Argentina, la Unión Europea y Estados Unidos, y qué evidencia la respalda.',
    date: '2026-11-10',
    html: `<p>La firma electrónica es cualquier dato en forma electrónica que una persona usa para expresar su consentimiento sobre un documento: desde escribir el nombre hasta dibujar la firma en una pantalla. Lo que le da fuerza es la <strong>evidencia</strong> que la acompaña.</p>
<h2>¿Es válida?</h2><p>Sí, en la gran mayoría de los países. En la Unión Europea el reglamento eIDAS impide rechazar una firma solo por ser electrónica. En Estados Unidos, las leyes ESIGN y UETA le dan el mismo valor que a la manuscrita. En Argentina, la Ley 25.506 la reconoce como firma electrónica; si se desconoce, quien la invoca debe probarla.</p>
<h2>Qué evidencia conviene tener</h2><ul><li>Quién firmó y cómo se verificó su identidad.</li><li>Cuándo y desde dónde firmó (fecha, IP y navegador).</li><li>Una prueba de que el documento no cambió después de firmarse.</li></ul>
<p>DocSure reúne todo eso en un certificado de finalización y sella el PDF con un certificado X.509. Podés comprobar cualquier documento en <a href="/verificar">el verificador público</a>.</p>
<h2>¿Cuándo no alcanza?</h2><p>Algunos actos exigen firma digital (Argentina) o firma cualificada (UE), por ejemplo ciertos trámites ante organismos públicos. Ante la duda, consultá a tu asesor legal. Más detalles en <a href="/tipos-de-firma">Tipos de firma</a>.</p>`,
  },
  'firma-electronica-vs-firma-digital': {
    title: 'Firma electrónica vs. firma digital: diferencias',
    description: 'Diferencias entre firma electrónica y firma digital según la Ley 25.506, y cuál conviene usar para contratos comerciales, laborales y alquileres.',
    date: '2026-11-10',
    html: `<p>En Argentina la Ley 25.506 distingue dos figuras que suelen confundirse.</p>
<h2>Firma digital</h2><p>Usa un certificado emitido por un certificador licenciado. Se presume que pertenece al titular del certificado y que el documento no fue alterado. Se necesita cuando la ley la exige expresamente.</p>
<h2>Firma electrónica</h2><p>Es cualquier otra firma en formato electrónico. Es plenamente válida como prueba; la diferencia es que, si alguien la desconoce, quien la presenta debe acreditarla. Por eso importa la evidencia técnica.</p>
<h2>¿Cuál usar?</h2><p>Para la enorme mayoría de los contratos comerciales, de servicios, de alquiler o laborales, una firma electrónica con buena evidencia es suficiente y mucho más ágil: tu contraparte firma desde el celular en minutos. DocSure agrega verificación por código, auditoría completa y sello digital a cada documento.</p>`,
  },
  'como-detectar-emails-de-firma-falsos': {
    title: 'Cómo detectar emails de firma falsos y firmar seguro',
    description: 'Los emails falsos que imitan plataformas de firma son un clásico del phishing. Cómo reconocerlos y cómo firmar sin tocar enlaces con el código de acceso de DocSure.',
    date: '2026-11-10',
    html: `<p>Los atacantes imitan los emails de las plataformas de firma porque la gente está acostumbrada a hacer clic en ellos. Estas señales ayudan a detectarlos:</p>
<ul><li>Te apuran o te amenazan con consecuencias si no firmás ya.</li><li>El enlace lleva a un dominio distinto al de la plataforma.</li><li>Te piden la contraseña de tu email o datos bancarios para "ver el documento".</li><li>No conocés al remitente ni esperabas ningún documento.</li></ul>
<h2>Firmar sin tocar enlaces</h2><p>Cada invitación de DocSure incluye un <strong>código de acceso</strong>. Si dudás del email, abrí vos mismo <a href="/acceder">docsure.app/acceder</a>, escribí el código y llegás al mismo documento sin hacer clic en nada.</p>
<h2>Siempre con verificación</h2><p>Aun con el enlace correcto, nadie puede firmar en tu nombre: DocSure pide un código de verificación que llega a tu email antes de mostrarte el documento. Y nunca te vamos a pedir tu contraseña.</p>`,
  },
};

export const CONTENT_PATHS = ['/integraciones', '/tipos-de-firma', '/comparar/docusign', '/blog', ...Object.keys(POSTS).map((s) => `/blog/${s}`)];

export function blogIndex(config, user) {
  const body = `${hero('Blog de DocSure', 'Guías prácticas sobre firma electrónica, validez legal y seguridad.')}
<section class="section section-tight"><div class="wrap solutions-grid">
${Object.entries(POSTS).map(([slug, p]) => `<article class="solution"><h2><a href="/blog/${slug}">${p.title}</a></h2><p>${p.description}</p><a class="link-strong" href="/blog/${slug}">Leer →</a></article>`).join('')}
</div></section>`;
  return page({ config, user, path: '/blog', title: 'Blog sobre firma electrónica', description: 'Guías prácticas de DocSure sobre firma electrónica, validez legal en Argentina, la UE y EE. UU., y seguridad al firmar documentos.', body });
}

export function blogPost(config, user, slug) {
  const p = POSTS[slug];
  if (!p) return null;
  const body = `<article><section class="page-hero"><div class="wrap narrow"><p class="eyebrow"><a href="/blog">Blog</a></p><h1>${p.title}</h1><p class="muted"><time datetime="${p.date}">10 de noviembre de 2026</time></p></div></section>
<section class="section section-tight"><div class="wrap narrow prose">${p.html}
<p><a class="btn btn-primary" href="/registro">Probar DocSure gratis</a></p></div></section></article>`;
  return page({
    config, user, path: `/blog/${slug}`, title: p.title, description: p.description, body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.description, datePublished: p.date, inLanguage: 'es', author: { '@type': 'Organization', name: 'DocSure' }, publisher: { '@type': 'Organization', name: 'DocSure' }, mainEntityOfPage: `${config.siteUrl}/blog/${slug}` }],
  });
}
