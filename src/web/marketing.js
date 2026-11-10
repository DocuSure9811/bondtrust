import { page } from './layout.js';

const soon = '<span class="badge-soon">Pronto</span>';
const check = '<span class="ic-check" aria-hidden="true"></span>';

export const PLANS_VIEW = [
  {
    key: 'gratis', name: 'Gratis', monthly: 0, annual: 0, unit: 'para siempre',
    pitch: 'Para empezar a firmar hoy, sin tarjeta.',
    features: ['5 sobres por mes', 'Firmantes ilimitados por sobre', 'Verificación del firmante con código por email', 'Sello digital X.509 y certificado de finalización', 'Registro de auditoría completo', 'Verificador público de documentos', 'API REST, webhooks y conexión con IA'],
  },
  {
    key: 'personal', name: 'Personal', monthly: 9, annual: 7, unit: 'por mes',
    pitch: 'Para profesionales independientes.',
    features: ['25 sobres por mes', 'Todo lo del plan Gratis', 'Firma en orden secuencial', 'Reenvío y anulación de sobres', `Plantillas reutilizables ${soon}`, `Recordatorios automáticos ${soon}`],
  },
  {
    key: 'profesional', name: 'Profesional', monthly: 19, annual: 15, unit: 'por usuario / mes', popular: true,
    pitch: 'Para equipos que firman todos los días.',
    features: ['Sobres ilimitados', 'Todo lo del plan Personal', `Marca propia en emails y firma ${soon}`, `Envío masivo desde CSV ${soon}`, `Campos condicionales y fórmulas ${soon}`, `20 SMS de verificación por mes ${soon}`],
  },
  {
    key: 'empresa', name: 'Empresa', monthly: 36, annual: 29, unit: 'por usuario / mes',
    pitch: 'Para automatizar e integrar.',
    features: ['Todo lo del plan Profesional', `Inicio de sesión único (SSO) ${soon}`, `Roles y permisos por equipo ${soon}`, `Firma electrónica avanzada (AES) ${soon}`, 'Soporte prioritario'],
  },
];

function planCards() {
  return PLANS_VIEW.map(
    (p) => `<article class="plan${p.popular ? ' plan-popular' : ''}">
      ${p.popular ? '<p class="plan-flag">El más elegido</p>' : ''}
      <h3>${p.name}</h3>
      <p class="plan-pitch">${p.pitch}</p>
      <p class="plan-price"><span class="currency">US$</span><span class="amount" data-monthly="${p.monthly}" data-annual="${p.annual}">${p.annual}</span><span class="per">${p.unit}</span></p>
      <p class="plan-billing" data-annual-text="${p.monthly ? 'Facturación anual' : 'Sin tarjeta de crédito'}" data-monthly-text="${p.monthly ? 'Facturación mensual' : 'Sin tarjeta de crédito'}">${p.monthly ? 'Facturación anual' : 'Sin tarjeta de crédito'}</p>
      <a class="btn ${p.popular ? 'btn-primary' : 'btn-outline'} btn-block" href="/registro?plan=${p.key}">${p.monthly ? `Elegir ${p.name}` : 'Crear cuenta gratis'}</a>
      <ul class="checklist">${p.features.map((f) => `<li>${check}${f}</li>`).join('')}</ul>
    </article>`,
  ).join('');
}

const FAQ = [
  ['¿Las firmas de DocSure tienen validez legal?', 'Sí. DocSure genera firmas electrónicas reconocidas en la gran mayoría de los países: firma electrónica simple según el reglamento eIDAS en la Unión Europea, firma electrónica según ESIGN y UETA en Estados Unidos y firma electrónica según la Ley 25.506 en Argentina. Cada documento incluye un certificado de finalización con la evidencia de quién firmó, cuándo y desde dónde. Para actos en los que la ley exige firma digital o firma cualificada, consultá a tu asesor legal.'],
  ['¿Los firmantes necesitan crear una cuenta?', 'No. Quien firma recibe un enlace personal por email, confirma su identidad con un código de un solo uso y firma desde cualquier navegador, en computadora o celular.'],
  ['¿Qué es un sobre?', 'Un sobre es un envío para firmar: incluye el documento, los firmantes y los campos que cada uno completa. Podés incluir tantos firmantes como necesites en un mismo sobre.'],
  ['¿Cómo compruebo que un documento firmado no fue alterado?', 'Cada documento final lleva un sello digital X.509. Subilo en docsure.app/verificar: comprobamos el sello criptográficamente y te mostramos quién lo firmó. Si se cambió un solo byte, el verificador lo detecta.'],
  ['¿Puedo cambiar de plan cuando quiera?', 'Sí. El plan Gratis no pide tarjeta y podés pasar a un plan superior en cualquier momento.'],
  ['¿Cómo protegen mis documentos?', 'Todo viaja cifrado con HTTPS, los enlaces de firma son personales, de un solo uso y vencen, cada firmante confirma su identidad con un código y cada acción queda en un registro de auditoría. Más detalles en el Centro de confianza.'],
];

