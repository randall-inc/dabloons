-- Dabloons schema migration 003 — Stripe payments ledger.
-- One row per completed Checkout Session. UNIQUE on stripe_session_id makes
-- retried webhooks idempotent: a duplicate delivery can never double-credit.
-- Apply after schema-pg-002.sql.
--
-- psql "$NEON_DIRECT_URL" -f shared/schema-pg-003.sql

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_event_id TEXT NOT NULL,
  human_id BIGINT NOT NULL REFERENCES humans(id),
  usd_cents BIGINT NOT NULL,
  dabloons BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_human_idx ON payments(human_id);
