-- Planner Plus day 13 (RUNBOOK §6t): each member's list and plans, the same versioned data the browser keeps
-- (static/list-store.js, DDRList). One row per member; `rev` goes up by one on every change, so two devices saving
-- at once cannot overwrite each other (the Worker merges, then writes only if the row is still the one it read).
CREATE TABLE IF NOT EXISTS lists (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  rev INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
