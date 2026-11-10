import { page } from './layout.js';

const check = '<span class="ic-check" aria-hidden="true"></span>';

/** Páginas por industria: casos de uso concretos, funciones que resuelven cada uno y preguntas frecuentes. */
export const INDUSTRIES = {
  ventas: {
    name: 'Ventas',
    title: 'Firma electrónica para ventas: cerrá acuerdos hoy',
    description: 'Enviá propuestas y contratos para firmar desde el celular, con recordatorios automáticos, plantillas y aviso al CRM por webhook. Plan gratis.',
    lead: 'La propuesta y el contrato llegan juntos, tu cliente firma desde el celular y vos cerrás el acuerdo el mismo día.',
    uses: ['Propuestas comerciales y cotizaciones', 'Contratos de servicios y suscripciones', 'Órdenes de pedido con aprobación del cliente', 'Acuerdos de confidencialidad antes de una demo'],
    features: [
      ['Varios documentos en un solo envío', 'Propuesta, contrato y anexo de precios en un mismo sobre, con una sola firma del cliente.', '/producto#documentos'],
      ['Recordatorios automáticos', 'Si el cliente no firma, DocSure le recuerda cada 1, 2, 3, 5 o 7 días, con un enlace nuevo.', '/producto#recordatorios'],
      ['Plantillas del equipo', 'Todo el equipo comercial usa el mismo contrato aprobado, con los campos ya ubicados.', '/producto#equipos'],
      ['Webhooks para tu CRM', 'Tu CRM se entera al instante cuando el cliente abre o firma, sin cargar nada a mano.', '/desarrolladores#webhooks'],
    ],
    faq: [
      ['¿El cliente necesita crear una cuenta para firmar?', 'No. Recibe un enlace por email, confirma su identidad con un código y firma desde cualquier navegador, también en el celular.'],
      ['¿Puedo saber si el cliente abrió la propuesta?', 'Sí. En el panel ves cuándo abrió el enlace, cuándo verificó su identidad y cuándo firmó, y podés recibir cada evento por webhook.'],
      ['¿Puedo pedir datos al cliente al firmar?', 'Sí: agregá campos de texto con formato (CUIT, email, teléfono), listas desplegables o casillas. Con campos condicionales, solo aparece lo que corresponde según sus respuestas.'],
    ],
  },
  'recursos-humanos': {
    name: 'Recursos Humanos',
    title: 'Firma electrónica para RR. HH.: contratos y altas sin papel',
    description: 'Contratos laborales, confidencialidad y políticas firmados a distancia, con adjuntos del empleado (DNI, CBU), plantillas y auditoría completa.',
    lead: 'Contratos, confidencialidad y políticas internas firmados a distancia, con registro de quién aceptó qué y cuándo.',
    uses: ['Contratos laborales y de pasantía', 'Acuerdos de confidencialidad', 'Aceptación de políticas y reglamentos internos', 'Legajo de ingreso con documentación del empleado'],
    features: [
      ['Adjuntos del empleado', 'El nuevo ingreso sube la foto del DNI, la constancia de CUIL o el comprobante de CBU al firmar. Todo queda en el PDF final.', '/producto#campos'],
      ['Envío masivo', 'Mandá la nueva política a toda la empresa desde un CSV: un sobre por persona, con el resultado de cada envío.', '/producto#plantillas'],
      ['Campos con validación', 'CUIL, teléfono o email con formato controlado, para que los datos lleguen bien la primera vez.', '/producto#campos'],
      ['Carpetas y búsqueda', 'Organizá los sobres por área o por año y encontrá cualquier documento por el nombre del empleado.', '/producto#organizacion'],
    ],
    faq: [
      ['¿Es válido firmar un contrato laboral con firma electrónica?', 'En Argentina la Ley 25.506 reconoce la firma electrónica y, para la mayoría de los documentos laborales, alcanza con buena evidencia de quién firmó. Algunos actos pueden exigir firma digital u ológrafa: consultá a tu asesor legal.'],
      ['¿Puedo pedirle al empleado que adjunte su DNI?', 'Sí. Agregá un campo de adjunto: el empleado sube una foto o un PDF desde el celular y queda anexado al documento final sellado.'],
      ['¿Cómo envío una política a toda la empresa?', 'Guardá el documento como plantilla y usá el envío masivo con un CSV de nombre y email. Cada persona recibe su propio sobre.'],
    ],
  },
  legal: {
    name: 'Legal',
    title: 'Firma electrónica para estudios jurídicos y áreas legales',
    description: 'Trazabilidad completa, sello X.509, certificado de finalización y verificador público para cada acuerdo. Evidencia lista para presentar.',
    lead: 'Trazabilidad completa, sello criptográfico y certificado de finalización para cada acuerdo: evidencia lista para presentar.',
    uses: ['Contratos comerciales y acuerdos entre partes', 'Convenios de honorarios con clientes', 'Poderes y autorizaciones internas', 'Acuerdos de confidencialidad y cesión'],
    features: [
      ['Sello digital X.509', 'El PDF final queda sellado con PKCS#7 y SHA-256. Si cambia un byte, el sello deja de ser válido.', '/producto#sello'],
      ['Certificado de finalización', 'Quién firmó, cómo verificó su identidad, IP, navegador y hora de cada paso, dentro del mismo PDF.', '/producto#sello'],
      ['Firma en orden', 'Primero la contraparte, después el socio que aprueba: cada uno recibe el enlace cuando firmó el anterior.', '/producto#preparacion'],
      ['Verificador público', 'Cualquiera puede comprobar en docsure.app/verificar que el documento no fue alterado.', '/verificar'],
    ],
    faq: [
      ['¿Qué evidencia incluye cada documento?', 'Huella SHA-256 del original y del final, verificación del firmante por código, registro de auditoría con IP y navegador, y un sello digital X.509 que detecta cualquier modificación.'],
      ['¿Qué tipo de firma ofrece DocSure?', 'Firma electrónica simple (eIDAS, ESIGN/UETA y Ley 25.506). Para actos que exigen firma digital o cualificada, consultá la página Tipos de firma.'],
      ['¿Puedo proteger mi cuenta con un segundo factor?', 'Sí. Activá la verificación en dos pasos con cualquier app autenticadora y revisá tus sesiones abiertas y la actividad de la cuenta desde Ajustes.'],
    ],
  },
  compras: {
    name: 'Compras',
    title: 'Firma electrónica para compras y proveedores',
    description: 'Órdenes de compra y contratos con proveedores firmados en orden, con plantillas compartidas, adjuntos y exportación a CSV para tu control.',
    lead: 'Órdenes de compra y contratos con proveedores firmados en orden: primero el proveedor, después quien aprueba.',
    uses: ['Órdenes de compra', 'Contratos marco con proveedores', 'Altas de proveedores con documentación', 'Actas de recepción y conformidad'],
    features: [
      ['Firma en orden', 'El proveedor firma primero y recién después le llega a quien aprueba.', '/producto#preparacion'],
      ['Adjuntos del proveedor', 'Constancia de inscripción, seguros o certificados subidos por el proveedor al firmar.', '/producto#campos'],
      ['Exportación CSV', 'Exportá los sobres filtrados por fecha, carpeta o estado para tu control o auditoría.', '/producto#organizacion'],
      ['Equipos con roles', 'Los administradores ven los sobres de todo el equipo de compras.', '/producto#equipos'],
    ],
    faq: [
      ['¿Puedo hacer que firme primero el proveedor?', 'Sí. Activá "Firmar en orden" y definí el orden de cada firmante.'],
      ['¿Puedo pedir documentación al proveedor?', 'Sí, con campos de adjunto: PNG, JPG o PDF de hasta 5 MB que quedan anexados al documento final.'],
      ['¿Cómo controlo todo lo firmado en el mes?', 'Filtrá por fechas en el panel y exportá a CSV, con estado, carpeta, firmas y destinatarios de cada sobre.'],
    ],
  },
  inmobiliarias: {
    name: 'Inmobiliarias',
    title: 'Firma electrónica para inmobiliarias: alquileres y reservas',
    description: 'Reservas, contratos de alquiler y autorizaciones firmados por propietarios, inquilinos y garantes a distancia, con adjuntos y recordatorios.',
    lead: 'Reservas, boletos y contratos de alquiler firmados por propietarios, inquilinos y garantes sin coordinar encuentros.',
    uses: ['Contratos de alquiler', 'Reservas y señas', 'Autorizaciones de venta y de alquiler', 'Inventarios y actas de entrega'],
    features: [
      ['Varios firmantes y en orden', 'Inquilino, garantes y propietario en el mismo sobre, en paralelo o uno detrás de otro.', '/producto#preparacion'],
      ['Adjuntos de garantes', 'Recibos de sueldo, DNI o escrituras subidos por cada garante al firmar.', '/producto#campos'],
      ['Campos condicionales', 'Si el inquilino marca "Tengo mascota", aparece la cláusula para completar; si no, no.', '/producto#campos'],
      ['Contactos guardados', 'Propietarios y garantes frecuentes se completan solos al escribir el nombre.', '/producto#organizacion'],
    ],
    faq: [
      ['¿Pueden firmar inquilino, garantes y propietario en el mismo documento?', 'Sí. Agregá a todos como firmantes del sobre; cada uno firma sus campos desde su celular.'],
      ['¿Puedo enviar contrato e inventario juntos?', 'Sí. Subí varios PDF y se unen en un solo sobre, con una única firma por persona.'],
      ['¿Qué pasa si alguien no firma?', 'DocSure envía recordatorios automáticos y podés extender el vencimiento o corregir el sobre sin consumir tu cupo.'],
    ],
  },
  'servicios-financieros': {
    name: 'Servicios financieros',
    title: 'Firma electrónica para servicios financieros y seguros',
    description: 'Altas de clientes, mandatos y declaraciones con identidad verificada, datos validados, adjuntos y documentación inalterable con sello digital.',
    lead: 'Altas de clientes, mandatos y declaraciones con identidad verificada y documentación inalterable.',
    uses: ['Apertura de cuentas y altas de clientes', 'Mandatos y autorizaciones de débito', 'Declaraciones juradas y perfiles de inversor', 'Solicitudes de seguros'],
    features: [
      ['Verificación del firmante', 'Código de un solo uso por email antes de ver el documento, con límite de intentos.', '/seguridad'],
      ['Datos validados', 'Campos con formato de documento, email, teléfono o número para evitar errores de carga.', '/producto#campos'],
      ['Adjuntos con huella', 'Cada archivo del cliente queda anexado y su huella SHA-256 figura en el certificado.', '/producto#campos'],
      ['Seguridad de la cuenta', 'Verificación en dos pasos, sesiones abiertas y registro de actividad para tu equipo.', '/seguridad'],
    ],
    faq: [
      ['¿Cómo se verifica la identidad del cliente?', 'Antes de ver el documento confirma un código de 6 dígitos enviado a su email. También podés hacer firmar en persona en tu dispositivo, atestiguado por tu sesión.'],
      ['¿El documento puede alterarse después de firmado?', 'No sin que se note: el sello digital X.509 deja de ser válido ante cualquier cambio y el verificador público lo detecta.'],
      ['¿Puedo integrar DocSure con mi sistema?', 'Sí, con la API REST y webhooks firmados con HMAC, incluidos en todos los planes.'],
    ],
  },
  salud: {
    name: 'Salud',
    title: 'Firma electrónica para salud: consentimientos informados',
    description: 'Consentimientos informados y autorizaciones firmados antes de la consulta, desde el celular, con copia automática al paciente y auditoría completa.',
    lead: 'Consentimientos informados firmados antes de la consulta, con copia automática para el paciente.',
    uses: ['Consentimientos informados', 'Autorizaciones de tratamiento y de cirugía', 'Fichas de ingreso de pacientes', 'Acuerdos con prestadores'],
    features: [
      ['Firma desde el celular', 'El paciente firma en la sala de espera o desde su casa, sin instalar nada.', '/producto#firma'],
      ['Firma en persona', 'En el consultorio, el paciente firma en tu tablet con la identidad atestiguada por tu sesión.', '/producto#seguridad-firmante'],
      ['Campos condicionales', 'Las preguntas de seguimiento aparecen solo si el paciente responde que sí.', '/producto#campos'],
      ['Copia automática', 'Al completarse, el paciente recibe el PDF final con el certificado de finalización.', '/producto#sello'],
    ],
    faq: [
      ['¿El paciente puede firmar en el consultorio?', 'Sí. Con la firma en persona, abrís la firma en tu dispositivo y el paciente firma ahí mismo; el certificado registra que fue atestiguada por vos.'],
      ['¿El paciente recibe una copia?', 'Sí. Cuando firman todos, cada firmante recibe un enlace para descargar el PDF final sellado.'],
      ['¿Puedo pedir que el paciente adjunte estudios?', 'Sí, con un campo de adjunto: imágenes o PDF de hasta 5 MB que quedan anexados al documento.'],
    ],
  },
  educacion: {
    name: 'Educación',
    title: 'Firma electrónica para educación: inscripciones y permisos',
    description: 'Inscripciones, autorizaciones de salidas y acuerdos con docentes firmados por las familias desde el celular, con envío masivo y recordatorios.',
    lead: 'Inscripciones, autorizaciones de salidas y acuerdos con docentes firmados por las familias desde el celular.',
    uses: ['Inscripciones y reinscripciones', 'Autorizaciones de salidas y viajes', 'Reglamentos y acuerdos de convivencia', 'Contratos con docentes'],
    features: [
      ['Envío masivo', 'Mandá la autorización de la salida a todas las familias desde un CSV.', '/producto#plantillas'],
      ['Recordatorios', 'Las familias que no firmaron reciben recordatorios automáticos hasta la fecha límite.', '/producto#recordatorios'],
      ['Listas y condiciones', '"¿Autoriza la salida?" con Sí o No; si elige No, aparece el campo para indicar el motivo.', '/producto#campos'],
      ['Español, inglés y portugués', 'Cada familia firma en su idioma.', '/producto#seguridad-firmante'],
    ],
    faq: [
      ['¿Pueden firmar las familias desde el celular?', 'Sí. Reciben un email, confirman un código y firman en minutos, sin crear una cuenta.'],
      ['¿Puedo enviar una autorización a todo el curso?', 'Sí, con el envío masivo desde una plantilla de un firmante: hasta 200 sobres por vez.'],
      ['¿Cómo sé quién falta firmar?', 'En el panel filtrás los sobres en curso y buscás por nombre; también podés exportar el listado a CSV.'],
    ],
  },
};