function faqSection() {
  return `<section class="section" id="preguntas"><div class="wrap narrow">
    <h2 class="section-title">Preguntas frecuentes</h2>
    <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
  </div></section>`;
}

function faqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
}

function softwareJsonLd(config) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'DocSure',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: config.siteUrl,
    description: 'Plataforma de firma electrónica con sello digital, verificación del firmante y registro de auditoría.',
    offers: PLANS_VIEW.map((p) => ({ '@type': 'Offer', name: p.name, price: String(p.annual), priceCurrency: 'USD' })),
  };
}

const FEATURES = [
  ['ic-sign', 'Firma desde cualquier dispositivo', 'Tus firmantes dibujan o escriben su firma en el celular o la compu. Sin apps ni cuentas.'],
  ['ic-shield', 'Identidad verificada', 'Antes de firmar, cada persona confirma un código de un solo uso enviado a su email.'],
  ['ic-seal', 'Sello digital X.509', 'El PDF final queda sellado criptográficamente. Cualquier cambio posterior lo invalida.'],
  ['ic-list', 'Auditoría completa', 'Certificado de finalización con fechas, IP, navegador y cada paso del proceso.'],
  ['ic-search', 'Verificador público', 'Cualquiera puede comprobar en segundos que un documento firmado es auténtico.'],
  ['ic-list', 'API y conexión con IA', 'Tu asistente de IA se conecta con un clic y envía documentos por vos. API y webhooks en todos los planes.'],
];

