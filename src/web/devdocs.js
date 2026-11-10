import { escapeHtml } from '../validate.js';
import { WEBHOOK_EVENTS } from '../services/webhooks.js';
import { page } from './layout.js';

const FIELD_TYPES = [
  ['signature', 'Firma (dibujada o escrita por el firmante)'],
  ['initials', 'Iniciales'],
  ['date', 'Fecha de firma (se completa sola)'],
  ['name', 'Nombre del firmante (se completa solo)'],
  ['email', 'Email del firmante (se completa solo)'],
  ['text', 'Texto que escribe el firmante; con "validation" exige un formato: email, number, id (documento) o phone'],
  ['checkbox', 'Casilla de verificación'],
  ['select', 'Lista desplegable; requiere "options": ["A", "B", …] (hasta 30)'],
  ['attachment', 'Archivo que sube el firmante (foto del documento, comprobante): PNG, JPG o PDF de hasta 5 MB; se anexa al PDF final'],
];

const ERRORS = [
  ['400 validation', 'Datos inválidos. El campo "error" explica qué corregir.'],
  ['401 unauthorized', 'Falta la clave o no es válida.'],
  ['402 quota', 'Se alcanzó el límite de sobres del plan este mes.'],
  ['404 not_found', 'El sobre no existe o no es de esta cuenta.'],
  ['409 already_sent / not_draft / not_sent', 'La acción no corresponde al estado actual del sobre.'],
  ['413', 'El PDF supera 15 MB.'],
  ['428 authorization_pending', 'Flujo de agente: el usuario todavía no autorizó. Reintentá.'],
  ['429 rate_limited', 'Demasiadas solicitudes. Esperá y reintentá.'],
];

function examples(api) {
  return {
    connect: `curl -X POST ${api}/agent/connect \\
  -H "Content-Type: application/json" \\
  -d '{"client_name": "Claude Code"}'

# Respuesta
{
  "device_code": "…",
  "user_code": "BCDF-2345",
  "verification_url": "${api.replace('/api/v1', '')}/app/conectar?codigo=BCDF-2345",
  "expires_in": 900,
  "interval": 3
}`,
    token: `curl -X POST ${api}/agent/token \\
  -H "Content-Type: application/json" \\
  -d '{"device_code": "…"}'

# Mientras el usuario no autoriza: 428 {"code": "authorization_pending"}
# Cuando autoriza (se entrega una sola vez):
{ "api_key": "ds_live_…", "key_id": "…", "name": "Claude Code" }`,
    send: `curl -X POST ${api}/envelopes \\
  -H "Authorization: Bearer $DOCSURE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: contrato-cliente-123" \\
  -d '{
    "title": "Contrato de servicios",
    "message": "Hola Ana, te envío el contrato para firmar.",
    "document_base64": "'"$(base64 -w0 contrato.pdf)"'",
    "recipients": [
      { "name": "Ana Pérez", "email": "ana@cliente.com" },
      { "name": "Legales", "email": "legales@miempresa.com", "role": "cc" }
    ]
  }'`,
    node: `// Node 18+ (sin dependencias)
import fs from 'node:fs';

const res = await fetch('${api}/envelopes', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.DOCSURE_API_KEY}\`,
    'Content-Type': 'application/json',
    'Idempotency-Key': 'contrato-cliente-123',
  },
  body: JSON.stringify({
    title: 'Contrato de servicios',
    document_base64: fs.readFileSync('contrato.pdf').toString('base64'),
    recipients: [{ name: 'Ana Pérez', email: 'ana@cliente.com' }],
    fields: [
      { recipient: 0, type: 'signature', page: 1, x: 0.1, y: 0.8, width: 0.3, height: 0.06 },
      { recipient: 0, type: 'date', page: 1, x: 0.6, y: 0.82, width: 0.2, height: 0.03 },
    ],
  }),
});
const envelope = await res.json();
console.log(envelope.id, envelope.status); // "…", "sent"`,
    python: `# Python 3 (requests)
import base64, os, requests

with open("contrato.pdf", "rb") as f:
    pdf = base64.b64encode(f.read()).decode()

r = requests.post(
    "${api}/envelopes",
    headers={"Authorization": f"Bearer {os.environ['DOCSURE_API_KEY']}",
             "Idempotency-Key": "contrato-cliente-123"},
    json={"title": "Contrato de servicios", "document_base64": pdf,
          "recipients": [{"name": "Ana Pérez", "email": "ana@cliente.com"}]},
)
print(r.json()["id"], r.json()["status"])`,
    status: `curl ${api}/envelopes/ENVELOPE_ID \\
  -H "Authorization: Bearer $DOCSURE_API_KEY"

# Descargar el PDF firmado y sellado (cuando status = "completed")
curl -o firmado.pdf "${api}/envelopes/ENVELOPE_ID/document?version=final" \\
  -H "Authorization: Bearer $DOCSURE_API_KEY"`,
    webhook: `curl -X POST ${api}/webhooks \\
  -H "Authorization: Bearer $DOCSURE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://tu-app.com/webhooks/docsure", "events": ["envelope.completed", "recipient.signed"]}'

# Respuesta: guardá "secret" (whsec_…) como DOCSURE_WEBHOOK_SECRET`,
    verify: `// Express: verificar la firma de un webhook de DocSure
import crypto from 'node:crypto';
import express from 'express';

const app = express();
app.post('/webhooks/docsure', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('DocSure-Signature') || '';            // "t=1731200000,v1=abc…"
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = crypto.createHmac('sha256', process.env.DOCSURE_WEBHOOK_SECRET)
    .update(\`\${t}.\${req.body}\`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;   // 5 minutos
  const valid = v1 && v1.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
  if (!fresh || !valid) return res.status(400).send('firma inválida');

  const event = JSON.parse(req.body);
  if (event.type === 'envelope.completed') {
    // descargá el PDF firmado con GET /envelopes/{id}/document?version=final
  }
  res.sendStatus(200);
});`,
    payload: `{
  "id": "evt_…",
  "type": "envelope.completed",
  "created_at": "2026-11-10T12:00:00.000Z",
  "data": {
    "envelope": {
      "id": "…", "title": "Contrato de servicios", "status": "completed",
      "sent_at": "…", "completed_at": "…",
      "recipients": [{ "id": "…", "name": "Ana Pérez", "email": "ana@cliente.com",
                       "role": "signer", "routing_order": 1, "status": "signed", "signed_at": "…" }]
    },
    "final_sha256": "…"
  }
}`,
  };
}

