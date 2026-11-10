import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { createMailer } from './mail.js';
import { runRenewalNotices } from './services/contracts.js';
import { runScheduler } from './services/envelopes.js';

const SCHEDULER_MS = 10 * 60_000;

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);
const mailer = createMailer({ pool, resendApiKey: config.resendApiKey, mailFrom: config.mailFrom });

createApp({ pool, config, mailer }).listen(config.port, () => {
  console.log(`DocSure escuchando en el puerto ${config.port} (emails: ${mailer.mode})`);
});

// Vencimientos, recordatorios y avisos de renovación: al arrancar y cada 10 minutos.
const tick = () => runScheduler({ pool, config, mailer })
  .then(async (r) => ({ ...r, renewals: await runRenewalNotices({ pool, config, mailer }) }))
  .then((r) => { if (r.expired || r.reminders || r.renewals) console.log(`Tareas: ${r.expired} vencidos, ${r.reminders} recordatorios, ${r.renewals} avisos de renovación`); })
  .catch((err) => console.error('Tareas programadas:', err.message));
setTimeout(tick, 20_000);
setInterval(tick, SCHEDULER_MS);
