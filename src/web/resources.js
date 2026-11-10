import { page } from './layout.js';

const check = '<span class="ic-check" aria-hidden="true"></span>';

// ---------- Generador de firma gratis ----------

const GENERATOR_FAQ = [
  ['¿Es gratis?', 'Sí, sin cuenta y sin límite. La firma se genera en tu navegador y no se sube a ningún servidor.'],
  ['¿Para qué sirve la imagen de mi firma?', 'Para pegarla en un documento de Word, en un PDF, en tu firma de email o en un formulario. Es una imagen PNG con fondo transparente.'],
  ['¿Una imagen de mi firma tiene validez legal?', 'Por sí sola aporta poca prueba: cualquiera puede copiar una imagen. Para un contrato conviene una firma electrónica con evidencia: verificación de identidad, registro de auditoría y sello que detecte cambios. Eso es lo que hace DocSure, gratis para 5 sobres por mes.'],
  ['¿Puedo usarla desde el celular?', 'Sí. En el celular dibujá con el dedo y descargá la imagen; queda en tus descargas o en la galería.'],
];

export function signatureGenerator(config, user) {
  const body = `<section class="page-hero"><div class="wrap narrow center">
  <p class="eyebrow">Herramienta gratuita</p>
  <h1>Generador de firma online</h1>
  <p class="lead">Dibujá o escribí tu firma y descargala como imagen PNG con fondo transparente. Gratis, sin registrarte y sin subir nada a internet.</p>
</div></section>
<section class="section section-tight"><div class="wrap narrow">
  <div class="card sig-gen" id="sig-gen">
    <div class="modal-tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-tab="draw">Dibujar</button><button type="button" role="tab" aria-selected="false" data-tab="type">Escribir</button></div>
    <div data-panel="draw"><canvas class="pad pad-lg" id="gen-pad" aria-label="Área para dibujar tu firma"></canvas><p class="fine">Dibujá con el mouse, el dedo o un lápiz táctil.</p></div>
    <div data-panel="type" hidden>
      <label>Tu nombre<input id="gen-name" maxlength="60" placeholder="Ej.: María González" autocomplete="name"></label>
      <div class="gen-styles" role="radiogroup" aria-label="Estilo de letra" id="gen-styles"></div>
    </div>
    <div class="gen-row">
      <span class="muted small">Color</span>
      <div class="gen-colors" role="radiogroup" aria-label="Color de la tinta">
        <button type="button" role="radio" aria-checked="true" data-color="#1b2f6b" style="--c:#1b2f6b" aria-label="Azul"></button>
        <button type="button" role="radio" aria-checked="false" data-color="#111111" style="--c:#111111" aria-label="Negro"></button>
        <button type="button" role="radio" aria-checked="false" data-color="#1f4e9c" style="--c:#1f4e9c" aria-label="Azul claro"></button>
      </div>
    </div>
    <p class="form-error" role="alert" id="gen-err"></p>
    <div class="modal-actions"><button class="btn btn-ghost" type="button" id="gen-clear">Borrar</button><button class="btn btn-primary" type="button" id="gen-download">Descargar PNG</button></div>
  </div>
  <p class="center muted small">Tu firma se genera en este navegador. DocSure no la ve ni la guarda.</p>
</div></section>
<section class="section section-soft"><div class="wrap split">
  <div><h2>¿Necesitás que otra persona firme un contrato?</h2><p class="lead-sm">Una imagen no prueba quién firmó. Con DocSure el firmante confirma su identidad con un código, cada paso queda registrado y el PDF final se sella para detectar cualquier cambio.</p><a class="btn btn-primary" href="/registro">Enviar un documento gratis</a></div>
  <ul class="checklist checklist-lg">
    <li>${check}Verificación del firmante por código</li>
    <li>${check}Certificado de finalización con auditoría</li>
    <li>${check}Sello digital X.509 y verificador público</li>
    <li>${check}5 sobres gratis por mes, sin tarjeta</li>
  </ul>
</div></section>
<section class="section"><div class="wrap narrow">
  <h2 class="section-title">Cómo crear tu firma</h2>
  <ol class="steps-list">
    <li><strong>Elegí cómo hacerla.</strong> Dibujala a mano o escribí tu nombre y elegí un estilo de letra.</li>
    <li><strong>Elegí el color.</strong> El azul se distingue mejor de un documento impreso; el negro es el más formal.</li>
    <li><strong>Descargala.</strong> Se guarda un PNG con fondo transparente, recortado al tamaño de la firma.</li>
  </ol>
  <h2 class="section-title">Preguntas frecuentes</h2>
  <div class="faq">${GENERATOR_FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
</div></section>`;
  return page({
    config, user, path: '/generador-de-firma', title: 'Generador de firma online gratis', body,
    description: 'Creá tu firma online gratis: dibujala o escribila, elegí el estilo y descargala en PNG con fondo transparente. Sin registro y sin subir nada.',
    scripts: ['/static/signature-generator.js'],
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Generador de firma online de DocSure', url: `${config.siteUrl}/generador-de-firma`, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Cualquiera', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: GENERATOR_FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  });
}

