# DocSure — reglas del proyecto

**DocSure** (dominio final `docsure.app`; antes "Bond Trust"): plataforma propia de firma electrónica que debe igualar y superar a DocuSign en funcionalidades, web, SEO y planes (más por menos). Producto del usuario, separado de cualquier cliente. Responder en español, directo y simple. Capturas de referencia de DocuSign en `referencias/docusign/` (gitignored). DocuSeal también es AGPL: solo estudiar funcionalidades.

## Secretos y credenciales
- Todas las claves reales viven en [.env](.env) (ignorado por git). Plantilla sin valores: [.env.example](.env.example).
- Cada vez que se genere o reciba una clave nueva (Supabase, Resend, Render, HMAC, certificados, etc.), guardarla en `.env` de inmediato, agrupada por servicio, y agregar su nombre vacío a `.env.example`.
- Nunca commitear `.env`, `*.pem`, `*.p12`, claves ni tokens. Nunca imprimirlos en logs ni en commits.
- El código lee todo desde variables de entorno.

## Cuentas
- GitHub: usuario `DocuSure9811`, repo público `bondtrust` (Render lo despliega por URL; por eso nunca hay secretos en el código). Credenciales en `.env`.

## Forma de trabajo (decidido por el usuario)
- **Nada en local.** No se levanta ni se prueba nada en la máquina del usuario: todo se despliega y se prueba en los servicios reales (Render, Supabase, Resend).
- **Push automático.** Tras cada cambio, commit con mensaje claro y push a GitHub sin pedir confirmación.
- **Deploys verificados.** Servicio Render `bondtrust` (id en `.env`). Tras cada push, confirmar si Render despliega solo; si no, lanzarlo por API (`POST /v1/services/$RENDER_SERVICE_ID/deploys`). Después de cada push, verificar el deploy y no volver al usuario hasta que esté en estado "ready/live" en producción y probado.
- **Al usuario nunca se le pide nada.** Resolver todo con las credenciales en `.env`. Si falta algo imprescindible, buscar la forma de obtenerlo por API; solo avisar si es imposible.
- Etapas probadas por separado: (a) sobre + mail, (b) código + pantalla de firma, (c) PDF con firmas y hoja de registro, (d) sello digital, (e) notificación/estado/entrega, (f) archivo y respaldo.
- Sin código muerto, sin TODOs sueltos, sin funcionalidades no pedidas. Cada etapa terminada, probada y documentada.
- Tests obligatorios: verificación por código, un solo uso de links, idempotencia, integridad del sello.

## Cómo hacer push
El token no se guarda en la config de git. Se lee de [.env](.env) y se pasa por header:
`AUTH=$(printf "x-access-token:%s" "$GITHUB_TOKEN" | base64 -w0); git -c http.extraheader="Authorization: Basic $AUTH" push origin main`
(cargar antes `.env` con `set -a; . ./.env; set +a`). Repo: https://github.com/DocuSure9811/bondtrust

## Stack
Node 22 (ESM) + Express, tests con `node --test`. Render (servidor), Supabase (Postgres), Resend (mails), UptimeRobot (ping).
- **Base:** Supabase Postgres, proyecto `docsure` (us-west-2, misma región que Render), conexión por el pooler en modo sesión (IPv4, puerto 5432). La API de datos de Supabase (PostgREST) está desactivada para `public` y `anon`/`authenticated` no tienen permisos: solo la app accede.
- **Tests:** corren en el build de Render (`npm ci && npm test`) contra un esquema temporal en `TEST_DATABASE_URL` (la misma base de Supabase; cada corrida crea y borra su esquema). Si fallan, el deploy no sale. Ver resultados en los logs de build por API (`GET /v1/logs?type=build`).
- **Emails:** sin `RESEND_API_KEY` quedan en la bandeja `/admin/correos` (Basic auth, contraseña `ADMIN_TOKEN`).
- **API pública v1** (`src/api-v1.js`, Bearer `ds_live_…`): claves en `/app/api`, flujo de dispositivo para agentes de IA (`/api/v1/agent/connect` + `/app/conectar`), webhooks salientes firmados HMAC con protección SSRF. Documentación generada desde `src/web/devdocs.js`: `/desarrolladores`, `/llms.txt`, `/openapi.json` — mantener las tres al día con cada cambio de la API.
- **Tareas programadas** (`runScheduler` en `src/services/envelopes.js`): vencimientos y recordatorios cada 10 min dentro del proceso web. En el plan free de Render el servicio duerme sin tráfico, así que conviene un ping externo (UptimeRobot) para que corran a horario.
- **QA de navegador:** guiones Playwright (Chromium, Firefox, WebKit) en el scratchpad de la sesión; se corren contra producción, no son parte del repo.
- **Estructura:** `src/services/envelopes.js` (lógica), `src/pdf/` (PDF final, sello y verificación), `src/web/` (vistas), `public/` (CSS y JS del navegador; pdf.js servido desde `node_modules`). Sello con certificado X.509 autofirmado; librerías MIT/Apache (pdf-lib, signpdf) verificando licencia y mantenimiento. No copiar código de Documenso/OpenSign (AGPL).

## Seguridad
Links firmados y de un solo uso con vencimiento, validar y sanear toda entrada, no loguear datos personales, verificar HMAC de todo webhook, idempotencia (un sobre = un envío).
