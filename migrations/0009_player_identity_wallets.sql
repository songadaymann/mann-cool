-- Player identity (email recovery) and anonymous wallet-presence counts.
--
-- A browser holds a private random secret; its public player ID is derived from it
-- (see worker/player-identity.js), so nothing here can be used to post as someone.
-- Emails are never stored readable: only a keyed hash for lookups and a masked hint
-- ("j•••@gmail.com") to show the player where their scores are saved.

CREATE TABLE IF NOT EXISTS player_profiles (
  player_id TEXT PRIMARY KEY,              -- the canonical public player ID for this email
  email_hash TEXT NOT NULL UNIQUE,
  email_hint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Each browser that proved the email, by a hash of its secret.
CREATE TABLE IF NOT EXISTS player_devices (
  secret_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES player_profiles(player_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS player_devices_player_idx ON player_devices(player_id);

CREATE TABLE IF NOT EXISTS player_email_codes (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  secret_hash TEXT NOT NULL,               -- only the browser that asked can use the code
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,             -- unix seconds
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS player_email_codes_lookup_idx
  ON player_email_codes(email_hash, secret_hash, created_at DESC);

-- One report per browser per game per day: does it have a crypto wallet installed?
-- Counts only; no addresses, no player IDs.
CREATE TABLE IF NOT EXISTS wallet_presence_daily (
  slug TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE,
  day TEXT NOT NULL,                        -- YYYY-MM-DD (UTC)
  reports INTEGER NOT NULL DEFAULT 0,
  with_wallet INTEGER NOT NULL DEFAULT 0,
  with_evm INTEGER NOT NULL DEFAULT 0,
  with_solana INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day)
);

CREATE TABLE IF NOT EXISTS wallet_names_daily (
  slug TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE,
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  reports INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day, name)
);