const ENDPOINTS = [
  ['POST', '/agent/connect', 'Inicia la conexión de un asistente de IA (sin clave).'],
  ['POST', '/agent/token', 'El asistente consulta hasta recibir su clave (sin clave).'],
  ['GET', '/me', 'Cuenta, plan y sobres enviados este mes.'],
  ['POST', '/envelopes', 'Crea un sobre con el PDF, los destinatarios y los campos, y lo envía.'],
  ['GET', '/envelopes', 'Lista los sobres con sus destinatarios. Filtros opcionales: ?status=draft|sent|completed|declined|voided|expired, ?folder_id=<id>|none, ?q= (busca en título, nombre y email) y ?scope=team (administradores de equipo: sobres de todos los miembros, con owner_name).'],
  ['GET', '/team', 'Equipo de la cuenta, tu rol y sus miembros (o team: null si trabajás solo).'],
  ['GET', '/envelopes/{id}', 'Estado del sobre, de cada destinatario y su historial.'],
  ['POST', '/envelopes/{id}/documents', 'Agrega un PDF al final de un borrador: {"name", "document_base64"}.'],
  ['POST', '/envelopes/{id}/send', 'Envía un borrador (creado con "send": false).'],
  ['POST', '/envelopes/{id}/void', 'Anula un sobre en curso. Los anulados no consumen cupo.'],
  ['POST', '/envelopes/{id}/correct', 'Corrige: anula el sobre (si está en curso) y crea un borrador idéntico para editar y reenviar.'],
  ['POST', '/envelopes/{id}/extend', 'Extiende el vencimiento: {"days": 1-120} desde hoy.'],
  ['POST', '/envelopes/{id}/recipients/{recipient_id}/resend', 'Reenvía la invitación (el enlace anterior deja de funcionar).'],
  ['GET', '/envelopes/{id}/document?version=original|final', 'Descarga el PDF original o el final firmado y sellado.'],
  ['GET', '/envelopes/{id}/attachments/{attachment_id}', 'Descarga un archivo que adjuntó un firmante (la lista viene en "attachments" del sobre).'],
  ['DELETE', '/envelopes/{id}', 'Borra un borrador.'],
  ['GET', '/templates', 'Lista las plantillas con sus roles.'],
  ['POST', '/templates/{id}/envelopes', 'Crea y envía un sobre desde una plantilla: {"recipients": [...] en el orden de los roles}.'],
  ['POST', '/templates/{id}/bulk', 'Envío masivo (plantillas de un firmante): {"rows": [{"name","email"}]} hasta 200.'],
  ['GET', '/folders', 'Lista las carpetas con la cantidad de sobres de cada una.'],
  ['POST', '/folders', 'Crea una carpeta: {"name"}.'],
  ['PUT', '/folders/{id}', 'Renombra una carpeta: {"name"}.'],
  ['DELETE', '/folders/{id}', 'Borra la carpeta; sus sobres quedan sin carpeta.'],
  ['PUT', '/envelopes/{id}/folder', 'Mueve un sobre: {"folder_id": "<id>"} o null para sacarlo de la carpeta.'],
  ['GET', '/contacts?q=', 'Libreta de contactos (se completa sola con cada envío). Búsqueda opcional por nombre o email.'],
  ['POST', '/contacts', 'Agrega un contacto: {"name","email"}. Si el email ya existe, actualiza el nombre.'],
  ['PUT', '/contacts/{id}', 'Edita nombre y email de un contacto.'],
  ['DELETE', '/contacts/{id}', 'Elimina un contacto.'],
  ['GET', '/webhooks', 'Lista los webhooks.'],
  ['POST', '/webhooks', 'Crea un webhook. Devuelve su secreto de firma una sola vez.'],
  ['DELETE', '/webhooks/{id}', 'Elimina un webhook.'],
];

