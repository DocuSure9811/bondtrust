# DocSure — plan v0.6

Cada etapa: implementación + tests en el build + una prueba puntual en producción (un navegador; los tres solo si el cambio es visual) + deploy verificado.

| # | Etapa | Alcance | Estado |
|---|-------|---------|--------|
| 1 | Identidad visual | Azul corporativo + gris plata en sitio, panel, firma, emails, PDF, favicon e imagen para redes | |
| 2 | Campos nuevos | Opción única (radio), selección múltiple, número, teléfono, imagen del firmante, sello de empresa | |
| 3 | Fórmulas | Campos número calculados a partir de otros (`{precio} * {cantidad}`), sin `eval`, recalculados en el servidor | |
| 4 | Documentos de imagen | Subir JPG/PNG además de PDF (se convierten en página) | |
| 5 | Detectar campos del PDF | Importar los campos de formularios PDF existentes con un clic | |
| 6 | Recordar firma | El firmante puede reutilizar su firma en el mismo dispositivo | |
| 7 | Firma embebida | Sobres "embebidos" por API con enlace de firma directo, iframe en dominios autorizados, eventos `postMessage` y `embed.js` | |
| 8 | Más idiomas | Francés, alemán e italiano en la firma y los emails | |
| 9 | Archivos Word | Subir .docx y convertirlo a PDF en el servidor | |

Ideas tomadas de estudiar DocuSeal (AGPL, solo lectura, sin copiar código): radio, múltiple, imagen, sello, teléfono, fórmulas, imágenes como documento, detección de campos, recordar firma, firma embebida, más idiomas.

Fuera de este plan (necesitan cuentas externas): mails reales (dominio propio), pagos, SMS/WhatsApp, SSO, Supabase, DNS de docsure.app.
