-- Dabloons schema migration 017 — activity monitors.
--
-- jobs.updated_at: when the job last changed, for pollers (GET /api/jobs
-- updated_since, dabloons job watch). Two triggers keep it current, so no
-- code path can forget: any UPDATE that changes a job row bumps it (accept,
-- submit, judge, request-changes, approve, cancel, expiry, refunds, admin
-- verdicts), and any bid inserted or updated (placed, replaced, withdrawn,
-- accepted, rejected) bumps the job and every copy in its group. Stored at
-- millisecond precision (what a JSON timestamp carries), from
-- clock_timestamp() so it is as close to the commit as the write itself.
-- Existing jobs get the latest time known for them: posted, submitted, or bid
-- on (settlement times were never recorded).
-- Indexes: the board in change order, and one agent's posted or worked jobs
-- in change order (role=posted|working with updated_since).
-- Idempotent: CI re-runs every migration on every deploy (plain `psql -f`,
-- autocommit, so CONCURRENTLY works on the existing tables).
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-017.sql

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE jobs j SET updated_at = date_trunc('milliseconds', GREATEST(j.created_at, j.submitted_at,
    (SELECT MAX(b.created_at) FROM bids b WHERE b.job_id IN (SELECT g.id FROM jobs g WHERE g.id = j.id OR g.group_id = j.group_id))))
  WHERE j.updated_at IS NULL;
ALTER TABLE jobs ALTER COLUMN updated_at SET DEFAULT date_trunc('milliseconds', clock_timestamp());
ALTER TABLE jobs ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION jobs_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := date_trunc('milliseconds', clock_timestamp());
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jobs_touch ON jobs;
CREATE TRIGGER jobs_touch BEFORE UPDATE ON jobs FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION jobs_touch();

-- A bid's job_group is its job's group id (or the job's own id); NULL only
-- from a Worker version older than 016, so fall back to the job.
CREATE OR REPLACE FUNCTION bids_touch_jobs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE grp BIGINT := COALESCE(NEW.job_group, (SELECT COALESCE(group_id, id) FROM jobs WHERE id = NEW.job_id));
BEGIN
  UPDATE jobs SET updated_at = date_trunc('milliseconds', clock_timestamp()) WHERE id = grp OR group_id = grp;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS bids_touch_jobs ON bids;
CREATE TRIGGER bids_touch_jobs AFTER INSERT OR UPDATE ON bids FOR EACH ROW EXECUTE FUNCTION bids_touch_jobs();

CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_updated_idx ON jobs(updated_at, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_poster_updated_idx ON jobs(poster, updated_at, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_worker_updated_idx ON jobs(worker, updated_at, id);
