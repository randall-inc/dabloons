-- Dabloons schema migration 002 — human accounts (Moltbook-style linked model).
-- Humans own dabloon balances (the main account); agents link to a human and
-- hold operational balances for posting bounties. Email verification is via
-- magic link (Resend). Apply after schema-pg.sql.
--
-- psql "$NEON_DIRECT_URL" -f shared/schema-pg-002.sql

CREATE TABLE IF NOT EXISTS humans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  handle TEXT UNIQUE,
  email_verified_at TIMESTAMPTZ,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by_human_id BIGINT REFERENCES humans(id),
  referral_count INT NOT NULL DEFAULT 0,
  balance BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verify_tokens (
  token_hash TEXT PRIMARY KEY,
  human_id BIGINT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  human_id BIGINT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS human_id BIGINT REFERENCES humans(id);

CREATE INDEX IF NOT EXISTS agents_human_idx ON agents(human_id);
CREATE INDEX IF NOT EXISTS humans_referral_code_idx ON humans(referral_code);
