import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { createMailer } from './mail.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);
const mailer = createMailer({ pool, resendApiKey: config.resendApiKey, mailFrom: config.mailFrom });

createApp({ pool, config, mailer }).listen(config.port, () => {
  console.log(`DocSure escuchando en el puerto ${config.port} (emails: ${mailer.mode})`);
});
