PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS games (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'hidden', 'migrating')),
  leaderboard_enabled INTEGER NOT NULL DEFAULT 0 CHECK (leaderboard_enabled IN (0, 1)),
  leaderboard_direction TEXT NOT NULL DEFAULT 'desc' CHECK (leaderboard_direction IN ('asc', 'desc')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS play_totals (
  slug TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE,
  source TEXT NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0 CHECK (play_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (slug, source)
);

CREATE TABLE IF NOT EXISTS guestbook_entries (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
  moderation_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending', 'approved', 'hidden', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS guestbook_entries_slug_created_idx
  ON guestbook_entries(slug, created_at DESC);
CREATE INDEX IF NOT EXISTS guestbook_entries_moderation_idx
  ON guestbook_entries(moderation_status, created_at DESC);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  submission_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE,
  variant TEXT NOT NULL DEFAULT 'default',
  player_name TEXT NOT NULL CHECK (length(player_name) BETWEEN 1 AND 30),
  player_id TEXT,
  score REAL NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  moderation_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending', 'approved', 'hidden', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS leaderboard_entries_ascending_idx
  ON leaderboard_entries(slug, variant, moderation_status, score ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS leaderboard_entries_descending_idx
  ON leaderboard_entries(slug, variant, moderation_status, score DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS rate_limits (
  endpoint TEXT NOT NULL,
  identity_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (endpoint, identity_hash, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits(window_start);

CREATE TABLE IF NOT EXISTS migration_imports (
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source, source_key)
);