export function home(config, user) {
  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">Firma electrónica · Sello digital · Auditoría</p>
      <h1>Firmá contratos en minutos, con pruebas que nadie puede discutir.</h1>
      <p class="lead">DocSure te da todo lo que esperás de una plataforma de firma electrónica, y suma lo que las demás cobran aparte: verificación del firmante, sello digital y un verificador público. Desde US$0.</p>
      <div class="hero-cta">
        <a class="btn btn-primary btn-lg" href="/registro">Empezar gratis</a>
        <a class="btn btn-ghost btn-lg" href="#como-funciona">Ver cómo funciona</a>
      </div>
      <ul class="hero-points"><li>${check}Sin tarjeta de crédito</li><li>${check}5 sobres gratis por mes</li><li>${check}Firmantes sin cuenta</li></ul>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <div class="doc-card">
        <div class="doc-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="doc-title">Contrato de servicios.pdf</span></div>
        <div class="doc-lines"><span></span><span></span><span class="short"></span><span></span><span class="short"></span></div>
        <div class="doc-sign"><span class="sign-label">Firma</span><span class="sign-stroke">María G.</span></div>
        <div class="doc-seal">${check}Sellado y verificado</div>
      </div>
    </div>
  </div>
</section>

<section class="strip"><div class="wrap strip-row">
  <p><strong>eIDAS</strong> firma electrónica simple</p><p><strong>ESIGN / UETA</strong> Estados Unidos</p><p><strong>Ley 25.506</strong> Argentina</p><p><strong>SHA-256</strong> + X.509 en cada documento</p>
</div></section>

<section class="section" id="como-funciona"><div class="wrap">
  <h2 class="section-title">Tres pasos y listo</h2>
  <p class="section-lead">Del PDF a un documento firmado, sellado y auditado, sin imprimir nada.</p>
  <ol class="steps">
    <li><span class="step-n">1</span><h3>Subí tu PDF</h3><p>Arrastrá el documento, agregá a los firmantes y ubicá los campos de firma, fecha, texto o casillas.</p></li>
    <li><span class="step-n">2</span><h3>Ellos firman</h3><p>Cada firmante recibe un enlace personal, confirma su identidad con un código y firma desde el celular.</p></li>
    <li><span class="step-n">3</span><h3>Recibí la prueba</h3><p>Todos reciben el PDF final con sello digital y certificado de finalización. Listo para archivar.</p></li>
  </ol>
</div></section>

<section class="section section-soft"><div class="wrap">
  <h2 class="section-title">Todo lo que necesitás para tus acuerdos</h2>
  <div class="feature-grid">${FEATURES.map(([ic, t, d]) => `<article class="feature"><span class="ic ${ic}" aria-hidden="true"></span><h3>${t}</h3><p>${d}</p></article>`).join('')}</div>
  <p class="center"><a class="link-strong" href="/producto">Ver todas las funcionalidades →</a></p>
</div></section>

<section class="section"><div class="wrap narrow">
  <h2 class="section-title">Más por menos</h2>
  <p class="section-lead">Comparación con los precios públicos del plan de entrada de DocuSign (noviembre de 2026, facturación anual).</p>
  <div class="table-wrap"><table class="compare">
    <thead><tr><th scope="col"></th><th scope="col">DocSure</th><th scope="col">DocuSign</th></tr></thead>
    <tbody>
      <tr><th scope="row">Plan gratuito para enviar</th><td>${check}5 sobres por mes</td><td>Solo prueba</td></tr>
      <tr><th scope="row">Precio del plan de entrada</th><td>US$7 por mes</td><td>9 € por mes</td></tr>
      <tr><th scope="row">Sobres en el plan de entrada</th><td>25 por mes</td><td>5 por mes</td></tr>
    </tbody>
  </table></div>
</div></section>

<section class="section section-soft"><div class="wrap">
  <h2 class="section-title">Planes simples</h2>
  <p class="section-lead">Empezá gratis y crecé cuando lo necesites.</p>
  <div class="plans plans-compact">${planCards()}</div>
  <p class="center"><a class="link-strong" href="/precios">Comparar planes en detalle →</a></p>
</div></section>

<section class="cta-band"><div class="wrap cta-row">
  <div><h2>Tu próximo contrato, firmado hoy.</h2><p>Creá tu cuenta en un minuto. Sin tarjeta.</p></div>
  <a class="btn btn-light btn-lg" href="/registro">Empezar gratis</a>
</div></section>`;

  return page({
    config, user, path: '/',
    title: 'DocSure: firma electrónica con sello digital y auditoría',
    description: 'Firmá contratos online en minutos. Verificación del firmante, sello digital X.509, certificado de finalización y verificador público. Plan gratis para siempre.',
    body,
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'Organization', name: 'DocSure', url: config.siteUrl, logo: `${config.siteUrl}/static/favicon.svg` },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'DocSure', url: config.siteUrl, inLanguage: 'es' },
      softwareJsonLd(config),
    ],
  });
}

export function pricing(config, user) {
  const rows = [
    ['Sobres por mes', '5', '25', 'Ilimitados', 'Ilimitados'],
    ['Firmantes por sobre', 'Ilimitados', 'Ilimitados', 'Ilimitados', 'Ilimitados'],
    ['Verificación del firmante con código por email', check, check, check, check],
    ['Sello digital X.509 en el PDF final', check, check, check, check],
    ['Certificado de finalización y auditoría', check, check, check, check],
    ['Verificador público de documentos', check, check, check, check],
    ['Firma en orden secuencial', check, check, check, check],
    ['Reenvío, anulación y rechazo con motivo', check, check, check, check],
    ['Plantillas reutilizables', '—', soon, soon, soon],
    ['Recordatorios automáticos', '—', soon, soon, soon],
    ['Marca propia', '—', '—', soon, soon],
    ['Envío masivo desde CSV', '—', '—', soon, soon],
    ['SMS de verificación', '—', '—', `20 / mes ${soon}`, `50 / mes ${soon}`],
    ['API REST y webhooks firmados', check, check, check, check],
    ['Conexión con asistentes de IA (Claude, Cursor…)', check, check, check, check],
    ['SSO y roles', '—', '—', '—', soon],
  ];
  const body = `
<section class="page-hero"><div class="wrap narrow center">
  <h1>Precios claros. Más funciones, menos costo.</h1>
  <p class="lead">Todos los planes incluyen verificación del firmante, sello digital y auditoría. Sin letra chica.</p>
  <div class="billing-toggle" role="group" aria-label="Período de facturación">
    <button type="button" class="active" data-billing="annual" aria-pressed="true">Anual <span class="save">Ahorrá hasta 22%</span></button>
    <button type="button" data-billing="monthly" aria-pressed="false">Mensual</button>
  </div>
</div></section>
<section class="section section-tight"><div class="wrap"><div class="plans">${planCards()}</div>
  <div class="enterprise"><div><h2>Corporativo</h2><p>Volumen a medida, acuerdos de nivel de servicio y acompañamiento en la implementación.</p></div><a class="btn btn-outline" href="mailto:ventas@docsure.app">Hablar con ventas</a></div>
</div></section>
<section class="section"><div class="wrap">
  <h2 class="section-title">Comparación de planes</h2>
  <div class="table-wrap"><table class="compare compare-plans">
    <thead><tr><th scope="col">Funcionalidad</th>${PLANS_VIEW.map((p) => `<th scope="col">${p.name}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([f, ...cells]) => `<tr><th scope="row">${f}</th>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>
  <p class="note">Precios en dólares estadounidenses, sin impuestos. Las funciones marcadas como “Pronto” están en desarrollo y se incluyen en el plan sin costo adicional cuando se lancen.</p>
</div></section>
${faqSection()}`;
  return page({
    config, user, path: '/precios',
    title: 'Precios y planes de firma electrónica',
    description: 'Planes de firma electrónica desde US$0. Plan gratis con 5 sobres por mes, plan Personal con 25 sobres por US$7 y planes ilimitados para equipos.',
    body,
    jsonLd: [softwareJsonLd(config), faqJsonLd()],
  });
}

export function product(config, user) {
  const blocks = [
    ['firma', 'Firma electrónica', 'Tus firmantes reciben un email con un enlace personal. Lo abren en cualquier navegador, confirman su identidad y firman dibujando con el dedo, el mouse o escribiendo su nombre. Pueden rechazar indicando el motivo, y vos te enterás al instante.', ['Firma dibujada o escrita', 'Iniciales, fecha, nombre, email, texto y casillas', 'Pensado primero para el celular', 'Rechazo con motivo']],
    ['preparacion', 'Preparación de documentos', 'Subí un PDF, agregá a los firmantes y arrastrá los campos sobre cada página. Cada firmante tiene un color, así ves de un vistazo quién completa qué.', ['Editor visual página por página', 'Campos obligatorios u opcionales', 'Firma en paralelo o en orden', 'Destinatarios que solo reciben copia']],
    ['sello', 'Sello digital y auditoría', 'Cuando firma el último, DocSure estampa las firmas en el PDF, agrega un certificado de finalización con todo el registro y sella el archivo con un certificado X.509. Si alguien cambia un byte, el sello deja de ser válido.', ['Huella SHA-256 del original y del final', 'IP, navegador y hora de cada acción', 'Sello criptográfico PKCS#7', 'Verificador público en docsure.app/verificar']],
    ['seguimiento', 'Seguimiento en tiempo real', 'Desde tu panel ves cada sobre: quién lo abrió, quién verificó su identidad y quién firmó. Podés reenviar el enlace o anular el sobre cuando quieras.', ['Estados por firmante', 'Historial completo', 'Reenvío seguro: el enlace anterior deja de funcionar', 'Descarga del original y del final']],
  ];
  const body = `
<section class="page-hero"><div class="wrap narrow center">
  <h1>Todo lo que hace una plataforma de firma líder. Y más.</h1>
  <p class="lead">DocSure cubre el ciclo completo: preparar, enviar, firmar, sellar y verificar.</p>
  <a class="btn btn-primary btn-lg" href="/registro">Probar gratis</a>
</div></section>
${blocks
  .map(
    ([id, title, text, items], i) => `<section class="section${i % 2 ? ' section-soft' : ''}" id="${id}"><div class="wrap split">
  <div><h2>${title}</h2><p class="lead-sm">${text}</p></div>
  <ul class="checklist checklist-lg">${items.map((x) => `<li>${check}${x}</li>`).join('')}</ul>
</div></section>`,
  )
  .join('')}
<section class="section"><div class="wrap narrow">
  <h2 class="section-title">Lo que viene</h2>
  <p class="section-lead">Funciones en desarrollo, incluidas en los planes cuando se lancen.</p>
  <ul class="roadmap">
    <li>Plantillas reutilizables y compartidas ${soon}</li><li>Recordatorios y vencimientos automáticos ${soon}</li>
    <li>Envío masivo desde CSV ${soon}</li><li>Marca propia (logo y colores) ${soon}</li>
    <li>Verificación por SMS y WhatsApp ${soon}</li>
    <li>Firma electrónica avanzada (AES) ${soon}</li><li>Inicio de sesión único (SSO) ${soon}</li>
  </ul>
</div></section>`;
  return page({
    config, user, path: '/producto',
    title: 'Funcionalidades de firma electrónica',
    description: 'Editor de campos sobre PDF, firma en orden, verificación del firmante con código, sello digital X.509, certificado de finalización y verificador público.',
    body,
  });
}

export function solutions(config, user) {
  const items = [
    ['ventas', 'Ventas', 'Mandá la propuesta y el contrato en el mismo momento. Tu cliente firma desde el celular y vos cerrás el acuerdo el mismo día.'],
    ['rrhh', 'Recursos Humanos', 'Contratos laborales, confidencialidad y políticas internas firmados a distancia, con registro de quién aceptó qué y cuándo.'],
    ['legal', 'Legal', 'Trazabilidad completa, sello criptográfico y certificado de finalización para cada acuerdo. Evidencia lista para presentar.'],
    ['compras', 'Compras', 'Órdenes de compra y contratos con proveedores firmados en orden: primero el proveedor, después quien aprueba.'],
    ['inmobiliario', 'Inmobiliario', 'Reservas, boletos y contratos de alquiler firmados por propietarios e inquilinos sin coordinar encuentros.'],
    ['financiero', 'Servicios financieros', 'Altas de clientes, mandatos y declaraciones con identidad verificada y documentación inalterable.'],
    ['salud', 'Salud', 'Consentimientos informados firmados antes de la consulta, con copia automática para el paciente.'],
    ['educacion', 'Educación', 'Inscripciones, autorizaciones de salidas y acuerdos con docentes firmados por familias desde el celular.'],
  ];
  const body = `
<section class="page-hero"><div class="wrap narrow center">
  <h1>Una firma, todos los equipos</h1>
  <p class="lead">DocSure se adapta a cada área y sector que necesita acuerdos rápidos y con respaldo.</p>
</div></section>
<section class="section section-tight"><div class="wrap solutions-grid">
${items.map(([id, t, d]) => `<article class="solution" id="${id}"><h2>${t}</h2><p>${d}</p><a class="link-strong" href="/registro">Empezar gratis →</a></article>`).join('')}
</div></section>`;
  return page({
    config, user, path: '/soluciones',
    title: 'Soluciones de firma electrónica por área y sector',
    description: 'Firma electrónica para ventas, recursos humanos, legal, compras, inmobiliarias, servicios financieros, salud y educación.',
    body,
  });
}

export function security(config, user) {
  const items = [
    ['Cifrado en tránsito', 'Toda la comunicación con DocSure usa HTTPS con TLS y HSTS.'],
    ['Enlaces de un solo uso', 'Cada firmante recibe un enlace personal que vence y deja de funcionar apenas firma. Al reenviarlo, el anterior queda anulado.'],
    ['Verificación de identidad', 'Antes de ver y firmar el documento, el firmante confirma un código de 6 dígitos enviado a su email, con límite de intentos.'],
    ['Sello digital', 'El documento final se sella con un certificado X.509 (PKCS#7, SHA-256). Cualquier alteración posterior se detecta.'],
    ['Huellas SHA-256', 'Registramos la huella del documento original y del final para probar su integridad en cualquier momento.'],
    ['Registro de auditoría', 'Cada evento queda registrado con fecha, IP y navegador, y se incluye en el certificado de finalización.'],
    ['Contraseñas protegidas', 'Las contraseñas se guardan con scrypt y sal única. Los enlaces y códigos se guardan solo como HMAC.'],
    ['Protección contra abuso', 'Límites de intentos en el ingreso, en los códigos y en el verificador, y cabeceras de seguridad estrictas (CSP).'],
  ];
  const body = `
<section class="page-hero"><div class="wrap narrow center">
  <h1>Centro de confianza</h1>
  <p class="lead">Qué hacemos para que cada firma sea segura y cada documento, inalterable.</p>
</div></section>
<section class="section section-tight"><div class="wrap feature-grid">
${items.map(([t, d]) => `<article class="feature"><span class="ic ic-shield" aria-hidden="true"></span><h2 class="h3">${t}</h2><p>${d}</p></article>`).join('')}
</div></section>
<section class="section section-soft"><div class="wrap narrow center">
  <h2 class="section-title">Comprobalo vos mismo</h2>
  <p class="section-lead">Subí cualquier documento firmado con DocSure y verificá su sello en segundos.</p>
  <a class="btn btn-primary btn-lg" href="/verificar">Verificar un documento</a>
</div></section>`;
  return page({
    config, user, path: '/seguridad',
    title: 'Seguridad y centro de confianza',
    description: 'Cómo protege DocSure tus documentos: HTTPS, enlaces de un solo uso, verificación por código, sello digital X.509, huellas SHA-256 y auditoría.',
    body,
  });
}

export function verifyPage(config, user) {
  const body = `
<section class="page-hero"><div class="wrap narrow center">
  <h1>Verificá un documento firmado</h1>
  <p class="lead">Subí un PDF firmado con DocSure. Comprobamos su sello digital y te decimos si fue alterado.</p>
</div></section>
<section class="section section-tight"><div class="wrap narrow">
  <form id="verify-form" class="dropzone" novalidate>
    <input id="verify-file" type="file" accept="application/pdf" class="visually-hidden">
    <label for="verify-file" class="dropzone-label"><span class="ic ic-search" aria-hidden="true"></span><strong>Elegí o arrastrá un PDF</strong><span>Hasta 15 MB. El archivo no se guarda.</span></label>
  </form>
  <div id="verify-result" class="verify-result" role="status" aria-live="polite"></div>
</div></section>`;
  return page({
    config, user, path: '/verificar',
    title: 'Verificar documento firmado',
    description: 'Verificador público de DocSure: comprobá el sello digital de un PDF firmado y detectá cualquier alteración en segundos.',
    body,
    scripts: ['/static/verify.js'],
  });
}

export function legalValidity(config, user) {
  const body = `
<section class="page-hero"><div class="wrap narrow center">
  <h1>Validez legal de la firma electrónica</h1>
  <p class="lead">Qué tipo de firma genera DocSure y qué respaldo tiene en cada región.</p>
</div></section>
<section class="section section-tight"><div class="wrap narrow prose">
  <h2>Unión Europea: reglamento eIDAS</h2>
  <p>El reglamento (UE) 910/2014 reconoce tres niveles: firma electrónica simple (SES), avanzada (AES) y cualificada (QES). Ninguna firma puede ser rechazada como prueba solo por ser electrónica. DocSure genera firmas electrónicas simples respaldadas por verificación del firmante, sello digital y registro de auditoría. La firma avanzada está en desarrollo.</p>
  <h2>Estados Unidos: ESIGN y UETA</h2>
  <p>La ley federal ESIGN y la ley uniforme UETA otorgan a la firma electrónica la misma validez que a la manuscrita, siempre que haya intención de firmar, consentimiento para operar electrónicamente y un registro conservable. DocSure registra el consentimiento explícito de cada firmante y entrega una copia final a todas las partes.</p>
  <h2>Argentina: Ley 25.506 y Código Civil y Comercial</h2>
  <p>La Ley 25.506 distingue la firma electrónica de la firma digital. Las firmas de DocSure son firmas electrónicas: valen como prueba y, si se desconocen, quien las invoca debe acreditarlas. Para eso DocSure guarda evidencia técnica completa. Para actos que la ley exige con firma digital emitida por un certificador licenciado, se necesita esa modalidad.</p>
  <h2>La evidencia que entrega DocSure</h2>
  <ul><li>Certificado de finalización con la identidad, IP, navegador y hora de cada firmante.</li><li>Verificación del firmante con código de un solo uso enviado a su email.</li><li>Sello digital X.509 que detecta cualquier modificación del documento.</li><li>Huellas SHA-256 del documento original y del documento final.</li></ul>
  <p class="note">Esta página es informativa y no constituye asesoramiento legal.</p>
</div></section>`;
  return page({
    config, user, path: '/validez-legal',
    title: 'Validez legal de la firma electrónica',
    description: 'Qué validez legal tiene la firma electrónica de DocSure en la Unión Europea (eIDAS), Estados Unidos (ESIGN y UETA) y Argentina (Ley 25.506).',
    body,
  });
}

const LEGAL = {
  terminos: {
    title: 'Términos y condiciones',
    description: 'Términos y condiciones de uso de la plataforma de firma electrónica DocSure.',
    html: `<p>Al crear una cuenta o usar DocSure aceptás estos términos.</p>
<h2>1. El servicio</h2><p>DocSure permite preparar documentos, enviarlos para firma electrónica, recolectar firmas y obtener un documento final sellado con su registro de auditoría.</p>
<h2>2. Tu cuenta</h2><p>Sos responsable de la confidencialidad de tu contraseña y de la actividad de tu cuenta. Tenés que darnos datos verdaderos.</p>
<h2>3. Uso aceptable</h2><p>No podés usar DocSure para actividades ilegales, para suplantar identidades, para enviar documentos a personas que no los esperan de forma masiva ni para distribuir software malicioso.</p>
<h2>4. Tus documentos</h2><p>Los documentos que subís son tuyos. Los tratamos solo para prestar el servicio. Sos responsable de tener derecho a compartirlos con los firmantes.</p>
<h2>5. Validez de las firmas</h2><p>DocSure genera firmas electrónicas y evidencia técnica. La validez de un acuerdo depende de la ley aplicable y de su contenido; DocSure no brinda asesoramiento legal.</p>
<h2>6. Planes</h2><p>Cada plan tiene los límites publicados en la página de precios. Podemos actualizar los planes avisando con anticipación.</p>
<h2>7. Responsabilidad</h2><p>Prestamos el servicio con diligencia profesional, sin garantizar que esté libre de interrupciones. Nuestra responsabilidad se limita a lo pagado en los últimos doce meses, salvo dolo o culpa grave.</p>
<h2>8. Cambios</h2><p>Podemos modificar estos términos. Los cambios relevantes se avisan por email antes de entrar en vigencia.</p>
<h2>9. Contacto</h2><p>legal@docsure.app</p>`,
  },
  privacidad: {
    title: 'Política de privacidad',
    description: 'Qué datos personales trata DocSure, para qué y cómo podés ejercer tus derechos.',
    html: `<p>Esta política explica qué datos tratamos cuando usás DocSure.</p>
<h2>Datos que tratamos</h2><ul><li>De quien envía: nombre, email, empresa y contraseña (guardada cifrada con scrypt).</li><li>De quien firma: nombre, email, firma, dirección IP, navegador y horarios de cada acción, como evidencia de la firma.</li><li>Los documentos que se suben para firmar.</li></ul>
<h2>Para qué</h2><p>Para prestar el servicio, generar el registro de auditoría y el certificado de finalización, prevenir fraudes y cumplir obligaciones legales. No vendemos datos ni los usamos para publicidad.</p>
<h2>Con quién los compartimos</h2><p>Con proveedores que nos ayudan a operar (hosting, base de datos y envío de emails), bajo obligaciones de confidencialidad, y con las partes de cada documento.</p>
<h2>Cuánto tiempo</h2><p>Mientras tu cuenta esté activa y durante el plazo necesario para conservar la evidencia de las firmas.</p>
<h2>Tus derechos</h2><p>Podés pedir acceso, rectificación o supresión de tus datos escribiendo a privacidad@docsure.app. En Argentina, la Agencia de Acceso a la Información Pública es la autoridad de control de la Ley 25.326.</p>`,
  },
  cookies: {
    title: 'Política de cookies',
    description: 'DocSure usa únicamente cookies técnicas necesarias para mantener tu sesión.',
    html: `<p>DocSure usa solo cookies técnicas imprescindibles.</p>
<h2>Cookies que usamos</h2><ul><li><strong>ds_session</strong>: mantiene tu sesión iniciada. Es HttpOnly, segura y vence a los 30 días.</li></ul>
<h2>Cookies que no usamos</h2><p>No usamos cookies de publicidad, de seguimiento ni de terceros. Por eso no necesitás aceptar ningún aviso de cookies.</p>`,
  },
};

export function legal(config, user, slug) {
  const doc = LEGAL[slug];
  if (!doc) return null;
  const body = `<section class="page-hero"><div class="wrap narrow"><h1>${doc.title}</h1><p class="muted">Última actualización: noviembre de 2026</p></div></section>
<section class="section section-tight"><div class="wrap narrow prose">${doc.html}</div></section>`;
  return page({ config, user, path: `/legal/${slug}`, title: doc.title, description: doc.description, body });
}

export const SITEMAP_PATHS = ['/', '/producto', '/precios', '/soluciones', '/seguridad', '/verificar', '/desarrolladores', '/validez-legal', '/registro', '/legal/terminos', '/legal/privacidad', '/legal/cookies'];
