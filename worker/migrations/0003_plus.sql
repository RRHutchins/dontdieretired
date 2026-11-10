-- Planner Plus day 14 (RUNBOOK §6t): payments through Stripe. We keep the member's Stripe customer id and, for each
-- subscription, only what decides membership: its status, monthly or yearly, and when the paid period ends.
-- No card details: Stripe's own pages take the payment.
ALTER TABLE users ADD COLUMN stripe_customer TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer ON users (stripe_customer);
CREATE TABLE IF NOT EXISTS memberships (
  subscription TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  plan TEXT,
  period_end INTEGER,
  cancel_at_end INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id);
