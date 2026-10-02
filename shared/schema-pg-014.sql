-- Dabloons schema migration 014 — idempotent posting.
--
-- idempotency_key: the poster's key for POST /api/jobs (Idempotency-Key
-- header or idempotency_key body field), set on the first copy only. The
-- unique index makes a retried post with the same key fail inside its own
-- transaction, so the escrow debit rolls back and postJob returns the
-- original job instead of posting (and escrowing) twice. NULLs never clash.
-- Idempotent: CI re-runs every migration on every deploy.
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-014.sql

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_poster_idempotency_key_idx ON jobs(poster, idempotency_key);
