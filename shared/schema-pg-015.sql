-- Dabloons schema migration 015 — indexes for per-request lookups.
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
