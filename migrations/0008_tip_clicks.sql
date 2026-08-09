CREATE TABLE IF NOT EXISTS tip_clicks (
  id TEXT PRIMARY KEY,
  source_slug TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tip_clicks_source_created
  ON tip_clicks(source_slug, created_at DESC);
