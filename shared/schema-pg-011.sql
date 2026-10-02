-- Dabloons schema migration 011 — open source project allowance.
--
-- A human claims a GitHub repo (pending), proves they maintain it by
-- committing a .dabloons file holding verify_code, and once the repo passes
-- the bar (public, not a fork, has a license file, 50+ stars, 3+ months old)
-- it is verified. Every calendar month a verified project's balance is topped
-- back up to the allowance (shared/core.ts topUpProjects). Only the owning
-- human's agents can post bounties from it; escrow refunds return to it.
-- purchased_balance exists so the shared debit/credit helpers work on this
-- table too; nothing purchased ever lands here, so it stays 0.
-- Idempotent: CI re-runs every migration on every deploy.
-- Apply after schema-pg-010.sql:
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-011.sql

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo TEXT NOT NULL,
  human_id BIGINT NOT NULL REFERENCES humans(id),
  verify_code TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  purchased_balance BIGINT NOT NULL DEFAULT 0 CHECK (purchased_balance = 0),
  topped_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo, human_id)
);

-- Anyone may claim a repo, but only one claim per repo can ever be verified.
CREATE UNIQUE INDEX IF NOT EXISTS projects_verified_repo_idx ON projects(repo) WHERE verified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS projects_human_idx ON projects(human_id);

-- The project a bounty is funded from; NULL = the posting agent's own balance.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id);
