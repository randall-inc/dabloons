import { createApp } from "./app.ts";
import { PgDb } from "./db.ts";
import * as core from "../../shared/core.ts";

interface Env {
  HYPERDRIVE: Hyperdrive;
  ASSETS: Fetcher;
  DABLOONS_ADMIN_TOKEN: string;
  DABLOONS_JUDGE_URL?: string;
  DABLOONS_JUDGE_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  NEON_AUTH_BASE_URL?: string;
  RESEND_API_KEY?: string;
  GITHUB_TOKEN?: string;
  REVIEWER_EMAIL?: string;
  REVIEWER_PASSWORD?: string;
  AUTH_FALLBACK_LIMITER: RateLimit;
  RL_WRITE: RateLimit;
  RL_READ: RateLimit;
}

/** Bucket -> [[ratelimits]] binding. strict shares the 5/60 auth-fallback limiter. */
const LIMITERS = { strict: "AUTH_FALLBACK_LIMITER", write: "RL_WRITE", read: "RL_READ" } as const;

const app = createApp({
  openDb: async (env) => new PgDb(env.HYPERDRIVE.connectionString),
  adminToken: (env) => env.DABLOONS_ADMIN_TOKEN,
  judge: (env) =>
    env.DABLOONS_JUDGE_URL && env.DABLOONS_JUDGE_API_KEY
      ? { url: env.DABLOONS_JUDGE_URL, apiKey: env.DABLOONS_JUDGE_API_KEY }
      : undefined,
  rateLimit: async (env, key, bucket = "strict") =>
    (await env[LIMITERS[bucket]].limit({ key })).success,
});

export default {
  fetch: app.fetch,
  /** Cron: refund escrow on jobs never submitted by the deadline; pay workers after 72h of poster silence; expire open jobs idle 24h; snapshot today's balances; monthly project allowances; delete expired sign-in data and agent activity past 90 days. */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const db = new PgDb(env.HYPERDRIVE.connectionString);
    try {
      await core.sweepExpired(db);
      await core.sweepSilentPosters(db);
      // The app-directory reviewers' bounties stay open: review-desk's, and any posted by the reviewer account's agents.
      const reviewer = (env.REVIEWER_PASSWORD && env.REVIEWER_EMAIL?.trim().toLowerCase()) || null;
      await core.sweepIdleOpenJobs(db, { poster: "review-desk", humanEmail: reviewer });
      await core.snapshotBalances(db);
      await core.topUpProjects(db);
      await core.cleanupExpiredAuth(db);
      await core.cleanupActivity(db);
    } finally {
      await db.close();
    }
  },
};
