import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import { sealFingerprint, verifySeal } from './pdf/verify.js';
import { planOf } from './plans.js';
import { createRateLimiter } from './rate-limit.js';
import { hashPassword, hmac, randomToken, safeEqualHex, sha256Hex, verifyPassword } from './security.js';
import * as env from './services/envelopes.js';
import { HttpError, cleanEmail, cleanPassword, cleanText } from './validate.js';
import * as views from './web/app-views.js';
import * as marketing from './web/marketing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_DAYS = 30;
const PRIVATE_PREFIXES = ['/app', '/firmar', '/documento', '/api', '/admin', '/ingresar'];

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientMeta(req) {
  const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '').slice(0, 64);
  return { ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) };
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApp({ pool, config, mailer }) {
  const app = express();
  const ctx = { pool, config, mailer };
  const limit = createRateLimiter();
  const sealFp = sealFingerprint(config.sealP12, config.sealPassword);

  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(compression());

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': req.path.startsWith('/firmar') || req.path.startsWith('/documento') ? 'no-referrer' : 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    if (config.secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const privatePath = PRIVATE_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`));
    if (req.hostname !== config.canonicalHost || privatePath) res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  // Recursos con ?v= se cachean un año; los importados sin versión se revalidan siempre (ETag).
  const cacheByVersion = (req, res, next) => {
    res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
    next();
  };
  const staticOpts = {
    index: false,
    cacheControl: false,
    setHeaders(res, file) {
      if (file.endsWith('.mjs') || file.endsWith('.js')) res.set('Content-Type', 'text/javascript; charset=utf-8');
    },
  };
  app.use('/static', cacheByVersion, express.static(path.join(ROOT, 'public'), staticOpts));
  app.use(
    '/vendor/pdfjs-dist',
    (req, res, next) => {
      res.set('Cache-Control', 'public, max-age=2592000');
      next();
    },
    express.static(path.join(ROOT, 'node_modules', 'pdfjs-dist'), staticOpts),
  );

  // Sesión del remitente
  app.use(
    asyncRoute(async (req, res, next) => {
      req.user = null;
      const sid = parseCookies(req.headers.cookie).ds_session;
      if (sid && sid.length < 200) {
        const { rows } = await pool.query(
          `SELECT u.id, u.name, u.email, u.company, u.plan FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.id_hash = $1 AND s.expires_at > now()`,
          [hmac(config.sessionSecret, sid)],
        );
        req.user = rows[0] || null;
      }
      next();
    }),
  );

  // Protección CSRF: toda mutación de la API exige un encabezado que un formulario de otro sitio no puede enviar.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-docsure'] !== '1') {
      return next(new HttpError(403, 'Solicitud no permitida.', 'csrf'));
    }
    next();
  });

  const json = express.json({ limit: '1.5mb' });
  const pdfBody = express.raw({ type: 'application/pdf', limit: '15mb' });

  const requireUser = (req, res, next) => (req.user ? next() : next(new HttpError(401, 'Iniciá sesión.', 'auth')));
  const requirePageUser = (req, res, next) => {
    if (req.user) return next();
    res.redirect(302, `/ingresar?next=${encodeURIComponent(req.originalUrl)}`);
  };

  async function startSession(res, userId) {
    const sid = randomToken();
    await pool.query(`INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [hmac(config.sessionSecret, sid), userId]);
    res.cookie('ds_session', sid, { httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400_000 });
  }

  // ---------- Salud, SEO ----------
  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'docsure' }));

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /firmar\nDisallow: /documento\nDisallow: /api\nDisallow: /admin\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', (req, res) => {
    const urls = marketing.SITEMAP_PATHS.map((p) => `<url><loc>${config.siteUrl}${p}</loc><changefreq>weekly</changefreq><priority>${p === '/' ? '1.0' : '0.7'}</priority></url>`).join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });

  app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/favicon.svg'));

  // ---------- Sitio público ----------
  const html = (res, body, status = 200) => res.status(status).type('html').set('Cache-Control', 'no-store').send(body);
  app.get('/', (req, res) => html(res, marketing.home(config, req.user)));
  app.get('/producto', (req, res) => html(res, marketing.product(config, req.user)));
  app.get('/precios', (req, res) => html(res, marketing.pricing(config, req.user)));
  app.get('/soluciones', (req, res) => html(res, marketing.solutions(config, req.user)));
  app.get('/seguridad', (req, res) => html(res, marketing.security(config, req.user)));
  app.get('/verificar', (req, res) => html(res, marketing.verifyPage(config, req.user)));
  app.get('/validez-legal', (req, res) => html(res, marketing.legalValidity(config, req.user)));
  app.get('/legal/:slug', (req, res, next) => {
    const out = marketing.legal(config, req.user, req.params.slug);
    return out ? html(res, out) : next();
  });

  const safeNext = (value) => (typeof value === 'string' && /^\/app(\/[\w/-]*)?$/.test(value) ? value : '/app');
  app.get('/ingresar', (req, res) => (req.user ? res.redirect(302, '/app') : html(res, views.authPage(config, 'ingresar', { next: safeNext(req.query.next) }))));
  app.get('/registro', (req, res) => {
    if (req.user) return res.redirect(302, '/app');
    const plan = typeof req.query.plan === 'string' && marketing.PLANS_VIEW.some((p) => p.key === req.query.plan) ? req.query.plan : 'gratis';
    html(res, views.authPage(config, 'registro', { plan }));
  });

  // ---------- App del remitente ----------
  app.get('/app', requirePageUser, (req, res) => html(res, views.dashboardPage(config, req.user)));
  app.get('/app/nuevo', requirePageUser, (req, res) => html(res, views.editorPage(config, req.user)));
  app.get('/app/sobres/:id', requirePageUser, (req, res) => html(res, views.envelopePage(config, req.user)));

  // ---------- Firmante ----------
  app.get('/firmar/:token', (req, res) => html(res, views.signPage(config)));
  app.get(
    '/documento/:token',
    asyncRoute(async (req, res) => {
      const doc = await env.downloadByToken(ctx, req.params.token);
      html(res, views.documentPage(config, { token: req.params.token, title: doc.title, completedAt: doc.completed_at, sha: doc.final_sha256 }));
    }),
  );
  app.get(
    '/documento/:token/pdf',
    asyncRoute(async (req, res) => {
      const doc = await env.downloadByToken(ctx, req.params.token);
      sendPdf(res, doc.final_pdf, `${doc.title} - firmado`);
    }),
  );

  function sendPdf(res, buf, name, inline = false) {
    const safe = name.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 120) || 'documento';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="documento.pdf"; filename*=UTF-8''${encodeURIComponent(safe)}.pdf`,
      'Cache-Control': 'private, no-store',
    });
    res.send(buf);
  }

  // ---------- API: autenticación ----------
  app.post(
    '/api/auth/registro',
    json,
    asyncRoute(async (req, res) => {
      limit(`signup:${clientMeta(req).ip}`, 10, 3600_000);
      const name = cleanText(req.body.name, { max: 120, field: 'tu nombre' });
      const email = cleanEmail(req.body.email);
      const password = cleanPassword(req.body.password);
      const company = cleanText(req.body.company ?? '', { max: 120, field: 'la empresa', required: false });
      const plan = marketing.PLANS_VIEW.some((p) => p.key === req.body.plan) ? req.body.plan : 'gratis';
      const { rows } = await pool.query(
        `INSERT INTO users (email, name, company, password_hash, plan) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [email, name, company, await hashPassword(password), plan],
      );
      if (!rows[0]) throw new HttpError(409, 'Ya existe una cuenta con ese email. Ingresá con tu contraseña.', 'exists');
      await startSession(res, rows[0].id);
      res.status(201).json({ ok: true });
    }),
  );

  app.post(
    '/api/auth/ingresar',
    json,
    asyncRoute(async (req, res) => {
      const email = cleanEmail(req.body.email);
      limit(`login:${clientMeta(req).ip}`, 20, 900_000);
      limit(`login:${email}`, 8, 900_000);
      const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
      const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
      const ok = rows[0] ? await verifyPassword(password, rows[0].password_hash) : await verifyPassword(password, 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
      if (!rows[0] || !ok) throw new HttpError(401, 'Email o contraseña incorrectos.', 'bad_credentials');
      await startSession(res, rows[0].id);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/auth/salir',
    asyncRoute(async (req, res) => {
      const sid = parseCookies(req.headers.cookie).ds_session;
      if (sid) await pool.query('DELETE FROM sessions WHERE id_hash = $1', [hmac(config.sessionSecret, sid)]);
      res.clearCookie('ds_session', { path: '/' });
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/me',
    requireUser,
    asyncRoute(async (req, res) => {
      const used = await env.monthlyUsage(pool, req.user.id);
      res.json({ user: req.user, plan: { key: req.user.plan, ...planOf(req.user.plan) }, usage: { envelopesThisMonth: used } });
    }),
  );

  // ---------- API: sobres ----------
  app.get('/api/sobres', requireUser, asyncRoute(async (req, res) => res.json({ envelopes: await env.listEnvelopes(ctx, req.user.id) })));
  app.post(
    '/api/sobres',
    requireUser,
    pdfBody,
    asyncRoute(async (req, res) => {
      limit(`upload:${req.user.id}`, 60, 3600_000);
      if (!Buffer.isBuffer(req.body)) throw new HttpError(415, 'Subí un archivo PDF.', 'invalid_pdf');
      res.status(201).json(await env.createDraft(ctx, req.user.id, { title: req.query.title, pdf: req.body }));
    }),
  );
  app.get('/api/sobres/:id', requireUser, asyncRoute(async (req, res) => res.json(await env.envelopeDetail(ctx, req.user.id, req.params.id))));
  app.put('/api/sobres/:id', requireUser, json, asyncRoute(async (req, res) => res.json(await env.saveDraft(ctx, req.user.id, req.params.id, req.body))));
  app.delete('/api/sobres/:id', requireUser, asyncRoute(async (req, res) => res.json(await env.deleteDraft(ctx, req.user.id, req.params.id))));
  app.post(
    '/api/sobres/:id/enviar',
    requireUser,
    asyncRoute(async (req, res) => res.json(await env.sendEnvelope(ctx, req.user, req.params.id, req.headers['idempotency-key'], clientMeta(req)))),
  );
  app.post('/api/sobres/:id/anular', requireUser, asyncRoute(async (req, res) => res.json(await env.voidEnvelope(ctx, req.user.id, req.params.id, clientMeta(req)))));
  app.post(
    '/api/sobres/:id/destinatarios/:rid/reenviar',
    requireUser,
    asyncRoute(async (req, res) => res.json(await env.resendInvite(ctx, req.user.id, req.params.id, req.params.rid))),
  );
  for (const which of ['original', 'final']) {
    app.get(
      `/api/sobres/:id/${which}.pdf`,
      requireUser,
      asyncRoute(async (req, res) => {
        const doc = await env.ownerPdf(ctx, req.user.id, req.params.id, which);
        sendPdf(res, doc.pdf, which === 'final' ? `${doc.title} - firmado` : doc.title, req.query.inline === '1');
      }),
    );
  }

  // ---------- API: firma ----------
  const signLimit = (req, scope, max, windowMs) => limit(`${scope}:${clientMeta(req).ip}`, max, windowMs);
  const session = (req) => String(req.headers['x-sign-session'] || '');
  app.get('/api/firmar/:token', asyncRoute(async (req, res) => {
    signLimit(req, 'sign-open', 120, 3600_000);
    res.json(await env.openSigning(ctx, req.params.token, clientMeta(req)));
  }));
  app.post('/api/firmar/:token/codigo', asyncRoute(async (req, res) => {
    signLimit(req, 'otp-send', 10, 3600_000);
    res.json(await env.sendOtp(ctx, req.params.token, clientMeta(req)));
  }));
  app.post('/api/firmar/:token/verificar', json, asyncRoute(async (req, res) => {
    signLimit(req, 'otp-verify', 30, 3600_000);
    res.json(await env.verifyOtp(ctx, req.params.token, req.body.code, clientMeta(req)));
  }));
  app.get('/api/firmar/:token/documento', asyncRoute(async (req, res) => {
    sendPdf(res, await env.signingDocument(ctx, req.params.token, session(req)), 'documento', true);
  }));
  app.get('/api/firmar/:token/campos', asyncRoute(async (req, res) => res.json(await env.signingFields(ctx, req.params.token, session(req)))));
  app.post('/api/firmar/:token/firmar', json, asyncRoute(async (req, res) => {
    res.json(await env.signDocument(ctx, req.params.token, { ...req.body, session: session(req) }, clientMeta(req)));
  }));
  app.post('/api/firmar/:token/rechazar', json, asyncRoute(async (req, res) => {
    res.json(await env.declineDocument(ctx, req.params.token, { ...req.body, session: session(req) }, clientMeta(req)));
  }));

  // ---------- API: verificador público ----------
  app.post(
    '/api/verificar',
    pdfBody,
    asyncRoute(async (req, res) => {
      signLimit(req, 'verify', 60, 3600_000);
      if (!Buffer.isBuffer(req.body) || req.body.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new HttpError(400, 'Subí un archivo PDF.', 'invalid_pdf');
      }
      const seal = verifySeal(req.body, sealFp);
      const record = await env.lookupBySha(ctx, sha256Hex(req.body));
      res.json({ seal, record, sha256: sha256Hex(req.body) });
    }),
  );

  // ---------- Admin (bandeja de salida) ----------
  const requireAdmin = (req, res, next) => {
    const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
    const pass = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : '';
    if (pass && safeEqualHex(sha256Hex(pass), sha256Hex(config.adminToken))) return next();
    limit(`admin:${clientMeta(req).ip}`, 20, 900_000);
    res.set('WWW-Authenticate', 'Basic realm="DocSure admin"').status(401).send('Autenticación requerida');
  };
  app.get('/admin/correos', requireAdmin, asyncRoute(async (req, res) => {
    const { rows } = await pool.query('SELECT id, to_email, kind, status, subject, created_at FROM emails ORDER BY id DESC LIMIT 100');
    html(res, views.adminEmailsPage(config, rows));
  }));
  app.get('/admin/correos/:id', requireAdmin, asyncRoute(async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return next();
    const { rows } = await pool.query('SELECT html FROM emails WHERE id = $1', [id]);
    if (!rows[0]) return next();
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    html(res, rows[0].html);
  }));

  // ---------- 404 y errores ----------
  app.use((req, res, next) => next(new HttpError(404, 'La página que buscás no existe.', 'not_found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err instanceof HttpError ? err.status : err.type === 'entity.too.large' ? 413 : err.status === 400 ? 400 : 500;
    const message = err instanceof HttpError ? err.message : status === 413 ? 'El archivo es demasiado grande (máximo 15 MB).' : status === 400 ? 'Solicitud inválida.' : 'Ocurrió un error inesperado.';
    if (status === 500) console.error('Error no controlado:', err.message);
    if (!Number.isInteger(status)) status = 500;
    if (req.path.startsWith('/api/')) return res.status(status).json({ error: message, code: err.code || 'error' });
    html(res, views.errorPage(config, req.user, status, message), status);
  });

  return app;
}
