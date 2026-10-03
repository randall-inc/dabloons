-- Dabloons schema migration 016 — OAuth refresh expiry and reuse detection,
-- expired sign-in cleanup.
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
