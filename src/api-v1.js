import express from 'express';
import * as keys from './services/apikeys.js';
import * as env from './services/envelopes.js';
import * as hooks from './services/webhooks.js';
import { HttpError } from './validate.js';

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * API REST pública. Autenticación: `Authorization: Bearer ds_live_...`.
 * No usa cookies, así que no aplica la protección CSRF del panel.
 */
export function createApiV1({ ctx, limit, clientMeta, sendPdf }) {
  const router = express.Router();
  const docs = `${ctx.config.appUrl}/desarrolladores`;
  router.use(express.json({ limit: '22mb' }));

  router.get('/', (req, res) => {
    res.json({
      name: 'DocSure API',
      version: 'v1',
      docs,
      llms_txt: `${ctx.config.appUrl}/llms.txt`,
      openapi: `${ctx.config.appUrl}/openapi.json`,
      authentication: 'Authorization: Bearer <API_KEY>. Creá la clave en /app/api o con el flujo POST /api/v1/agent/connect.',
    });
  });

  // ----- Conexión de agentes de IA (sin autenticación previa) -----
  router.post('/agent/connect', asyncRoute(async (req, res) => {
    limit(`agent-connect:${clientMeta(req).ip}`, 20, 3600_000);
    res.status(201).json(await keys.startDeviceFlow(ctx, req.body?.client_name));
  }));
  router.post('/agent/token', asyncRoute(async (req, res) => {
    limit(`agent-token:${clientMeta(req).ip}`, 400, 3600_000);
    res.json(await keys.pollDevice(ctx, req.body?.device_code));
  }));

  // ----- Autenticación por clave -----
  router.use(asyncRoute(async (req, res, next) => {
    const [scheme, token] = String(req.headers.authorization || '').split(' ');
    const user = scheme === 'Bearer' ? await keys.authenticateApiKey(ctx, token) : null;
    if (!user) throw new HttpError(401, `Falta una clave de API válida en "Authorization: Bearer ds_live_...". Ver ${docs}`, 'unauthorized');
    limit(`api:${user.key_id}`, 300, 60_000);
    req.apiUser = user;
    next();
  }));

  router.get('/me', asyncRoute(async (req, res) => {
    const { id, name, email, company, plan } = req.apiUser;
    res.json({ id, name, email, company, plan, envelopes_sent_this_month: await env.monthlyUsage(ctx.pool, id) });
  }));

  router.get('/envelopes', asyncRoute(async (req, res) => {
    const list = await env.listEnvelopes(ctx, req.apiUser.id);
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    res.json({ data: list.filter((e) => !status || e.status === status).map((e) => ({ ...e, signers_total: e.signers, signers_signed: e.signed, signers: undefined, signed: undefined })) });
  }));

  router.post('/envelopes', asyncRoute(async (req, res) => {
    const out = await env.createFromApi(ctx, req.apiUser, req.body || {}, req.headers['idempotency-key'], clientMeta(req));
    res.status(out.replay ? 200 : 201).json(out.envelope);
  }));

  router.get('/envelopes/:id', asyncRoute(async (req, res) => res.json(await env.apiEnvelope(ctx, req.apiUser.id, req.params.id))));

  router.delete('/envelopes/:id', asyncRoute(async (req, res) => res.json(await env.deleteDraft(ctx, req.apiUser.id, req.params.id))));

  router.post('/envelopes/:id/send', asyncRoute(async (req, res) => {
    const key = req.headers['idempotency-key'] || `api-send:${req.params.id}`;
    await env.sendEnvelope(ctx, req.apiUser, req.params.id, key, clientMeta(req));
    res.json(await env.apiEnvelope(ctx, req.apiUser.id, req.params.id));
  }));

  router.post('/envelopes/:id/void', asyncRoute(async (req, res) => {
    await env.voidEnvelope(ctx, req.apiUser.id, req.params.id, clientMeta(req));
    res.json(await env.apiEnvelope(ctx, req.apiUser.id, req.params.id));
  }));

  router.post('/envelopes/:id/recipients/:rid/resend', asyncRoute(async (req, res) => {
    res.json(await env.resendInvite(ctx, req.apiUser.id, req.params.id, req.params.rid));
  }));

  router.get('/envelopes/:id/document', asyncRoute(async (req, res) => {
    const version = req.query.version === 'original' ? 'original' : 'final';
    const doc = await env.ownerPdf(ctx, req.apiUser.id, req.params.id, version);
    sendPdf(res, doc.pdf, version === 'final' ? `${doc.title} - firmado` : doc.title);
  }));

  router.get('/webhooks', asyncRoute(async (req, res) => res.json({ data: await hooks.listWebhooks(ctx, req.apiUser.id), events: hooks.WEBHOOK_EVENTS })));
  router.post('/webhooks', asyncRoute(async (req, res) => res.status(201).json(await hooks.createWebhook(ctx, req.apiUser.id, req.body || {}))));
  router.delete('/webhooks/:id', asyncRoute(async (req, res) => res.json(await hooks.deleteWebhook(ctx, req.apiUser.id, req.params.id))));

  return router;
}