// ---------- Centro de ayuda ----------

const TOPICS = {
  inicio: 'Primeros pasos',
  enviar: 'Enviar documentos',
  firmar: 'Firmar',
  organizar: 'Organizar',
  cuenta: 'Cuenta, equipo y seguridad',
  integrar: 'API e integraciones',
};

/** Artículos: [slug, tema, título, resumen, html]. */
export const ARTICLES = [
  ['crear-cuenta', 'inicio', 'Crear tu cuenta y enviar el primer documento', 'De cero a un documento enviado en cinco minutos.', `
<ol>
<li>Entrá a <a href="/registro">Crear cuenta</a> con tu nombre, email y una contraseña de al menos 10 caracteres.</li>
<li>En <strong>Mis documentos</strong>, tocá <strong>Nuevo sobre</strong>.</li>
<li>Subí un PDF, un Word (.docx) o fotos del documento y tocá <strong>Siguiente: destinatarios</strong>.</li>
<li>Agregá el nombre y el email de cada firmante y tocá <strong>Siguiente: ubicar campos</strong>.</li>
<li>Elegí un tipo de campo en la paleta (por ejemplo <em>Firma</em>) y hacé clic sobre el documento para ubicarlo.</li>
<li>Tocá <strong>Siguiente: revisar</strong>, revisá el resumen y tocá <strong>Enviar para firmar</strong>.</li>
</ol>
<p>Cada firmante recibe un email con su enlace. En el panel ves el estado de cada uno en tiempo real.</p>`],
  ['planes-y-cupo', 'inicio', 'Planes, sobres y cupo mensual', 'Qué cuenta como sobre y qué pasa al llegar al límite.', `
<p>Un <strong>sobre</strong> es un envío: uno o varios documentos para uno o varios firmantes. El cupo se cuenta por sobre enviado en el mes calendario.</p>
<ul>
<li>Corregir un sobre, reenviar el enlace o extender el vencimiento <strong>no</strong> consume cupo.</li>
<li>Los borradores no cuentan hasta que se envían.</li>
<li>Al llegar al límite, el panel te avisa y podés cambiar de plan desde <a href="/precios">Precios</a>.</li>
</ul>`],
  ['formatos', 'enviar', 'Qué archivos puedo subir', 'PDF, Word, fotos y varios documentos en un mismo sobre.', `
<ul>
<li><strong>PDF</strong>: cualquier PDF de hasta 15 MB. Si tiene campos de formulario, tocá <strong>Detectar campos del PDF</strong> para importarlos.</li>
<li><strong>Word (.docx)</strong>: se convierte a PDF en el servidor con títulos, negrita, listas, tablas e imágenes. Si el diseño es muy complejo, exportalo como PDF desde Word.</li>
<li><strong>Fotos (JPG o PNG)</strong>: cada foto se convierte en una página.</li>
<li><strong>Varios documentos</strong>: subí varios archivos y se unen en un solo sobre; cada firmante firma una sola vez.</li>
</ul>
<p>Los formatos viejos de Word (.doc), .odt y .rtf hay que guardarlos como .docx o PDF antes de subirlos.</p>`],
  ['tipos-de-campo', 'enviar', 'Tipos de campo y para qué sirve cada uno', 'Firma, iniciales, texto, listas, fórmulas, adjuntos y más.', `
<ul>
<li><strong>Firma e iniciales</strong>: el firmante dibuja o escribe su firma.</li>
<li><strong>Fecha de firma, nombre y email</strong>: se completan solos.</li>
<li><strong>Texto</strong>: con formato opcional (email, número, documento de identidad, teléfono).</li>
<li><strong>Casilla, lista, opción única y selección múltiple</strong>: para respuestas cerradas.</li>
<li><strong>Número</strong>: admite fórmulas, por ejemplo <code>{Precio} * {Cantidad}</code>, que se calculan solas mientras el firmante completa.</li>
<li><strong>Teléfono, imagen, sello y adjunto</strong>: el firmante sube una foto, su sello de empresa o un archivo que queda anexado al PDF final.</li>
</ul>
<p>Cualquier campo puede ser <strong>condicional</strong>: en las propiedades del campo, elegí en <em>Mostrar este campo</em> de qué respuesta depende.</p>`],
  ['orden-y-recordatorios', 'enviar', 'Firma en orden, recordatorios y vencimiento', 'Controlá quién firma primero y cuándo se recuerda.', `
<ul>
<li><strong>Firmar en orden</strong>: en el paso de destinatarios, activalo y cada firmante recibe el enlace cuando firmó el anterior.</li>
<li><strong>Recordatorios</strong>: elegí cada cuántos días se recuerda a quien no firmó (1, 2, 3, 5 o 7) o ninguno.</li>
<li><strong>Vence en</strong>: los días que tiene el sobre para completarse. Desde el detalle del sobre podés extenderlo.</li>
<li><strong>Recibe copia</strong>: un destinatario con ese rol no firma y recibe el PDF final.</li>
</ul>`],
  ['plantillas-masivo', 'enviar', 'Plantillas y envío masivo', 'Reutilizá documentos y mandá cientos de sobres desde un CSV.', `
<ol>
<li>Abrí un sobre ya preparado y tocá <strong>Guardar como plantilla</strong>.</li>
<li>En <strong>Plantillas</strong>, usala para un envío individual o elegí <strong>envío masivo</strong> y pegá un CSV con nombre y email.</li>
<li>Se crea un sobre por fila, hasta 200 por vez, y ves el resultado de cada uno.</li>
</ol>
<p>Si tenés un equipo, las plantillas pueden compartirse con todos los miembros.</p>`],
  ['como-firmar', 'firmar', 'Cómo firmar un documento que te enviaron', 'Los pasos del firmante, sin crear cuenta.', `
<ol>
<li>Abrí el enlace del email. Si no lo encontrás, revisá la carpeta de spam.</li>
<li>Tocá <strong>Enviarme el código</strong> e ingresá los 6 dígitos que llegan a tu email.</li>
<li>Completá los campos marcados. Los obligatorios se resaltan hasta que estén listos.</li>
<li>Aceptá el consentimiento y tocá <strong>Finalizar</strong>.</li>
</ol>
<p>Cuando firman todos, recibís un enlace para descargar el PDF final sellado. Si tenés un <a href="/acceder">código de acceso</a>, ingresalo desde esa página.</p>`],
  ['rechazar-o-corregir', 'firmar', 'Rechazar un documento o pedir una corrección', 'Qué pasa si algo está mal en el documento.', `
<p>El firmante puede tocar <strong>Rechazar</strong> e indicar el motivo: el remitente recibe el aviso y el sobre se cierra.</p>
<p>Si sos el remitente y hay un error, abrí el sobre y usá <strong>Corregir</strong>: vuelve a borrador, cambiás lo necesario y lo reenviás sin consumir cupo. Los enlaces anteriores dejan de funcionar.</p>`],
  ['verificar', 'firmar', 'Verificar que un documento no fue alterado', 'Comprobá el sello digital de cualquier PDF firmado con DocSure.', `
<ol>
<li>Entrá a <a href="/verificar">Verificar documento</a>.</li>
<li>Subí el PDF firmado o escaneá el código QR del certificado de finalización.</li>
<li>Si el sello es válido y la huella coincide con nuestro registro, el documento está intacto.</li>
</ol>
<p>Si cambió un solo byte, el verificador lo detecta.</p>`],
  ['carpetas-busqueda', 'organizar', 'Carpetas, búsqueda y exportación', 'Encontrá cualquier documento en segundos.', `
<ul>
<li>Creá <strong>Carpetas</strong> desde el panel y mové sobres con <strong>Mover a</strong>, de a uno o varios a la vez.</li>
<li>Usá <strong>Buscar sobres</strong> por título, firmante o email, y filtrá por estado y fechas.</li>
<li><strong>Exportar CSV</strong> descarga el listado filtrado, listo para Excel o Google Sheets.</li>
</ul>`],
  ['equipo', 'cuenta', 'Trabajar en equipo', 'Invitá personas, asigná roles y compartí plantillas.', `
<ol>
<li>En <strong>Equipo</strong>, creá el equipo con un nombre.</li>
<li>Invitá a cada persona por email y elegí su rol: <em>administrador</em> ve los sobres de todo el equipo; <em>miembro</em> ve los suyos.</li>
<li>La persona acepta desde el enlace de invitación con su propia cuenta.</li>
</ol>`],
  ['dos-pasos', 'cuenta', 'Verificación en dos pasos y sesiones', 'Protegé tu cuenta con un segundo factor.', `
<ol>
<li>En <strong>Ajustes</strong>, buscá <strong>Verificación en dos pasos</strong> y tocá activar.</li>
<li>Escaneá el código QR con una app autenticadora (Google Authenticator, Microsoft Authenticator, 1Password, etc.).</li>
<li>Ingresá el código de 6 dígitos y guardá los códigos de recuperación en un lugar seguro.</li>
</ol>
<p>En <strong>Sesiones abiertas</strong> ves desde dónde está abierta tu cuenta y podés cerrar las demás.</p>`],
  ['marca', 'cuenta', 'Tu marca en emails y firma', 'Logo, color e idioma para tus firmantes.', `
<p>En <strong>Ajustes</strong> subí tu <strong>Logo</strong> (PNG o JPG), elegí el <strong>Color de marca</strong> y el <strong>Idioma para los firmantes</strong>: español, inglés, portugués, francés, alemán o italiano. Se aplican a los emails y a la pantalla de firma.</p>`],
  ['api', 'integrar', 'Empezar con la API', 'Una clave y una llamada para enviar un documento.', `
<ol>
<li>En <strong>API y desarrolladores</strong>, tocá <strong>Crear clave</strong> y copiala: se muestra una sola vez.</li>
<li>Usala en el encabezado <code>Authorization: Bearer ds_live_…</code>.</li>
<li>Seguí la <a href="/desarrolladores">documentación</a> para crear y enviar sobres, o conectá tu asistente de IA para que haga la integración.</li>
</ol>`],
  ['webhooks-embebida', 'integrar', 'Webhooks y firma dentro de tu sitio', 'Avisos automáticos y firma embebida.', `
<ul>
<li><strong>Webhooks</strong>: en <strong>API y desarrolladores</strong>, agregá la URL que recibe los eventos. Cada aviso va firmado con HMAC-SHA256 en el encabezado <code>DocSure-Signature</code>.</li>
<li><strong>Firma embebida</strong>: en <strong>Dominios autorizados</strong>, agregá tu sitio; después creá sobres embebidos por API y mostrá la firma con <code>embed.js</code>.</li>
</ul>`],
];

