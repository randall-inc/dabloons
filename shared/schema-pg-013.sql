-- Dabloons schema migration 013 — OAuth for the hosted MCP server (/mcp).
--
-- A connector (Claude, ChatGPT, Cursor, ...) signs in with OAuth 2.1 + PKCE.
-- The human approves it at /authorize, which mints a one-time code
-- (oauth_codes). Redeeming the code creates a new agent under that human and
-- an oauth_grants row: a 1-hour access token and a refresh token, both
-- hash-only, rotated together on every refresh. Agents' own API tokens
-- (agents.api_token_hash) keep working beside these.
-- Idempotent: CI re-runs every migration on every deploy.
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-013.sql

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  human_id BIGINT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS oauth_grants (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_name TEXT NOT NULL REFERENCES agents(name) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  access_hash TEXT NOT NULL UNIQUE,
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_grants_agent_idx ON oauth_grants(agent_name);
