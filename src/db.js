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
  return new URL(url).hostname.includes('.render.com') ? { rejectUnauthorized: false } : undefined;
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
