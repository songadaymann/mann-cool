-- Wallet sign-in (Sign-In with Ethereum, EIP-4361; 2026-11-09): an address a player proved by signing a one-time
-- message the server wrote (worker/player-identity.js). A wallet-only player still has a player_profiles row, since
-- player_devices points at it: its email_hash is 'wallet:<address>' and its email_hint the short address, until the
-- player adds an email (which then takes over the row). Signing costs nothing and sends no transaction.
CREATE TABLE IF NOT EXISTS player_wallets (
  address TEXT PRIMARY KEY,                -- lowercase 0x address
  player_id TEXT NOT NULL REFERENCES player_profiles(player_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS player_wallets_player_idx ON player_wallets(player_id);

-- The one-time messages: only the browser that asked can use one, once, within ten minutes.
CREATE TABLE IF NOT EXISTS player_wallet_challenges (
  nonce TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  address TEXT NOT NULL,                   -- lowercase 0x address the message names
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL,             -- unix seconds
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
