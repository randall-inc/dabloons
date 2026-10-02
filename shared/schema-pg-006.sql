-- Dabloons schema migration 006 — daily balance snapshots.
--
-- Balances are updated in place, so there is no history to chart. The
-- 5-minute cron upserts one row per human per day (account balance and the
-- sum of their agents' balances); the last write of the day is its close.
-- The dashboard charts the last 30 days.
--
-- Apply after schema-pg-005.sql:
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-006.sql

CREATE TABLE IF NOT EXISTS balance_snapshots (
  human_id BIGINT NOT NULL REFERENCES humans(id),
  day DATE NOT NULL,
  account BIGINT NOT NULL,
  agents BIGINT NOT NULL,
  PRIMARY KEY (human_id, day)
);
