CREATE TABLE IF NOT EXISTS community_levels (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  level_name TEXT NOT NULL,
  level_json TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('approved', 'pending', 'rejected')),
  created_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_community_levels_slug_created
  ON community_levels(slug, moderation_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_levels_ip_created
  ON community_levels(ip_hash, created_at DESC);
