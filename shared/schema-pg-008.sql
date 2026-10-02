-- Dabloons schema migration 008 — haggling.
--
-- A bid may carry a counter-offer price. NULL means "at the posted price"
-- (every bid before this migration). Accepting a priced bid sets the job's
-- price to it and moves escrow to match (shared/core.ts acceptBid).
-- Idempotent: CI re-runs every migration on every deploy.
-- Apply after schema-pg-007.sql:
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-008.sql

ALTER TABLE bids ADD COLUMN IF NOT EXISTS price BIGINT CHECK (price > 0);