export function llmsTxt(config) {
  const api = `${config.appUrl}/api/v1`;
  const ex = examples(api);
  return `# DocSure

> DocSure es una plataforma de firma electrónica (alternativa a DocuSign) con API REST: enviás un PDF, cada firmante recibe un email, confirma su identidad con un código y firma desde cualquier dispositivo. El PDF final queda sellado con un certificado X.509 y un certificado de finalización con auditoría.

API base: ${api}
Documentación: ${config.appUrl}/desarrolladores
OpenAPI: ${config.appUrl}/openapi.json
Panel del usuario: ${config.appUrl}/app

## Instrucciones para asistentes de IA (Claude, Cursor, Copilot, etc.)

Si tu usuario quiere integrar DocSure, hacé todo vos. El usuario solo tiene que tocar "Autorizar" una vez:

1. Pedí una conexión: POST ${api}/agent/connect con {"client_name": "<tu nombre, ej. Claude Code>"}.
2. Mostrale al usuario el "verification_url" y el "user_code". Pedile que abra el enlace, inicie sesión (o cree su cuenta gratis ahí mismo) y toque "Autorizar".
3. Cada "interval" segundos llamá POST ${api}/agent/token con {"device_code": "..."}.
   - 428 "authorization_pending": seguí esperando.
   - 200: recibís {"api_key": "ds_live_..."}. Se entrega una sola vez.
   - 403 "access_denied" o 400 "expired_token": volvé al paso 1.
4. Guardá la clave como variable de entorno DOCSURE_API_KEY (por ejemplo en .env). Nunca la escribas en el código ni la subas al repositorio.
5. Implementá el envío con POST /envelopes y, si la app necesita enterarse de las firmas, registrá un webhook con POST /webhooks y verificá su firma HMAC.

Alternativa manual: el usuario crea la clave en ${config.appUrl}/app/api y te la pasa.

## Autenticación

Todas las llamadas (salvo /agent/*) llevan: Authorization: Bearer ds_live_...
Usá el encabezado Idempotency-Key en POST /envelopes: si repetís la misma clave no se crea ni se envía un segundo sobre.

## Enviar un documento a firmar (una sola llamada)

POST ${api}/envelopes
Cuerpo JSON:
- title (string, obligatorio, máx. 160)
- document_base64 (string): el PDF en base64, máx. 15 MB, sin contraseña.
- documents (array, alternativa a document_base64): [{ "name", "document_base64" }] hasta 10 PDF que se unen en un solo sobre, en ese orden (máx. 25 MB y 200 páginas en total). Las páginas se numeran de corrido: si el primero tiene 3 páginas, la página 1 del segundo es la 4.
- recipients (array, obligatorio): [{ "name", "email", "role": "signer" | "cc" (por defecto signer), "order": 1.. (solo si sequential) }]
- fields (array, opcional): [{ "recipient": índice (desde 0) o email, "type", "page" (desde 1), "x", "y", "width", "height" (fracciones 0..1 de la página, origen arriba a la izquierda), "required" (bool), "label", "options" (listas), "validation" (textos), "key" y "show_if" }]
  Campos condicionales: dale un "key" al campo que controla (casilla, lista o texto) y en el campo dependiente poné "show_if": {"field": "<key>", "equals": "<valor>"}. Con casillas el valor es "true" o "false". Ambos campos tienen que ser del mismo firmante; la firma no puede ser condicional. Si la condición no se cumple, el campo no se muestra ni se exige.
  Si no mandás fields, DocSure ubica firma y fecha de cada firmante al pie de la última página (hasta 6 firmantes).
- message (string, opcional): mensaje para los firmantes.
- sequential (bool, opcional): true = firman en orden según "order".
- send (bool, opcional, por defecto true): false deja el sobre como borrador.
- language (opcional): "es" | "en" | "pt". Idioma de los emails y de la pantalla de firma.
- expire_days (opcional, 1-120, por defecto 30): días hasta que vence el sobre.
- reminder_days (opcional, 0 | 1 | 2 | 3 | 5 | 7, por defecto 0): cada cuántos días recordar a quien no firmó (máx. 5 recordatorios).

Tipos de campo: ${FIELD_TYPES.map(([t, d]) => `${t} (${d})`).join('; ')}.
Cada firmante necesita al menos un campo "signature".

Respuesta 201: el sobre con id, status ("sent"), recipients y links. 200 si es una repetición idempotente.

\`\`\`bash
${ex.send}
\`\`\`

\`\`\`js
${ex.node}
\`\`\`

## Estados

Sobre: draft → sent → completed | declined | voided.
Destinatario: created → sent → viewed → signed | declined.

\`\`\`bash
${ex.status}
\`\`\`

## Plantillas y envío masivo

Las plantillas se crean desde el panel ("Guardar como plantilla" en cualquier sobre). Por API:
- GET /templates devuelve cada plantilla con "roles" (en orden).
- POST /templates/{id}/envelopes con {"recipients": [{"name","email"}, ...]} (uno por rol, en el mismo orden). Opcionales: title, message, language, expire_days, reminder_days, send (por defecto true).
- POST /templates/{id}/bulk con {"rows": [{"name","email"}, ...]} para plantillas de un solo firmante. Devuelve el resultado por fila y se detiene si se agota el cupo del plan.

## Corregir y extender

- POST /envelopes/{id}/correct: anula el sobre en curso (no consume cupo) y devuelve un borrador idéntico; editalo con el panel o envialo con POST /envelopes/{id}/send.
- POST /envelopes/{id}/extend con {"days": 15}: nuevo vencimiento contado desde hoy.

## Seguridad para los firmantes

Cada invitación incluye un enlace personal y un código de acceso de 12 caracteres: el firmante puede entrar en ${config.appUrl}/acceder y escribirlo sin tocar enlaces del email. Antes de ver el documento, siempre confirma su identidad con un código enviado a su email.

## Webhooks

Eventos: ${WEBHOOK_EVENTS.join(', ')}.
Se envían por POST (JSON) con los encabezados DocSure-Event, DocSure-Event-Id y DocSure-Signature: "t=<unix>,v1=<hex>",
donde v1 = HMAC-SHA256(secret, "<t>.<cuerpo crudo>"). Rechazá firmas inválidas o con más de 5 minutos. Respondé 2xx; si no, reintentamos 3 veces. Usá DocSure-Event-Id para no procesar dos veces el mismo evento.
La URL debe ser https pública.

\`\`\`bash
${ex.webhook}
\`\`\`

\`\`\`js
${ex.verify}
\`\`\`

Ejemplo de evento:
\`\`\`json
${ex.payload}
\`\`\`

## Errores

Formato: {"error": "mensaje en español", "code": "codigo"}.
${ERRORS.map(([c, d]) => `- ${c}: ${d}`).join('\n')}

## Límites

300 solicitudes por minuto por clave. PDF de hasta 15 MB y 200 páginas. Los sobres por mes dependen del plan (Gratis: 5).

## Endpoints

${ENDPOINTS.map(([m, p, d]) => `- ${m} ${p}: ${d}`).join('\n')}
`;
}