export const INDUSTRY_PATHS = Object.keys(INDUSTRIES).map((s) => `/soluciones/${s}`);

export function industryPage(config, user, slug) {
  const ind = INDUSTRIES[slug];
  if (!ind) return null;
  const others = Object.entries(INDUSTRIES).filter(([s]) => s !== slug);
  const body = `<section class="page-hero"><div class="wrap narrow center">
  <p class="eyebrow"><a href="/soluciones">Soluciones</a> · ${ind.name}</p>
  <h1>${ind.title.split(':')[0]}</h1>
  <p class="lead">${ind.lead}</p>
  <a class="btn btn-primary btn-lg" href="/registro">Empezar gratis</a>
</div></section>
<section class="section section-tight"><div class="wrap split">
  <div><h2>Qué documentos firman los equipos de ${ind.name.toLowerCase()}</h2><p class="lead-sm">Estos son los casos más comunes. Cualquier PDF se puede enviar a firmar en un minuto.</p></div>
  <ul class="checklist checklist-lg">${ind.uses.map((u) => `<li>${check}${u}</li>`).join('')}</ul>
</div></section>
<section class="section section-soft"><div class="wrap">
  <h2 class="section-title">Cómo te ayuda DocSure</h2>
  <div class="feature-grid">${ind.features.map(([t, d, href]) => `<article class="feature"><span class="ic ic-shield" aria-hidden="true"></span><h3>${t}</h3><p>${d}</p><p><a class="link-strong" href="${href}">Ver más →</a></p></article>`).join('')}</div>
</div></section>
<section class="section"><div class="wrap narrow">
  <h2 class="section-title">Preguntas frecuentes</h2>
  <div class="faq">${ind.faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
  <p class="center muted small">Otras soluciones: ${others.map(([s, o]) => `<a href="/soluciones/${s}">${o.name}</a>`).join(' · ')}</p>
</div></section>
<section class="cta-band"><div class="wrap cta-row">
  <div><h2>Probalo con tu próximo documento.</h2><p>5 sobres gratis por mes, sin tarjeta.</p></div>
  <a class="btn btn-light btn-lg" href="/registro">Crear cuenta gratis</a>
</div></section>`;
  return page({
    config, user, path: `/soluciones/${slug}`, title: ind.title, description: ind.description, body,
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: ind.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Soluciones', item: `${config.siteUrl}/soluciones` },
        { '@type': 'ListItem', position: 2, name: ind.name, item: `${config.siteUrl}/soluciones/${slug}` },
      ] },
    ],
  });
}
