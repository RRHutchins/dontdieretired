-- Planner Plus day 16 (RUNBOOK §6t): gifts. A £20 one-off payment makes one gift: twelve months of Plus, no renewal.
-- The code is kept as a SHA-256 hash (to redeem it) and, so the buyer can see and print it again, encrypted with the
-- Worker secret GIFT_KEY (AES-GCM). Accounts are referred to only by our opaque account id; no names, no messages
-- (the card's "to" and "from" lines are typed in the buyer's browser and never sent to us).
CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  code_box TEXT,                 -- the code, encrypted; cleared once it is used or refunded, or the buyer's account is deleted
  checkout TEXT NOT NULL UNIQUE, -- the Stripe Checkout session that paid for it: one gift per payment, however often Stripe tells us
  payment_intent TEXT,
  buyer_id TEXT,                 -- our account id of the buyer; NULL once that account is deleted
  status TEXT NOT NULL,          -- paid (ready to use) | redeemed | refunded | disputed (a chargeback)
  created INTEGER NOT NULL,
  redeemed_by TEXT,              -- our account id of whoever used it; NULL once that account is deleted
  redeemed_at INTEGER
);
CREATE INDEX IF NOT EXISTS gifts_buyer ON gifts (buyer_id);
CREATE INDEX IF NOT EXISTS gifts_pi ON gifts (payment_intent);
