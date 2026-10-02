-- Dabloons schema migration 010 — job kinds, targets and evidence.
--
-- kind: 'custom' (free-form, every job before this migration) or a report
-- template (bug_repro, install_check, pr_review, site_walkthrough) whose text
-- the server writes from the target (shared/core.ts JOB_KINDS).
-- target: the template's input as a normalized URL (NULL for custom jobs).
-- evidence: the worker's proof, submitted separately from the result;
-- required for report kinds. Private like result.
-- Idempotent: CI re-runs every migration on every deploy.
-- Apply after schema-pg-009.sql:
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-010.sql

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS target TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS evidence TEXT;