export function openapiSpec(config) {
  const err = { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  const auth = [{ bearer: [] }];
  const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
  const envResp = { description: 'Sobre', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } };
  return {
    openapi: '3.1.0',
    info: {
      title: 'DocSure API',
      version: '1.0.0',
      description: `API de firma electrónica de DocSure. Guía completa: ${config.appUrl}/desarrolladores. Instrucciones para asistentes de IA: ${config.appUrl}/llms.txt`,
    },
    servers: [{ url: `${config.appUrl}/api/v1` }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Clave de API ds_live_…' } },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' }, code: { type: 'string' } } },
        Recipient: {
          type: 'object', required: ['name', 'email'],
          properties: { name: { type: 'string', maxLength: 120 }, email: { type: 'string', format: 'email' }, role: { type: 'string', enum: ['signer', 'cc'], default: 'signer' }, order: { type: 'integer', minimum: 1, maximum: 50 } },
        },
        Field: {
          type: 'object', required: ['recipient', 'type', 'page', 'x', 'y', 'width', 'height'],
          properties: {
            recipient: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'string', format: 'email' }], description: 'Índice en recipients (desde 0) o email.' },
            type: { type: 'string', enum: FIELD_TYPES.map(([t]) => t) },
            page: { type: 'integer', minimum: 1 },
            x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 },
            width: { type: 'number', minimum: 0.01, maximum: 1 }, height: { type: 'number', minimum: 0.005, maximum: 1 },
            required: { type: 'boolean' }, label: { type: 'string', maxLength: 60 },
            options: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 30, description: 'Opciones de una lista (type select).' },
            validation: { type: 'string', enum: ['email', 'number', 'id', 'phone'], description: 'Formato exigido a un campo de texto.' },
            key: { type: 'string', maxLength: 60, description: 'Referencia del campo para usarla en show_if.' },
            show_if: { type: 'object', properties: { field: { type: 'string' }, equals: { type: 'string' } }, description: 'El campo se muestra solo si el campo "field" (del mismo firmante) vale "equals".' },
          },
        },
        CreateEnvelope: {
          type: 'object', required: ['title', 'recipients'],
          properties: {
            title: { type: 'string', maxLength: 160 },
            message: { type: 'string', maxLength: 1000 },
            document_base64: { type: 'string', description: 'PDF en base64 (máx. 15 MB). Obligatorio salvo que uses documents.' },
            documents: { type: 'array', maxItems: 10, items: { type: 'object', required: ['document_base64'], properties: { name: { type: 'string' }, document_base64: { type: 'string' } } }, description: 'Varios PDF unidos en orden en un solo sobre (máx. 25 MB y 200 páginas en total).' },
            recipients: { type: 'array', items: { $ref: '#/components/schemas/Recipient' }, minItems: 1, maxItems: 50 },
            fields: { type: 'array', items: { $ref: '#/components/schemas/Field' }, description: 'Opcional. Sin fields se ubican firma y fecha al pie de la última página.' },
            sequential: { type: 'boolean', default: false },
            send: { type: 'boolean', default: true },
            language: { type: 'string', enum: ['es', 'en', 'pt'], default: 'es' },
            expire_days: { type: 'integer', minimum: 1, maximum: 120, default: 30 },
            reminder_days: { type: 'integer', enum: [0, 1, 2, 3, 5, 7], default: 0 },
          },
        },
        Envelope: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, message: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'sent', 'completed', 'declined', 'voided'] },
            sequential: { type: 'boolean' }, page_count: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' }, sent_at: { type: ['string', 'null'], format: 'date-time' },
            completed_at: { type: ['string', 'null'], format: 'date-time' }, expires_at: { type: ['string', 'null'], format: 'date-time' },
            original_sha256: { type: 'string' }, final_sha256: { type: ['string', 'null'] },
            recipients: { type: 'array', items: { type: 'object' } },
            events: { type: 'array', items: { type: 'object' } },
            links: { type: 'object' },
          },
        },
        Contact: { type: 'object', required: ['name', 'email'], properties: { name: { type: 'string', maxLength: 120 }, email: { type: 'string', format: 'email' } } },
        Webhook: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' }, events: { type: 'array', items: { type: 'string', enum: WEBHOOK_EVENTS } } } },
      },
    },
    paths: {
      '/agent/connect': { post: { summary: 'Iniciar la conexión de un asistente de IA', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { client_name: { type: 'string' } } } } } }, responses: { 201: { description: 'device_code, user_code, verification_url, expires_in, interval' }, 429: err } } },
      '/agent/token': { post: { summary: 'Obtener la clave una vez autorizada', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['device_code'], properties: { device_code: { type: 'string' } } } } } }, responses: { 200: { description: 'api_key' }, 428: err, 403: err, 400: err } } },
      '/me': { get: { summary: 'Cuenta actual', security: auth, responses: { 200: { description: 'Cuenta' }, 401: err } } },
      '/envelopes': {
        get: { summary: 'Listar sobres', security: auth, parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'folder_id', in: 'query', schema: { type: 'string' }, description: 'Id de carpeta o none' }, { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'scope', in: 'query', schema: { type: 'string', enum: ['mine', 'team'] }, description: 'team: sobres de todo el equipo (solo administradores)' }], responses: { 200: { description: 'Lista' }, 401: err } },
        post: { summary: 'Crear y enviar un sobre', security: auth, parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateEnvelope' } } } }, responses: { 201: envResp, 200: envResp, 400: err, 401: err, 402: err } },
      },
      '/envelopes/{id}': {
        get: { summary: 'Ver un sobre', security: auth, parameters: [idParam], responses: { 200: envResp, 404: err } },
        delete: { summary: 'Borrar un borrador', security: auth, parameters: [idParam], responses: { 200: { description: 'ok' }, 409: err } },
      },
      '/envelopes/{id}/documents': { post: { summary: 'Agregar un PDF a un borrador', security: auth, parameters: [idParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['document_base64'], properties: { name: { type: 'string' }, document_base64: { type: 'string' } } } } } }, responses: { 201: envResp, 400: err, 409: err, 413: err } } },
      '/envelopes/{id}/send': { post: { summary: 'Enviar un borrador', security: auth, parameters: [idParam], responses: { 200: envResp, 400: err, 402: err, 409: err } } },
      '/envelopes/{id}/void': { post: { summary: 'Anular un sobre en curso', security: auth, parameters: [idParam], responses: { 200: envResp, 409: err } } },
      '/envelopes/{id}/recipients/{recipient_id}/resend': { post: { summary: 'Reenviar invitación', security: auth, parameters: [idParam, { name: 'recipient_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'ok' }, 409: err, 429: err } } },
      '/envelopes/{id}/document': { get: { summary: 'Descargar PDF', security: auth, parameters: [idParam, { name: 'version', in: 'query', schema: { type: 'string', enum: ['original', 'final'], default: 'final' } }], responses: { 200: { description: 'PDF', content: { 'application/pdf': {} } }, 404: err } } },
      '/envelopes/{id}/attachments/{attachment_id}': { get: { summary: 'Descargar un adjunto del firmante', security: auth, parameters: [idParam, { name: 'attachment_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Archivo', content: { 'image/png': {}, 'image/jpeg': {}, 'application/pdf': {} } }, 404: err } } },
      '/envelopes/{id}/correct': { post: { summary: 'Corregir: anula y crea un borrador idéntico', security: auth, parameters: [idParam], responses: { 201: envResp, 409: err } } },
      '/envelopes/{id}/extend': { post: { summary: 'Extender vencimiento', security: auth, parameters: [idParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['days'], properties: { days: { type: 'integer', minimum: 1, maximum: 120 } } } } } }, responses: { 200: envResp, 409: err } } },
      '/templates': { get: { summary: 'Listar plantillas', security: auth, responses: { 200: { description: 'Lista con roles' } } } },
      '/templates/{id}/envelopes': { post: { summary: 'Crear y enviar desde una plantilla', security: auth, parameters: [idParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['recipients'], properties: { recipients: { type: 'array', items: { $ref: '#/components/schemas/Recipient' } }, title: { type: 'string' }, message: { type: 'string' }, language: { type: 'string', enum: ['es', 'en', 'pt'] }, expire_days: { type: 'integer' }, reminder_days: { type: 'integer' }, send: { type: 'boolean', default: true } } } } } }, responses: { 201: envResp, 400: err, 402: err } } },
      '/templates/{id}/bulk': { post: { summary: 'Envío masivo desde una plantilla de un firmante', security: auth, parameters: [idParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['rows'], properties: { rows: { type: 'array', maxItems: 200, items: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' } } } } } } } } }, responses: { 200: { description: 'Resultado por fila' }, 400: err } } },
      '/team': { get: { summary: 'Equipo, rol y miembros', security: auth, responses: { 200: { description: 'Equipo o team: null' } } } },
      '/folders': {
        get: { summary: 'Listar carpetas', security: auth, responses: { 200: { description: 'Lista' } } },
        post: { summary: 'Crear carpeta', security: auth, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 60 } } } } } }, responses: { 201: { description: 'Carpeta' }, 409: err } },
      },
      '/folders/{id}': {
        put: { summary: 'Renombrar carpeta', security: auth, parameters: [idParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 60 } } } } } }, responses: { 200: { description: 'Carpeta' }, 404: err, 409: err } },
        delete: { summary: 'Borrar carpeta (los sobres quedan sin carpeta)', security: auth, parameters: [idParam], responses: { 200: { description: 'ok' }, 404: err } },
      },
      '/envelopes/{id}/folder': { put: { summary: 'Mover un sobre a una carpeta', security: auth, parameters: [idParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { folder_id: { type: ['string', 'null'], format: 'uuid' } } } } } }, responses: { 200: envResp, 404: err } } },
      '/contacts': {
        get: { summary: 'Listar contactos', security: auth, parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Lista' } } },
        post: { summary: 'Agregar contacto', security: auth, requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Contact' } } } }, responses: { 201: { description: 'Contacto' }, 400: err } },
      },
      '/contacts/{id}': {
        put: { summary: 'Editar contacto', security: auth, parameters: [idParam], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Contact' } } } }, responses: { 200: { description: 'Contacto' }, 404: err, 409: err } },
        delete: { summary: 'Eliminar contacto', security: auth, parameters: [idParam], responses: { 200: { description: 'ok' }, 404: err } },
      },
      '/webhooks': {
        get: { summary: 'Listar webhooks', security: auth, responses: { 200: { description: 'Lista' } } },
        post: { summary: 'Crear webhook (devuelve el secreto una vez)', security: auth, requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Webhook' } } } }, responses: { 201: { description: 'Webhook con secret' }, 400: err } },
      },
      '/webhooks/{id}': { delete: { summary: 'Eliminar webhook', security: auth, parameters: [idParam], responses: { 200: { description: 'ok' }, 404: err } } },
    },
  };
}

function code(text) {
  return `<pre class="code">${escapeHtml(text)}</pre>`;
}

export function developersPage(config, user) {
  const api = `${config.appUrl}/api/v1`;
  const ex = examples(api);
  const prompt = `Integrá DocSure en este proyecto para enviar documentos a firmar. Seguí las instrucciones de ${config.appUrl}/llms.txt y conectate con el flujo de agente para obtener la clave.`;
  const body = `
<section class="page-hero"><div class="wrap narrow center">
  <h1>API de firma electrónica</h1>
  <p class="lead">Enviá documentos a firmar desde tu sistema con una sola llamada. O pedíselo a tu asistente de IA: se conecta solo y hace la integración por vos.</p>
  <div class="hero-cta" style="justify-content:center"><a class="btn btn-primary btn-lg" href="/app/api">Crear clave de API</a><a class="btn btn-ghost btn-lg" href="#ia">Integrar con IA</a></div>
</div></section>
<section class="section section-tight"><div class="wrap docs">
  <nav class="docs-nav" aria-label="Secciones de la documentación"><ul>
    <li><a href="#ia">Integrar con tu IA</a></li><li><a href="#autenticacion">Autenticación</a></li>
    <li><a href="#enviar">Enviar a firmar</a></li><li><a href="#campos">Campos</a></li>
    <li><a href="#estado">Estado y descarga</a></li><li><a href="#webhooks">Webhooks</a></li>
    <li><a href="#errores">Errores y límites</a></li><li><a href="#referencia">Referencia</a></li>
  </ul></nav>
  <div class="docs-body">
    <section id="ia">
      <h2>Integrar con tu asistente de IA</h2>
      <p>Si usás Claude, Cursor, Copilot u otro asistente en tu editor, pegale esta instrucción. El asistente lee nuestra guía, te pasa un enlace, vos tocás <strong>Autorizar</strong> y él recibe la clave y hace toda la integración.</p>
      ${code(prompt)}
      <div class="callout">El asistente nunca necesita que copies la clave: la obtiene con el flujo de conexión y la guarda como variable de entorno <code>DOCSURE_API_KEY</code>.</div>
      <h3>Cómo funciona la conexión</h3>
      <p>1. El asistente pide un código:</p>${code(ex.connect)}
      <p>2. Abrís <code>verification_url</code>, iniciás sesión (o creás tu cuenta gratis) y tocás <strong>Autorizar</strong>.</p>
      <p>3. El asistente consulta cada pocos segundos hasta recibir la clave:</p>${code(ex.token)}
      <p>Instrucciones completas para asistentes: <a href="/llms.txt">/llms.txt</a>. Especificación: <a href="/openapi.json">/openapi.json</a> (OpenAPI 3.1).</p>
    </section>
    <section id="autenticacion">
      <h2>Autenticación</h2>
      <p>Creá una clave en <a href="/app/api">Panel → API</a> y enviala en cada solicitud:</p>
      ${code('Authorization: Bearer ds_live_…')}
      <p>La clave se muestra una sola vez y se guarda cifrada (HMAC). Revocala cuando quieras desde el panel. Base de la API: <code>${escapeHtml(api)}</code>.</p>
    </section>
    <section id="enviar">
      <h2>Enviar un documento a firmar</h2>
      <p class="endpoint"><span class="method m-post">POST</span>/envelopes</p>
      <p>Una sola llamada sube el PDF, carga los destinatarios, ubica los campos y envía los emails. Usá <code>Idempotency-Key</code>: si repetís la llamada con la misma clave no se envía un segundo sobre.</p>
      <table class="params"><thead><tr><th>Campo</th><th>Descripción</th></tr></thead><tbody>
        <tr><td>title</td><td>Obligatorio. Nombre del documento (máx. 160).</td></tr>
        <tr><td>document_base64</td><td>PDF en base64, hasta 15 MB y 200 páginas, sin contraseña. Obligatorio salvo que uses <code>documents</code>.</td></tr>
        <tr><td>documents</td><td>Alternativa para varios PDF en un solo sobre: <code>[{"name", "document_base64"}]</code>, hasta 10 (25 MB y 200 páginas en total). Las páginas se numeran de corrido.</td></tr>
        <tr><td>recipients</td><td>Obligatorio. <code>[{ name, email, role: "signer" | "cc", order }]</code>. "cc" recibe copia del documento final.</td></tr>
        <tr><td>fields</td><td>Opcional. Ver <a href="#campos">Campos</a>. Sin fields, ubicamos firma y fecha al pie de la última página.</td></tr>
        <tr><td>message</td><td>Opcional. Mensaje para los firmantes.</td></tr>
        <tr><td>sequential</td><td>Opcional. <code>true</code> para firmar en orden según <code>order</code>.</td></tr>
        <tr><td>send</td><td>Opcional, por defecto <code>true</code>. <code>false</code> deja un borrador.</td></tr>
        <tr><td>language</td><td>Opcional. <code>es</code>, <code>en</code> o <code>pt</code>: idioma de los emails y de la firma.</td></tr>
        <tr><td>expire_days</td><td>Opcional, de 1 a 120 (por defecto 30).</td></tr>
        <tr><td>reminder_days</td><td>Opcional: 0, 1, 2, 3, 5 o 7 días entre recordatorios (por defecto 0).</td></tr>
      </tbody></table>
      <h3>cURL</h3>${code(ex.send)}
      <h3>Node.js</h3>${code(ex.node)}
      <h3>Python</h3>${code(ex.python)}
    </section>
    <section id="campos">
      <h2>Campos</h2>
      <p>La posición se indica en fracciones de la página (de 0 a 1), con origen arriba a la izquierda. Así funciona igual en cualquier tamaño de hoja. <code>recipient</code> es el índice del destinatario (desde 0) o su email. Cada firmante necesita al menos un campo <code>signature</code>.</p>
      <table class="params"><thead><tr><th>type</th><th>Qué hace</th></tr></thead><tbody>${FIELD_TYPES.map(([t, d]) => `<tr><td>${t}</td><td>${d}</td></tr>`).join('')}</tbody></table>
    </section>
    <section id="estado">
      <h2>Estado y descarga</h2>
      <p>Sobre: <code>draft → sent → completed | declined | voided</code>. Destinatario: <code>created → sent → viewed → signed | declined</code>.</p>
      ${code(ex.status)}
      <p>El PDF final incluye las firmas, el certificado de finalización con la auditoría y el sello digital X.509. Cualquiera puede comprobarlo en <a href="/verificar">/verificar</a>.</p>
    </section>
    <section id="webhooks">
      <h2>Webhooks</h2>
      <p>Eventos: ${WEBHOOK_EVENTS.map((e) => `<code>${e}</code>`).join(', ')}. Cada aviso llega por POST con el encabezado <code>DocSure-Signature: t=…,v1=…</code>, donde <code>v1 = HMAC-SHA256(secret, "t.cuerpo")</code>. Respondé 2xx; si no, reintentamos 3 veces. La URL debe ser https pública.</p>
      ${code(ex.webhook)}
      <h3>Verificar la firma</h3>${code(ex.verify)}
      <h3>Ejemplo de evento</h3>${code(ex.payload)}
    </section>
    <section id="errores">
      <h2>Errores y límites</h2>
      <p>Formato: <code>{"error": "mensaje", "code": "codigo"}</code>.</p>
      <table class="params"><tbody>${ERRORS.map(([c, d]) => `<tr><td>${escapeHtml(c)}</td><td>${d}</td></tr>`).join('')}</tbody></table>
      <p>Límite: 300 solicitudes por minuto por clave. Los sobres por mes dependen de tu <a href="/precios">plan</a>.</p>
    </section>
    <section id="referencia">
      <h2>Referencia de endpoints</h2>
      ${ENDPOINTS.map(([m, p, d]) => `<p class="endpoint"><span class="method m-${m.toLowerCase()}">${m}</span>${escapeHtml(p)}</p><p class="muted">${d}</p>`).join('')}
    </section>
  </div>
</div></section>`;
  return page({
    config, user, path: '/desarrolladores',
    title: 'API de firma electrónica para desarrolladores',
    description: 'API REST de DocSure: enviá documentos a firmar con una llamada, recibí webhooks firmados y conectá tu asistente de IA sin copiar claves.',
    body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'TechArticle', headline: 'API de firma electrónica de DocSure', url: `${config.appUrl}/desarrolladores`, inLanguage: 'es' }],
  });
}
