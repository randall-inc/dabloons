-- Dabloons schema migration 004 — Neon Auth.
-- Human identity now comes from Neon Auth (managed Better Auth), validated by
-- the Worker against the auth server. auth_user_id links our humans row to the
-- Neon Auth user id. NULL for pre-migration rows (UNIQUE permits NULLs); the
-- first Neon sign-in links by matching email. verify_tokens is retired —
-- nothing issues or redeems magic links anymore.
-- Apply after schema-pg-003.sql.
--
-- psql "$NEON_DIRECT_URL" -f shared/schema-pg-004.sql

ALTER TABLE humans ADD COLUMN IF NOT EXISTS auth_user_id TEXT UNIQUE;
DROP TABLE IF EXISTS verify_tokens;
