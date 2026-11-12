-- Planner Plus day 20 (security review): keep Stripe test mode and live mode apart. Everything made while the Worker runs
-- on a test key (memberships, gifts, the account's Stripe customer) is marked 'test' and is ignored once the key is live,
-- so a test-card "payment" can never become a real membership or a working gift code after Robin switches to live.
-- Everything before this migration was made in test mode (no live key has ever been used).
ALTER TABLE memberships ADD COLUMN mode TEXT NOT NULL DEFAULT 'test';
ALTER TABLE gifts ADD COLUMN mode TEXT NOT NULL DEFAULT 'test';
ALTER TABLE users ADD COLUMN stripe_mode TEXT;
UPDATE users SET stripe_mode = 'test' WHERE stripe_customer IS NOT NULL;
