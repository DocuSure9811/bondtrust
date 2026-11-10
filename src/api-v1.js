import express from 'express';
import * as keys from './services/apikeys.js';
import * as attachments from './services/attachments.js';
import * as contacts from './services/contacts.js';
import * as folders from './services/folders.js';
import * as teams from './services/teams.js';
import * as env from './services/envelopes.js';
import * as templatesSvc from './services/templates.js';
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
  router.use(express.json({ limit: '36mb' }));

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
    const list = await env.listEnvelopes(ctx, req.apiUser.id, { scope: req.query.scope === 'team' ? 'team' : 'mine' });
    const str = (v) => (typeof v === 'string' && v ? v : null);
    const status = str(req.query.status);
    const folder = str(req.query.folder_id);
    const q = str(req.query.q)?.toLowerCase();
    const match = (e) => (!status || e.status === status)
      && (!folder || (folder === 'none' ? !e.folder_id : e.folder_id === folder))
      && (!q || e.title.toLowerCase().includes(q) || e.recipients.some((r) => r.name.toLowerCase().includes(q) || r.email.includes(q)));
    res.json({ data: list.filter(match).map(({ signers, signed, ...e }) => ({ ...e, signers_total: signers, signers_signed: signed })) });
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

  router.post('/envelopes/:id/documents', asyncRoute(async (req, res) => {
    await env.appendDocument(ctx, req.apiUser.id, req.params.id, { name: req.body?.name, pdf: env.decodePdf(req.body?.document_base64) });
    res.status(201).json(await env.apiEnvelope(ctx, req.apiUser.id, req.params.id));
  }));

  router.get('/envelopes/:id/attachments/:aid', asyncRoute(async (req, res) => {
    const a = await attachments.ownerAttachment(ctx, req.apiUser.id, req.params.id, req.params.aid);
    res.set({
      'Content-Type': a.content_type,
      'Content-Disposition': `attachment; filename="adjunto"; filename*=UTF-8''${encodeURIComponent(a.name.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 120) || 'adjunto')}`,
      'Cache-Control': 'private, no-store',
    }).send(a.data);
  }));

  router.post('/envelopes/:id/correct', asyncRoute(async (req, res) => {
    const { id } = await env.correctEnvelope(ctx, req.apiUser.id, req.params.id, clientMeta(req));
    res.status(201).json(await env.apiEnvelope(ctx, req.apiUser.id, id));
  }));

  router.post('/envelopes/:id/extend', asyncRoute(async (req, res) => {
    await env.extendExpiration(ctx, req.apiUser.id, req.params.id, req.body?.days, clientMeta(req));
    res.json(await env.apiEnvelope(ctx, req.apiUser.id, req.params.id));
  }));

  router.get('/templates', asyncRoute(async (req, res) => {
    const list = await templatesSvc.listTemplates(ctx, req.apiUser.id);
    res.json({ data: list.map((t) => ({ id: t.id, name: t.name, page_count: t.page_count, roles: t.roles, field_count: t.field_count, language: t.language, created_at: t.created_at })) });
  }));

  router.post('/templates/:id/envelopes', asyncRoute(async (req, res) => {
    const body = { ...(req.body || {}), send: req.body?.send !== false };
    const { id } = await templatesSvc.useTemplate(ctx, req.apiUser, req.params.id, body, clientMeta(req), req.headers['idempotency-key']);
    res.status(201).json(await env.apiEnvelope(ctx, req.apiUser.id, id));
  }));

  router.post('/templates/:id/bulk', asyncRoute(async (req, res) => {
    limit(`bulk:${req.apiUser.id}`, 10, 3600_000);
    res.json(await templatesSvc.bulkSend(ctx, req.apiUser, req.params.id, req.body?.rows, clientMeta(req)));
  }));

  router.get('/team', asyncRoute(async (req, res) => {
    const t = await teams.getTeam(ctx, req.apiUser.id);
    res.json(t.team ? { team: t.team, role: t.role, members: t.members.map(({ id, name, email, role, joined_at: joinedAt }) => ({ id, name, email, role, joined_at: joinedAt })) } : { team: null });
  }));

  router.get('/folders', asyncRoute(async (req, res) => res.json({ data: await folders.listFolders(ctx, req.apiUser.id) })));
  router.post('/folders', asyncRoute(async (req, res) => res.status(201).json(await folders.createFolder(ctx, req.apiUser.id, req.body || {}))));
  router.put('/folders/:id', asyncRoute(async (req, res) => res.json(await folders.renameFolder(ctx, req.apiUser.id, req.params.id, req.body || {}))));
  router.delete('/folders/:id', asyncRoute(async (req, res) => res.json(await folders.deleteFolder(ctx, req.apiUser.id, req.params.id))));
  router.put('/envelopes/:id/folder', asyncRoute(async (req, res) => {
    await folders.moveEnvelope(ctx, req.apiUser.id, req.params.id, req.body?.folder_id ?? null);
    res.json(await env.apiEnvelope(ctx, req.apiUser.id, req.params.id));
  }));

  router.get('/contacts', asyncRoute(async (req, res) => res.json({ data: await contacts.listContacts(ctx, req.apiUser.id, req.query.q) })));
  router.post('/contacts', asyncRoute(async (req, res) => res.status(201).json(await contacts.createContact(ctx, req.apiUser.id, req.body || {}))));
  router.put('/contacts/:id', asyncRoute(async (req, res) => res.json(await contacts.updateContact(ctx, req.apiUser.id, req.params.id, req.body || {}))));
  router.delete('/contacts/:id', asyncRoute(async (req, res) => res.json(await contacts.deleteContact(ctx, req.apiUser.id, req.params.id))));

  router.get('/webhooks', asyncRoute(async (req, res) => res.json({ data: await hooks.listWebhooks(ctx, req.apiUser.id), events: hooks.WEBHOOK_EVENTS })));
  router.post('/webhooks', asyncRoute(async (req, res) => res.status(201).json(await hooks.createWebhook(ctx, req.apiUser.id, req.body || {}))));
  router.delete('/webhooks/:id', asyncRoute(async (req, res) => res.json(await hooks.deleteWebhook(ctx, req.apiUser.id, req.params.id))));

  return router;
}
