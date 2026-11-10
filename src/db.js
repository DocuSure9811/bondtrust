import pg from 'pg';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  company text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  plan text NOT NULL DEFAULT 'gratis',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'completed', 'declined', 'voided')),
  sequential boolean NOT NULL DEFAULT false,
  original_pdf bytea NOT NULL,
  original_sha256 text NOT NULL,
  page_count int NOT NULL,
  final_pdf bytea,
  final_sha256 text,
  send_idempotency_key text,
  expires_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS envelopes_owner_idx ON envelopes (owner_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS envelopes_final_sha_idx ON envelopes (final_sha256) WHERE final_sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id uuid NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'signer' CHECK (role IN ('signer', 'cc')),
  routing_order int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'sent', 'viewed', 'signed', 'declined')),
  token_hash text UNIQUE,
  token_expires_at timestamptz,
  token_used_at timestamptz,
  otp_hash text,
  otp_expires_at timestamptz,
  otp_sent_at timestamptz,
  otp_attempts int NOT NULL DEFAULT 0,
  verified_at timestamptz,
  sign_session_hash text,
  sign_session_expires_at timestamptz,
  signature_image text,
  initials_image text,
  signed_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  action_ip text,
  action_user_agent text,
  download_token_hash text UNIQUE
);
CREATE INDEX IF NOT EXISTS recipients_envelope_idx ON recipients (envelope_id, position);

CREATE TABLE IF NOT EXISTS fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id uuid NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  type text NOT NULL
    CHECK (type IN ('signature', 'initials', 'date', 'name', 'email', 'text', 'checkbox')),
  page int NOT NULL,
  x real NOT NULL,
  y real NOT NULL,
  w real NOT NULL,
  h real NOT NULL,
  required boolean NOT NULL DEFAULT true,
  label text NOT NULL DEFAULT '',
  value text
);
CREATE INDEX IF NOT EXISTS fields_envelope_idx ON fields (envelope_id);

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  envelope_id uuid NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES recipients(id) ON DELETE SET NULL,
  type text NOT NULL,
  ip text,
  user_agent text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_envelope_idx ON events (envelope_id, id);

ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS create_idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS envelopes_create_idem_idx ON envelopes (owner_id, create_idempotency_key) WHERE create_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_via text NOT NULL DEFAULT 'panel',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id);

