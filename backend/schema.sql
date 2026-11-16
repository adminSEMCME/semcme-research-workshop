CREATE TABLE IF NOT EXISTS rws_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  member_institution TEXT,
  organization TEXT,
  degree TEXT,
  role_title TEXT,
  specialty TEXT,
  constant_contact_contact_id TEXT,
  constant_contact_registration_id TEXT,
  constant_contact_event_id TEXT,
  constant_contact_track_key TEXT,
  registration_status TEXT NOT NULL DEFAULT 'REGISTERED',
  registered_at TIMESTAMP,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (email)
);

ALTER TABLE rws_users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE rws_users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE rws_users ADD COLUMN IF NOT EXISTS member_institution TEXT;
ALTER TABLE rws_users ADD COLUMN IF NOT EXISTS organization TEXT;
ALTER TABLE rws_users ADD COLUMN IF NOT EXISTS degree TEXT;
ALTER TABLE rws_users ADD COLUMN IF NOT EXISTS role_title TEXT;
ALTER TABLE rws_users ADD COLUMN IF NOT EXISTS specialty TEXT;
ALTER TABLE rws_users ADD COLUMN IF NOT EXISTS raw_data JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS rws_magic_links (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES rws_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  requested_ip TEXT,
  requested_user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rws_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES rws_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rws_integration_tokens (
  provider TEXT PRIMARY KEY,
  access_token TEXT,
  refresh_token TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rws_library_sections (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rws_library_items (
  id BIGSERIAL PRIMARY KEY,
  section_id BIGINT NOT NULL REFERENCES rws_library_sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  speaker TEXT,
  resource_date TEXT,
  url TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'resource',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rws_users_email ON rws_users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_rws_magic_links_token_hash ON rws_magic_links (token_hash);
CREATE INDEX IF NOT EXISTS idx_rws_sessions_token_hash ON rws_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_rws_library_sections_order ON rws_library_sections (display_order, name);
CREATE INDEX IF NOT EXISTS idx_rws_library_items_section_order ON rws_library_items (section_id, display_order, title);

CREATE OR REPLACE FUNCTION rws_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rws_integration_tokens_updated_at ON rws_integration_tokens;
CREATE TRIGGER rws_integration_tokens_updated_at
BEFORE UPDATE ON rws_integration_tokens
FOR EACH ROW
EXECUTE FUNCTION rws_touch_updated_at();

DROP TRIGGER IF EXISTS rws_library_sections_updated_at ON rws_library_sections;
CREATE TRIGGER rws_library_sections_updated_at
BEFORE UPDATE ON rws_library_sections
FOR EACH ROW
EXECUTE FUNCTION rws_touch_updated_at();

DROP TRIGGER IF EXISTS rws_library_items_updated_at ON rws_library_items;
CREATE TRIGGER rws_library_items_updated_at
BEFORE UPDATE ON rws_library_items
FOR EACH ROW
EXECUTE FUNCTION rws_touch_updated_at();

-- Small resource attachments live with the resource and are deleted with it.
ALTER TABLE rws_library_items ADD COLUMN IF NOT EXISTS file_data BYTEA;
ALTER TABLE rws_library_items ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE rws_library_items ADD COLUMN IF NOT EXISTS file_type TEXT;

CREATE TABLE IF NOT EXISTS rws_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE rws_users ADD COLUMN IF NOT EXISTS registration_revision TEXT NOT NULL DEFAULT '';

-- Temporary chunks are consumed with the resource save or expire after one day.
CREATE TABLE IF NOT EXISTS rws_resource_uploads (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  total_bytes INTEGER NOT NULL CHECK (total_bytes BETWEEN 1 AND 20971520),
  file_data BYTEA NOT NULL DEFAULT ''::bytea,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
