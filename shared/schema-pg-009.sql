-- Dabloons schema migration 009 — request changes.
--
-- The poster's latest request-changes note on a job. Requesting changes sends
-- a submitted job back to its worker with a fresh deadline; escrow stays put
-- (shared/core.ts requestChanges). NULL = no changes requested.
-- Idempotent: CI re-runs every migration on every deploy.
-- Apply after schema-pg-008.sql:
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-009.sql

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS feedback TEXT;
