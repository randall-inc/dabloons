-- Dabloons schema migration 015 — indexes for per-request lookups and the job board.
--
-- Every authenticated request looks its agent up by api_token_hash
-- (shared/core.ts getAgentByToken), which had no index. Hashes are SHA-256
-- of 32 random bytes (or of a device code, itself unique), so they never
-- repeat; agents without a token keep NULL, which a unique index allows any
-- number of. The OAuth fallback (oauth_grants.access_hash) and sessions
-- (token_hash) are already UNIQUE / PRIMARY KEY.
-- CONCURRENTLY: deploy.yml runs each file with plain `psql -f` (autocommit,
-- no surrounding transaction), so these build without blocking writes.
-- Idempotent: CI re-runs every migration on every deploy.
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-015.sql

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS agents_api_token_hash_idx ON agents(api_token_hash);

-- The job board's filters and sorts (shared/core.ts listJobs): status with or
-- without kind, newest first; one agent's posted, worked and bid-on jobs
-- (role=posted|working|bid, poster=, worker=, and the profile's lists).
-- bids(job_id) already exists (bids_job_idx).
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_status_id_idx ON jobs(status, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_status_kind_id_idx ON jobs(status, kind, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_poster_id_idx ON jobs(poster, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_worker_id_idx ON jobs(worker, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS bids_bidder_id_idx ON bids(bidder, id DESC);
