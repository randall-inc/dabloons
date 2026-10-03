-- Dabloons schema migration 016 — OAuth refresh expiry and reuse detection,
-- expired sign-in cleanup; judge run cap; one bid per agent per job.
--
-- refresh_expires_at: a refresh token lives 90 days, renewed on every
-- rotation (shared/core.ts OAUTH_REFRESH_TTL_DAYS). Existing grants get 90
-- days from now; the default also covers grants the previous Worker version
-- issues while a deploy is in flight.
-- oauth_used_refresh: every refresh token rotated away, by hash. Presenting
-- one again revokes its grant (the row is deleted; these cascade with it).
-- The 5-minute cron (core.cleanupExpiredAuth) deletes expired codes, grants,
-- sessions and device flows, and remembered refresh tokens past 90 days; the
-- expires_at indexes keep those deletes off full scans. Device-flow polls
-- now check expiry on their own row instead of updating the whole table.
-- jobs.judge_runs: how many times jev scored the job (shared/core.ts
-- settleWithJev stops at JUDGE_RUN_CAP, 3).
-- bids.job_group: the job's group (group_id, or its own id for a lone job).
-- The partial unique index allows one pending or accepted bid per agent per
-- job, copies counting as one job; placeBid upserts against it. Duplicates
-- already there are resolved first: per agent and group, the accepted bid
-- (else the newest pending one) stays and older pending ones become
-- 'withdrawn'. Rejected bids are left as they are (the index ignores them).
-- job_group stays nullable so the previous Worker version's inserts during a
-- deploy don't fail; the dedupe and backfill re-run on every deploy and pick
-- those up.
-- Idempotent: CI re-runs every migration on every deploy (plain `psql -f`,
-- autocommit, so CONCURRENTLY works on the existing tables).
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-016.sql

ALTER TABLE oauth_grants ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days');

CREATE TABLE IF NOT EXISTS oauth_used_refresh (
  refresh_hash TEXT PRIMARY KEY,
  grant_id BIGINT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_used_refresh_grant_idx ON oauth_used_refresh(grant_id);
CREATE INDEX IF NOT EXISTS oauth_used_refresh_used_at_idx ON oauth_used_refresh(used_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS oauth_grants_refresh_expires_idx ON oauth_grants(refresh_expires_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS device_flows_expires_idx ON device_flows(expires_at);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS judge_runs INT NOT NULL DEFAULT 0;

ALTER TABLE bids ADD COLUMN IF NOT EXISTS job_group BIGINT;
UPDATE bids b SET status = 'withdrawn'
  FROM (SELECT b2.id, row_number() OVER (PARTITION BY COALESCE(j.group_id, j.id), b2.bidder
                                         ORDER BY b2.status = 'accepted' DESC, b2.id DESC) AS rn
        FROM bids b2 JOIN jobs j ON j.id = b2.job_id WHERE b2.status IN ('pending', 'accepted')) d
  WHERE b.id = d.id AND d.rn > 1 AND b.status = 'pending';
UPDATE bids b SET job_group = COALESCE(j.group_id, j.id) FROM jobs j WHERE j.id = b.job_id AND b.job_group IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bids_one_per_agent_idx ON bids(job_group, bidder) WHERE status IN ('pending', 'accepted');
