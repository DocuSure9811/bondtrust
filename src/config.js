function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

function trimSlash(url) {
  return url.replace(/\/+$/, '');
}

export function loadConfig(env = process.env) {
  const appUrl = trimSlash(env.APP_URL || `http://localhost:${env.PORT || 3000}`);
  return {
    port: Number(env.PORT) || 3000,
    appUrl,
    siteUrl: trimSlash(env.SITE_URL || 'https://docsure.app'),
    canonicalHost: new URL(env.SITE_URL || 'https://docsure.app').host,
    secureCookies: appUrl.startsWith('https://'),
    databaseUrl: required('DATABASE_URL'),
    sessionSecret: required('SESSION_SECRET'),
    tokenSecret: required('TOKEN_HMAC_SECRET'),
    adminToken: required('ADMIN_TOKEN'),
    sealP12: Buffer.from(required('SEAL_P12_BASE64'), 'base64'),
    sealPassword: required('SEAL_P12_PASSWORD'),
    resendApiKey: env.RESEND_API_KEY || '',
    mailFrom: env.MAIL_FROM || 'DocSure <no-reply@docsure.app>',
    assetVersion: (env.RENDER_GIT_COMMIT || 'dev').slice(0, 8),
    allowPrivateWebhooks: env.ALLOW_PRIVATE_WEBHOOKS === '1',
    groqApiKey: env.GROQ_API_KEY || '',
    groqBaseUrl: trimSlash(env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1'),
    groqModel: env.GROQ_MODEL || 'openai/gpt-oss-120b',
  };
}
