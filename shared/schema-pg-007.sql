-- Dabloons schema migration 007 — purchased vs earned balances.
--
-- Every balance splits into a purchased part (bought through Stripe, may one
-- day be refunded to the card) and an earned part (bounties, admin grants,
-- referral bonuses, purchase bonus tiers — never refundable). balance stays the total;
-- purchased_balance is the purchased part; earned = balance - purchased,
-- derived. Debits spend purchased first. jobs.escrow_purchased records how
-- much of a job's escrow came from the poster's purchased balance, so a
-- refund to the poster puts it back; a payout to a worker is always earned.
--
-- CI re-runs every migration on every deploy, so this one must be a no-op
-- the second time. The backfill runs only in the same statement that adds
-- the column — re-running it later would re-inflate purchased balances that
-- have since been spent. Fresh installs get the columns from schema-pg.sql
-- (CREATE TABLE), so this block skips them: there is nothing to backfill.
-- Apply after schema-pg-006.sql:
--
--   psql "$NEON_DIRECT_URL" -f shared/schema-pg-007.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'humans'
                   AND column_name = 'purchased_balance') THEN
    ALTER TABLE humans ADD COLUMN purchased_balance BIGINT NOT NULL DEFAULT 0;
    -- Conservative backfill: what the card paid for, capped by what they
    -- still hold. Bonus-tier dabloons are earned: LEAST(dabloons, usd_cents)
    -- is the paid-for part (DABLOONS_PER_CENT in shared/pricing.ts).
    UPDATE humans h SET purchased_balance = LEAST(h.balance, p.total)
      FROM (SELECT human_id, SUM(LEAST(dabloons, usd_cents)) AS total FROM payments
            WHERE status = 'completed' GROUP BY human_id) p
      WHERE p.human_id = h.id AND h.balance > 0;
  END IF;
END $$;

-- Agents and jobs start at 0: nothing already on an agent or in escrow
-- counts as purchased.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS purchased_balance BIGINT NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS escrow_purchased BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'humans_purchased_balance_check') THEN
    ALTER TABLE humans ADD CONSTRAINT humans_purchased_balance_check
      CHECK (0 <= purchased_balance AND purchased_balance <= balance);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_purchased_balance_check') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_purchased_balance_check
      CHECK (0 <= purchased_balance AND purchased_balance <= balance);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_escrow_purchased_check') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_escrow_purchased_check
      CHECK (0 <= escrow_purchased AND escrow_purchased <= escrow);
  END IF;
END $$;
