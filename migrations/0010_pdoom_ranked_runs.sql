CREATE TABLE IF NOT EXISTS pdoom_ranked_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  nonce_hash TEXT NOT NULL,
  level_id TEXT NOT NULL,
  level_version TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completion_hash TEXT,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS pdoom_ranked_runs_expiry_idx
  ON pdoom_ranked_runs(expires_at) WHERE completed_at IS NULL;