CREATE TABLE IF NOT EXISTS device_codes (
  device_code_hash text PRIMARY KEY,
  user_code text NOT NULL UNIQUE,
  client_name text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  approved_at timestamptz,
  denied_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url text NOT NULL,
  events text[] NOT NULL,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhooks_user_idx ON webhooks (user_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id bigserial PRIMARY KEY,
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  event_type text NOT NULL,
  attempt int NOT NULL,
  status_code int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_idx ON webhook_deliveries (webhook_id, id DESC);

-- v0.4: plantillas, recordatorios, vencimiento, código de acceso, firma en persona, marca e idiomas
ALTER TABLE envelopes DROP CONSTRAINT IF EXISTS envelopes_status_check;
ALTER TABLE envelopes ADD CONSTRAINT envelopes_status_check CHECK (status IN ('draft', 'sent', 'completed', 'declined', 'voided', 'expired'));
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'es';
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS expire_days int NOT NULL DEFAULT 30;
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS reminder_days int NOT NULL DEFAULT 0;
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS corrected_from uuid;
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS template_id uuid;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS access_code_hash text;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS reminders_sent int NOT NULL DEFAULT 0;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS in_person_by uuid;
CREATE UNIQUE INDEX IF NOT EXISTS recipients_access_code_idx ON recipients (access_code_hash) WHERE access_code_hash IS NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_color text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_logo bytea;
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_logo_type text;

CREATE TABLE IF NOT EXISTS templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  message text NOT NULL DEFAULT '',
  sequential boolean NOT NULL DEFAULT false,
  language text NOT NULL DEFAULT 'es',
  pdf bytea NOT NULL,
  page_count int NOT NULL,
  roles jsonb NOT NULL,
  fields jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS templates_owner_idx ON templates (owner_id, created_at DESC);

-- v0.5: varios documentos por sobre
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]'::jsonb;

-- v0.5: listas, validaciones y campos condicionales
ALTER TABLE fields ADD COLUMN IF NOT EXISTS options jsonb;
ALTER TABLE fields ADD COLUMN IF NOT EXISTS validation text;
ALTER TABLE fields ADD COLUMN IF NOT EXISTS cond_field_id uuid REFERENCES fields(id) ON DELETE SET NULL;
ALTER TABLE fields ADD COLUMN IF NOT EXISTS cond_value text;

-- v0.5: adjuntos del firmante
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id uuid NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  field_id uuid NOT NULL UNIQUE REFERENCES fields(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  name text NOT NULL,
  content_type text NOT NULL,
  size int NOT NULL,
  sha256 text NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_envelope_idx ON attachments (envelope_id);

-- v0.5: carpetas
CREATE TABLE IF NOT EXISTS folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS envelopes_folder_idx ON envelopes (folder_id) WHERE folder_id IS NOT NULL;

-- v0.5: equipos y roles
CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_invites_team_idx ON team_invites (team_id);

-- v0.5: seguridad de la cuenta
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
CREATE TABLE IF NOT EXISTS recovery_codes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  PRIMARY KEY (user_id, code_hash)
);
CREATE TABLE IF NOT EXISTS account_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_events_user_idx ON account_events (user_id, id DESC);

-- v0.6: campos nuevos y fórmulas
ALTER TABLE fields DROP CONSTRAINT IF EXISTS fields_type_check;
ALTER TABLE fields ADD CONSTRAINT fields_type_check CHECK (type IN ('signature', 'initials', 'date', 'name', 'email', 'text', 'checkbox', 'select', 'attachment', 'radio', 'multiple', 'number', 'phone', 'image', 'stamp'));
ALTER TABLE fields ADD COLUMN IF NOT EXISTS formula text;

-- v0.6: firma embebida
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS delivery text NOT NULL DEFAULT 'email';
ALTER TABLE users ADD COLUMN IF NOT EXISTS embed_origins text[] NOT NULL DEFAULT '{}';

-- v0.6: la marca por defecto pasó de verde a azul; quien guardó el verde por defecto vuelve al nuevo
UPDATE users SET brand_color = NULL WHERE brand_color = '#0e7c66';

-- v0.7: gestión de contratos (vencimiento, aviso de renovación y versiones)
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS contract_end date;
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS renewal_notice_days int NOT NULL DEFAULT 30;
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS renewal_notified_at timestamptz;
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS root_id uuid REFERENCES envelopes(id) ON DELETE SET NULL;
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS envelopes_contract_end_idx ON envelopes (contract_end) WHERE contract_end IS NOT NULL;
CREATE INDEX IF NOT EXISTS envelopes_root_idx ON envelopes (root_id) WHERE root_id IS NOT NULL;

-- v0.7: automatizaciones (cuando pasa algo con un sobre, hacer otra cosa)
CREATE TABLE IF NOT EXISTS automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('completed', 'declined', 'expired')),
  title_contains text NOT NULL DEFAULT '',
  action text NOT NULL CHECK (action IN ('move_folder', 'send_copy', 'notify')),
  folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  email text,
  active boolean NOT NULL DEFAULT true,
  runs int NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automations_owner_idx ON automations (owner_id, trigger) WHERE active;

-- v0.7: enlaces de descarga del PDF final para terceros (copias enviadas por automatizaciones)
CREATE TABLE IF NOT EXISTS document_links (
  id bigserial PRIMARY KEY,
  envelope_id uuid NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- v0.5: contactos
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  uses int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, email)
);

CREATE TABLE IF NOT EXISTS emails (
  id bigserial PRIMARY KEY,
  envelope_id uuid REFERENCES envelopes(id) ON DELETE CASCADE,
  kind text NOT NULL,
  dedupe_key text UNIQUE,
  to_email text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  text_body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  provider_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

function sslFor(url) {
  const host = new URL(url).hostname;
  return host.includes('.render.com') || host.endsWith('.supabase.com') ? { rejectUnauthorized: false } : undefined;
}

export function createPool(url, { schema } = {}) {
  return new pg.Pool({
    connectionString: url,
    ssl: sslFor(url),
    max: 8,
    options: schema ? `-c search_path=${schema}` : undefined,
  });
}

export async function migrate(pool) {
  await pool.query(SCHEMA_SQL);
}

export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
