-- Planner Plus day 17 (RUNBOOK §6t): the member's live calendar feed. One secret address per account, which the
-- member adds to their own calendar once (Apple, Google, Outlook); the calendar app then fetches it now and then.
-- Only a SHA-256 hash of the address's random token is kept, never the token itself, so the address is shown once
-- when it is made; "Make a new address" replaces it and the old one stops working at once.
-- `cache` holds the last calendar made for the account and `cache_key` what it was made from (the code's version, the
-- list's rev, the planner data's version and the day), so most fetches do no work; whether the account has Plus is
-- checked on every fetch. No names, no email address.
CREATE TABLE IF NOT EXISTS feeds (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  read_day TEXT,                 -- the last day (YYYY-MM-DD) a calendar app fetched it, shown to the member
  cache_key TEXT,
  cache TEXT
);