export const HELP_PATHS = ['/ayuda', ...ARTICLES.map(([slug]) => `/ayuda/${slug}`)];

export function helpIndex(config, user) {
  const body = `<section class="page-hero"><div class="wrap narrow center">
  <h1>Centro de ayuda</h1>
  <p class="lead">Guías paso a paso para enviar, firmar y organizar tus documentos.</p>
  <label class="help-search"><span class="sr-only">Buscar en la ayuda</span><input type="search" id="help-q" placeholder="Buscar: plantillas, código, carpetas…" autocomplete="off"></label>
</div></section>
<section class="section section-tight"><div class="wrap">
${Object.entries(TOPICS).map(([key, name]) => `<div class="help-topic" data-topic="${key}"><h2 class="h3">${name}</h2><div class="solutions-grid">${ARTICLES.filter((a) => a[1] === key).map(([slug, , title, summary]) => `<article class="solution help-item" data-text="${`${title} ${summary}`.toLowerCase()}"><h3><a href="/ayuda/${slug}">${title}</a></h3><p>${summary}</p></article>`).join('')}</div></div>`).join('')}
<p class="center muted" id="help-empty" hidden>No encontramos artículos con esa búsqueda.</p>
</div></section>
<section class="section section-soft"><div class="wrap narrow center">
  <h2 class="section-title">¿No encontraste lo que buscabas?</h2>
  <p class="section-lead">Revisá las <a href="/precios#preguntas">preguntas frecuentes</a>, la <a href="/desarrolladores">documentación de la API</a> o el <a href="/blog">blog</a>.</p>
</div></section>`;
  return page({ config, user, path: '/ayuda', title: 'Centro de ayuda', description: 'Guías paso a paso de DocSure: enviar documentos, firmar, plantillas, carpetas, equipo, seguridad y API.', body, scripts: ['/static/help.js'] });
}

export function helpArticle(config, user, slug) {
  const a = ARTICLES.find((x) => x[0] === slug);
  if (!a) return null;
  const [, topic, title, summary, html] = a;
  const related = ARTICLES.filter((x) => x[1] === topic && x[0] !== slug);
  const body = `<article><section class="page-hero"><div class="wrap narrow"><p class="eyebrow"><a href="/ayuda">Centro de ayuda</a> · ${TOPICS[topic]}</p><h1>${title}</h1><p class="lead">${summary}</p></div></section>
<section class="section section-tight"><div class="wrap narrow prose">${html}
${related.length ? `<h2>Artículos relacionados</h2><ul>${related.map(([s, , t]) => `<li><a href="/ayuda/${s}">${t}</a></li>`).join('')}</ul>` : ''}
<p><a class="btn btn-primary" href="/registro">Probar DocSure gratis</a></p></div></section></article>`;
  return page({
    config, user, path: `/ayuda/${slug}`, title, description: `${summary} Guía paso a paso del centro de ayuda de DocSure.`, body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Centro de ayuda', item: `${config.siteUrl}/ayuda` },
      { '@type': 'ListItem', position: 2, name: title, item: `${config.siteUrl}/ayuda/${slug}` },
    ] }],
  });
}
