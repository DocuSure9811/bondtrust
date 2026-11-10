# DocSure — plan v0.5 (sin servicios externos nuevos)

Cada etapa: implementación + tests en el build + QA en producción (Chromium, Firefox, WebKit) + commit/push + deploy verificado.

| # | Etapa | Alcance | Estado |
|---|-------|---------|--------|
| 1 | Imagen para redes | `og.png` 1200×630, `og:image`, `twitter:card` grande | Hecho |
| 2 | Contactos | Libreta automática con cada destinatario enviado; autocompletar en el editor; gestión en `/app/contactos` | Hecho |
| 3 | Varios documentos por sobre | Subir varios PDF; se unen en un solo documento antes de colocar campos | Hecho |
| 4 | Campos nuevos | Casilla, lista desplegable, validación (email, número, DNI/ID), obligatorio u opcional | Hecho |
| 5 | Campos condicionales | Un campo solo aparece/obliga si otro campo tiene cierto valor | Hecho |
| 6 | Adjuntos del firmante | Campo "adjunto": el firmante sube imagen/PDF; se anexa al PDF final y queda en el registro | Hecho |
| 7 | Carpetas, búsqueda y exportación | Carpetas por usuario, búsqueda por título/firmante/fecha, exportar CSV | Hecho |
| 8 | Equipos y roles | Organización con miembros (admin/miembro), invitación por link, plantillas compartidas, admin ve todos los sobres | Hecho |
| 9 | Seguridad de la cuenta | Verificación en dos pasos (TOTP), sesiones activas con cierre remoto, registro de actividad, cambio de contraseña | Hecho |
| 10 | SEO | Páginas por industria y más artículos del blog | Hecho |

Fuera de este plan (necesitan cuentas externas): mails reales (dominio propio), pagos, SMS/WhatsApp, Supabase, DNS de docsure.app.
