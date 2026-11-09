-- Planner Plus accounts (RUNBOOK §6t, day 12). Keep personal data to the minimum: an email address per member.
-- Tokens and sessions are stored only as SHA-256 hashes; throttle keys are keyed hashes (no email or IP address).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS signin (
  hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signin_email ON signin (email);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires INTEGER NOT NULL,
  created INTEGER NOT NULL,
  renewed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS throttle (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signin_expires ON signin (expires);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires);
CREATE INDEX IF NOT EXISTS throttle_expires ON throttle (expires);
