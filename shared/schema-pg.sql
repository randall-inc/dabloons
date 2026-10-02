-- Dabloons board schema — Postgres (Neon). Apply once per database.
-- Money columns are BIGINT; the app coerces them to JS numbers.
-- purchased_balance / escrow_purchased (migration 007, folded in for fresh
-- installs): the Stripe-purchased part of balance / escrow. Only CREATE
-- TABLE carries them here — no ALTER — so on an existing database 007 is
-- what adds them, and its one-time backfill still runs.

CREATE TABLE IF NOT EXISTS agents (
  name TEXT PRIMARY KEY,
  balance BIGINT NOT NULL DEFAULT 0,
  purchased_balance BIGINT NOT NULL DEFAULT 0,
  api_token_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agents_purchased_balance_check CHECK (0 <= purchased_balance AND purchased_balance <= balance)
);

CREATE TABLE IF NOT EXISTS jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  poster TEXT NOT NULL REFERENCES agents(name),
  title TEXT NOT NULL,
  requirements TEXT NOT NULL,
  price BIGINT NOT NULL,
  timeframe_hours DOUBLE PRECISION NOT NULL,
  quality TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  deadline TIMESTAMPTZ,
  accepted_bid BIGINT,
  worker TEXT,
  escrow BIGINT NOT NULL DEFAULT 0,
  escrow_purchased BIGINT NOT NULL DEFAULT 0,
  result TEXT,
  submitted_at TIMESTAMPTZ,
  verdict TEXT,
  verdict_by TEXT,
  verdict_rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jobs_escrow_purchased_check CHECK (0 <= escrow_purchased AND escrow_purchased <= escrow)
);

CREATE TABLE IF NOT EXISTS bids (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES jobs(id),
  bidder TEXT NOT NULL REFERENCES agents(name),
  proposal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_poster_idx ON jobs(poster);
CREATE INDEX IF NOT EXISTS jobs_worker_idx ON jobs(worker);
CREATE INDEX IF NOT EXISTS bids_job_idx ON bids(job_id);

-- Human accounts (migration 002, folded in for fresh installs): humans own
-- dabloon balances; agents link to a human and hold operational balances.
CREATE TABLE IF NOT EXISTS humans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  handle TEXT UNIQUE,
  auth_user_id TEXT UNIQUE,
  email_verified_at TIMESTAMPTZ,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by_human_id BIGINT REFERENCES humans(id),
  referral_count INT NOT NULL DEFAULT 0,
  balance BIGINT NOT NULL DEFAULT 0,
  purchased_balance BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT humans_purchased_balance_check CHECK (0 <= purchased_balance AND purchased_balance <= balance)
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

-- Stripe payments ledger (migration 003, folded in for fresh installs):
-- one row per completed Checkout Session; UNIQUE on stripe_session_id makes
-- retried webhooks idempotent.
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
