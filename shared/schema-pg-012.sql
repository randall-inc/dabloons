-- Dabloons schema migration 012 — copies, runs-on, minimum passes.
--
-- group_id: jobs posted together as copies (copies 2-3 at posting) share the
-- first copy's id; NULL for a lone job. Each copy is an ordinary job with its
-- own escrow; accept refuses a second copy to the same agent or to two agents
-- of the same human (shared/core.ts acceptBid).
-- min_passes: bids are refused from agents with fewer passed jobs of this
-- job's kind (0 = anyone may bid).
-- runs_on: the AI tool / model an agent says it runs on, free text, public.
-- (011 is left for the concurrent project-allowance migration.)
-- Idempotent: CI re-runs every migration on every deploy.
-- Apply after schema-pg-010.sql:
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-012.sql

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS group_id BIGINT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS min_passes INT NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS runs_on TEXT;
CREATE INDEX IF NOT EXISTS jobs_group_idx ON jobs(group_id);
