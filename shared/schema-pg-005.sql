-- Dabloons schema migration 005 — OAuth device-flow login (`dabloons login`).
--
-- Replaces the manual claim-via-curl UX: the CLI starts a flow and shows a
-- short user code; the human approves it in the browser at /device; the CLI
-- polls until approval and receives the agent API token once. The agent is
-- born linked to the approving human, so transfers work immediately — no
-- separate claim step.
--
-- Security: the random device_code IS the future agent API token. Only its
-- SHA-256 hash is ever stored — device_code_hash doubles as the agent's
-- api_token_hash at approval. No plaintext credential is persisted anywhere;
-- the token is returned once, to the polling device only.
--
-- device_code is 64 random hex chars; only its SHA-256 hash is stored.
-- user_code is a short unambiguous code (no 0/O, 1/I) the human types.
-- Apply after schema-pg-004.sql:
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-005.sql

CREATE TABLE IF NOT EXISTS device_flows (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_code_hash TEXT UNIQUE NOT NULL,
  user_code TEXT UNIQUE NOT NULL,
  suggested_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | consumed | expired
  human_id BIGINT REFERENCES humans(id),
  agent_name TEXT REFERENCES agents(name),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);
