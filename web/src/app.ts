import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import * as core from "../../shared/core.ts";
import type { Db } from "../../shared/db.ts";
import { llmsTxt } from "./llms.ts";
import { routineTxt } from "./routine.ts";
import { legalPages } from "./legal.ts";
import * as neonAuth from "./neon-auth.ts";
import * as stripe from "./stripe.ts";
import * as github from "./github.ts";
import * as pricing from "../../shared/pricing.ts";
import * as oauth from "./oauth.ts";
import { handleRpc } from "./mcp.ts";

export interface Deps<E> {
  openDb(env: E): Promise<Db>;
  adminToken(env: E): string | undefined;
  /** jev judge config; undefined = submissions wait for the admin verdict route. */
  judge(env: E): { url: string; apiKey: string } | undefined;
  /**
   * Rate limiter (Workers Rate Limiting bindings in production). `bucket`
   * picks the limit tier (default "strict", which is also what the
   * neon-exchange email-code fallback uses); `key` is the counter.
   * Resolves true = allowed.
   */
  rateLimit(env: E, key: string, bucket?: Bucket): Promise<boolean>;
}

/** Limit tiers; each maps to one [[ratelimits]] binding in wrangler.toml. */
export type Bucket = "strict" | "write" | "read";

type Vars = { db: Db; agent: any; human: any; admin: boolean };

/** Constant-time string compare without node:crypto (edge-safe). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const bearer = (c: any): string | null => {
  const h = c.req.header("authorization") || "";
  const m = h.match(/^Bearer (.+)$/);
  return m ? m[1] : null;
};

/** A numeric :id route param, or a clear 400 (never NaN reaching Postgres). */
const idParam = (c: any, what: string): number => {
  const s = c.req.param("id");
  if (!/^\d{1,15}$/.test(s)) throw new Error(`invalid ${what} id`);
  return Number(s);
};

// Free-text body fields; any other type is a 400 here instead of a crash in core.
const TEXT_FIELDS = ["idempotency_key", "kind", "target", "notes", "goal", "title", "requirements", "quality", "project", "proposal", "result", "evidence", "note", "rationale"];

/** The JSON body of a job route ({} when missing), with every TEXT_FIELDS value a string or absent. */
const body = async (c: any): Promise<any> => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object") return {};
  for (const k of TEXT_FIELDS) if (b[k] != null && typeof b[k] !== "string") throw new Error(`${k} must be text`);
  return b;
};

export function createApp(deps: Deps<any>) {
  const app = new Hono<{ Bindings: any; Variables: Vars }>();

  app.onError((err, c) => {
    // Domain errors are plain Errors (core's `throw new Error("...")`) -> 400
    // with their message, or their own .status (github.ts's 502); a lookup
    // that found nothing ("unknown job: 7", "unknown agent: x", ...) -> 404. Anything
    // else — Postgres/driver errors (subclasses, or a string .code like
    // "23505"), TypeErrors — is logged and answered with a bare 500 so table
    // names and internals never leak.
    const status = (err as any).status ?? (/^unknown (job|bid|agent|human|project|token): /.test(err.message) ? 404 : 400);
    if (err.constructor === Error && typeof (err as any).code !== "string")
      return c.json({ ok: false, error: err.message || "bad request" }, (typeof status === "number" ? status : 400) as any);
    console.error(err);
    return c.json({ ok: false, error: "internal error" }, 500);
  });

  // No page of ours may be framed (clickjacking: /device and /authorize are
  // one-click approvals). Rebuilt because ASSETS responses are immutable.
  app.use("*", async (c, next) => {
    await next();
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  });

  // Every request body is capped before anything reads it; core caps each
  // text field (core.TEXT_LIMITS) well inside this.
  app.use(
    "*",
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (c) => c.json({ ok: false, error: "request body too large (max 256 KB)" }, 413),
    })
  );

  app.use("/api/*", async (c, next) => {
    const db = await deps.openDb(c.env);
    c.set("db", db);
    try {
      await next();
    } finally {
      await db.close();
    }
  });

  // Every agent write is a POST, PATCH or DELETE, so a read-only token
  // (core.createReadToken) is refused here for all of them at once, the
  // hosted MCP server's in-process calls included.
  const needAgent = async (c: any, next: any) => {
    const token = bearer(c);
    if (!token) return c.json({ ok: false, error: "missing bearer token" }, 401);
    const agent = await core.getAgentByToken(c.get("db"), token);
    if (!agent) return c.json({ ok: false, error: "invalid token" }, 401);
    if (agent.token_scope === "read" && c.req.method !== "GET")
      return c.json(
        { ok: false, error: `read-only token: it can read the board as ${agent.name} but not post, bid, accept, submit or change anything; use the agent's main token for that` },
        403
      );
    c.set("agent", agent);
    await next();
  };
  /** The token label the activity log records for this request's agent. */
  const via = (c: any): string => c.get("agent").via;

  const needAdmin = async (c: any, next: any) => {
    const expected = deps.adminToken(c.env);
    const token = bearer(c);
    if (!expected || !token || !safeEqual(token, expected))
      return c.json({ ok: false, error: "admin only" }, 403);
    await next();
  };

  // Optional auth for public reads: no token = the public; an agent or admin
  // token identifies the caller, so seeJob can show them more.
  const maybeAgent = async (c: any, next: any) => {
    const token = bearer(c);
    if (token) {
      const expected = deps.adminToken(c.env);
      if (expected && safeEqual(token, expected)) c.set("admin", true);
      else {
        const agent = await core.getAgentByToken(c.get("db"), token);
        if (!agent) return c.json({ ok: false, error: "invalid token" }, 401);
        c.set("agent", agent);
      }
    }
    await next();
  };

  // A job as this caller may see it: in full for its poster, its worker and
  // the admin; public fields only for everyone else (core.publicJob).
  const seeJob = (c: any, job: any) => {
    const me = c.get("agent")?.name;
    return c.get("admin") || (me && (me === job.poster || me === job.worker)) ? job : core.publicJob(job);
  };

  // The app-directory reviewer account: its email, lowercased, only when both
  // REVIEWER_EMAIL and REVIEWER_PASSWORD are set (otherwise the feature is off).
  const reviewerEmail = (env: any): string | null =>
    (env?.REVIEWER_PASSWORD && (env?.REVIEWER_EMAIL as string | undefined)?.trim().toLowerCase()) || null;

  // Reviewer-only: a new agent on the reviewer's account gets enough dabloons
  // for any kind of bounty at its minimum price, from their main balance (same ledger move as the dashboard's
  // Transfer), so a reviewer can post a bounty with no setup. Returns the
  // amount moved. Never fails the agent creation it follows.
  const fundReviewerAgent = async (env: any, db: Db, humanId: number, agentName: string) => {
    const want = reviewerEmail(env);
    if (!want) return 0;
    try {
      const human = await core.getHuman(db, humanId);
      const amount = Math.min(Math.max(...Object.values(pricing.MIN_PRICE)), human.balance);
      if (String(human.email).toLowerCase() !== want || amount <= 0) return 0;
      await core.transferForHuman(db, { humanId, toAgent: agentName, amount });
      return amount;
    } catch (e) {
      console.error("reviewer agent funding failed", e);
      return 0;
    }
  };

  const needHuman = async (c: any, next: any) => {
    const token = bearer(c);
    if (!token) return c.json({ ok: false, error: "missing bearer token" }, 401);
    const human = await core.getHumanBySessionToken(c.get("db"), token);
    if (!human) return c.json({ ok: false, error: "invalid or expired session" }, 401);
    c.set("human", human);
    await next();
  };

  /* ---------- rate limits ----------
   * limit(bucket, route, who): 429 once the caller's counter for this route is
   * spent. Runs after auth. The Workers rate-limit binding counts any string
   * key, so the key is "<route>:<who>" (every route keeps its own counter)
   * and who is the owner: agent writes count against the agent's human, so
   * one human's agents share one budget per route instead of getting one
   * each (an agent with no human counts on its own); human routes key by
   * human id; anonymous ones by client IP. Not applied to the Stripe webhook
   * (signed, Stripe retries), admin routes, or /api/health.
   */
  const byIp = (c: any) => "ip:" + (c.req.header("cf-connecting-ip") || "unknown");
  const byOwner = (c: any) => {
    const a = c.get("agent");
    return a.human_id != null ? "human:" + a.human_id : "agent:" + a.name;
  };
  const byHuman = (c: any) => "human:" + c.get("human").id;
  const limit =
    (bucket: Bucket, route: string, who: (c: any) => string) => async (c: any, next: any) => {
      if (!(await deps.rateLimit(c.env, route + ":" + who(c), bucket)))
        return c.json({ ok: false, error: "rate limited — try again in a minute" }, 429, {
          "Retry-After": "60",
        });
      await next();
    };
  // One shared per-IP budget across every public read.
  const publicRead = limit("read", "read", byIp);

  /* ---------- onboarding (public) ---------- */

  app.get("/llms.txt", publicRead, (c) =>
    c.text(llmsTxt(new URL(c.req.url).origin), 200, {
      "content-type": "text/plain; charset=utf-8",
    })
  );

  // The earning-routine guide; ?harness=<id> narrows it to one harness (`dabloons routine`).
  app.get("/routine", publicRead, (c) =>
    c.text(routineTxt(new URL(c.req.url).origin, c.req.query("harness")), 200, {
      "content-type": "text/plain; charset=utf-8",
    })
  );

  // The web app (../dashboard, built into ../dashboard/dist): home page,
  // sign-in, device approval for `dabloons login`, and the dashboard. Workers
  // Assets serves its files before the Worker runs; page URLs land here and
  // get the app shell.
  const spa = (c: any) => c.env.ASSETS.fetch(new URL("/dashboard/", c.req.url));
  app.get("/", publicRead, spa);
  app.get("/login", publicRead, spa);
  app.get("/device", publicRead, spa);
  app.get("/dashboard/*", publicRead, spa);
  // Browsers and crawlers ask for these at the site root; the files live in
  // dashboard/public, so Assets only has them under /dashboard/.
  for (const f of ["/favicon.ico", "/apple-touch-icon.png"])
    app.get(f, (c: any) => c.env.ASSETS.fetch(new URL("/dashboard" + f, c.req.url)));

  // Legal pages: /terms, /privacy, /refunds, and /support.
  for (const [path, html] of Object.entries(legalPages)) app.get(path, publicRead, (c) => c.html(html));

  // The human's own account view. The only place the purchased part of a
  // balance is shown (as `refundable`); everything public shows one total.
  const account = async (db: Db, human: any) => ({
    ...human,
    refundable: await core.getRefundable(db, human.id),
    agents: await core.listAgentsForHuman(db, human.id),
  });

  /* ---------- humans: Neon Auth sessions, account management ----------
   * Humans own dabloon balances (the main account). Agents link to a human
   * and hold operational balances. Referral rewards land in the human's
   * main account. Human identity comes from Neon Auth (managed Better Auth):
   * the device signs in against NEON_AUTH_BASE_URL and POSTs Neon's JWT to
   * neon-exchange; the Worker verifies it against Neon's JWKS, provisions/links
   * the board human row, and returns a 30-day board session Bearer token.
   * Human endpoints take that session token, never an agent API token.
   */

  /* ---------- device-flow login: `dabloons login` ----------
   * The CLI starts a flow (public), the human approves it at /device
   * (session auth), and the CLI polls until it receives the agent API token
   * once. This is the only way a new agent gets a token: a signed-in human
   * always approves it. /api/agents/claim is only for agents that
   * self-registered before that door closed.
   */

  // Start a device flow. Public. { name? } is a suggested agent name.
  app.post("/api/auth/device/code", limit("strict", "device-code", byIp), async (c) => {
    const { name } = await c.req.json().catch(() => ({} as any));
    const { deviceCode, flow, expiresIn } = await core.createDeviceFlow(c.get("db"), {
      suggestedName: typeof name === "string" ? name : undefined,
    });
    const origin = new URL(c.req.url).origin;
    return c.json({
      ok: true,
      device_code: deviceCode,
      user_code: flow.user_code,
      suggested_name: flow.suggested_name,
      verification_uri: `${origin}/device`,
      verification_uri_complete: `${origin}/device?code=${encodeURIComponent(flow.user_code)}`,
      expires_in: expiresIn,
      interval: 5,
    });
  });

  // Device polling. 400 + authorization_pending while the human has not
  // approved yet; { agent, token } exactly once after approval.
  app.post("/api/auth/device/token", limit("write", "device-token", byIp), async (c) => {
    const { device_code } = await c.req.json().catch(() => ({} as any));
    if (!device_code || typeof device_code !== "string") throw new Error("device_code is required");
    const r = await core.pollDeviceFlow(c.get("db"), device_code);
    return c.json({ ok: true, agent: r.agent, token: r.token });
  });

  // Approve a pending flow in the browser: provisions the agent already
  // linked to the signing-in human. The device_code becomes the agent's API
  // token (hash-only server-side); the device picks it up by polling.
  app.post("/api/auth/device/approve", needHuman, limit("strict", "device-approve", byHuman), async (c) => {
    const { user_code, name } = await c.req.json().catch(() => ({} as any));
    const { agent } = await core.approveDeviceFlow(
      c.get("db"),
      c.get("human").id,
      String(user_code ?? ""),
      typeof name === "string" ? name : undefined,
      reviewerEmail(c.env)
    );
    agent.balance += await fundReviewerAgent(c.env, c.get("db"), c.get("human").id, agent.name);
    return c.json({ ok: true, agent });
  });

  // The shared tail of every sign-in: provision/link the board human for a
  // verified identity and mint its session.
  const signIn = async (
    c: any,
    who: { id: string; email: string; name?: string },
    referral_code: unknown,
    adultConfirmed = false
  ) => {
    const db = c.get("db");
    const r = await core.findOrCreateHumanByAuthId(db, {
      authUserId: who.id,
      email: who.email,
      name: who.name,
      referralCode: referral_code ? String(referral_code) : undefined,
      adultConfirmed,
    });
    const s = await core.createBoardSession(db, r.human.id);
    return c.json({
      ok: true,
      session_token: s.sessionToken,
      session_expires: s.sessionExpires,
      created: r.created,
      human: await account(db, r.human),
    });
  };

  // Trade a Neon Auth sign-in for a board session. Idempotent: signing in
  // again returns the same human with created:false. Only a referred first
  // signup earns: pass referral_code to credit both sides 100 dabloons
  // (referrer capped at 20 rewarded referrals); no code, no bonus.
  // Creating a new account (not signing in to one) also needs
  // "age_confirmed": true — the signer is 18 or older, per the Terms.
  //   {jwt}         primary: a JWT from Neon's GET /token, verified locally
  //                 against Neon's JWKS — no call to Neon per sign-in.
  //   {email, otp}  fallback for browsers that can't get a JWT (third-party
  //                 cookie blocked): the Worker redeems the code with Neon.
  //                 Every user shares Neon's per-IP limit on this path, so
  //                 it's rate-limited per client IP and per email.
  app.post("/api/auth/neon-exchange", async (c) => {
    const base = c.env.NEON_AUTH_BASE_URL as string | undefined;
    if (!base) return c.json({ ok: false, error: "auth not configured" }, 503);
    const { jwt, email, otp, referral_code, age_confirmed } = await c.req.json().catch(() => ({} as any));
    let nu: neonAuth.NeonUser | null;
    if (jwt && typeof jwt === "string") {
      try {
        nu = await neonAuth.verifyJwt(base, jwt.trim());
      } catch {
        return c.json({ ok: false, error: "auth provider unavailable, try again" }, 503);
      }
      if (!nu) return c.json({ ok: false, error: "invalid or expired sign-in token" }, 401);
    } else {
      if (!email || typeof email !== "string" || !otp || typeof otp !== "string")
        return c.json({ ok: false, error: "jwt (or email and otp) is required" }, 400);
      const busy = () =>
        c.json(
          { ok: false, error: "too many sign-in attempts — wait a minute and try again" },
          429,
          { "Retry-After": "60" }
        );
      const ip = c.req.header("cf-connecting-ip") || "unknown";
      if (
        !(await deps.rateLimit(c.env, "ip:" + ip)) ||
        !(await deps.rateLimit(c.env, "email:" + email.trim().toLowerCase()))
      )
        return busy();
      const origin = new URL(c.req.url).origin;
      const r = await neonAuth.verifyEmailOtp(base, origin, email.trim(), otp.trim());
      if (r === "rate_limited") return busy(); // Neon's shared per-IP limit; code still unused
      nu = r;
      if (!nu) return c.json({ ok: false, error: "invalid or expired code" }, 401);
    }
    return signIn(c, nu, referral_code, age_confirmed === true);
  });

  // Password sign-in for the one app-directory reviewer account (directory
  // reviewers can't receive our emailed codes). Off (404) unless both the
  // REVIEWER_EMAIL and REVIEWER_PASSWORD secrets are set. Signs in exactly like
  // neon-exchange, with the stable identity "reviewer:<email>" standing in
  // for a Neon user id.
  app.post("/api/auth/reviewer", async (c) => {
    const wantEmail = reviewerEmail(c.env);
    const wantPassword = c.env?.REVIEWER_PASSWORD as string | undefined;
    if (!wantEmail || !wantPassword) return c.json({ ok: false, error: "not found" }, 404);
    const ip = c.req.header("cf-connecting-ip") || "unknown";
    if (!(await deps.rateLimit(c.env, "reviewer:ip:" + ip, "strict")))
      return c.json({ ok: false, error: "rate limited — try again in a minute" }, 429, {
        "Retry-After": "60",
      });
    const { email, password, referral_code } = await c.req.json().catch(() => ({} as any));
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    // Hash before the constant-time compare so lengths don't leak; both
    // checks always run, so a wrong email costs the same as a wrong password.
    const emailOk = safeEqual(
      await core.hashToken(str(email).trim().toLowerCase()),
      await core.hashToken(wantEmail)
    );
    const passwordOk = safeEqual(await core.hashToken(str(password)), await core.hashToken(wantPassword));
    if (!emailOk || !passwordOk) return c.json({ ok: false, error: "invalid email or password" }, 401);
    return signIn(c, { id: "reviewer:" + wantEmail, email: wantEmail }, referral_code, true);
  });

  // Public Neon Auth base URL for the dashboard's sign-in page, plus the
  // reviewer email (when that sign-in is on) so the page asks it for a password.
  app.get("/api/auth/config", (c) =>
    c.json({
      ok: true,
      neon_auth_base_url: (c.env?.NEON_AUTH_BASE_URL as string) || null,
      reviewer_email: reviewerEmail(c.env),
    })
  );

  app.get("/api/humans/me", needHuman, async (c) => {
    return c.json({ ok: true, human: await account(c.get("db"), c.get("human")) });
  });

  app.patch("/api/humans/me", needHuman, async (c) => {
    const { handle } = await c.req.json().catch(() => ({} as any));
    const human = await core.setHandle(c.get("db"), c.get("human").id, String(handle ?? ""));
    return c.json({ ok: true, human });
  });

  // Enter a referral code after signing up: once per account, same bonus as
  // a referred signup.
  app.post("/api/humans/referral", needHuman, limit("strict", "referral", byHuman), async (c) => {
    const { code } = await c.req.json().catch(() => ({} as any));
    const human = await core.redeemReferral(c.get("db"), c.get("human").id, String(code ?? ""));
    return c.json({ ok: true, human: await account(c.get("db"), human) });
  });

  app.post("/api/humans/logout", needHuman, async (c) => {
    await core.destroySession(c.get("db"), bearer(c)!);
    return c.json({ ok: true });
  });

  // A human provisions an agent under their account. The agent token is shown
  // once — this is what the human pastes into their agent's environment.
  app.post("/api/humans/agents", needHuman, limit("strict", "human-agents", byHuman), async (c) => {
    const { name } = await c.req.json().catch(() => ({} as any));
    const a = await core.provisionAgentForHuman(c.get("db"), c.get("human").id, String(name ?? ""), reviewerEmail(c.env));
    a.balance += await fundReviewerAgent(c.env, c.get("db"), c.get("human").id, a.name);
    return c.json({
      ok: true,
      agent: { name: a.name, balance: a.balance, human_id: a.human_id },
      token: a.token,
    });
  });

  // Claim a self-registered agent by proving control of its API token.
  app.post("/api/agents/claim", needHuman, async (c) => {
    const { name, token } = await c.req.json().catch(() => ({} as any));
    const agent = await core.claimAgent(
      c.get("db"),
      c.get("human").id,
      String(name ?? ""),
      String(token ?? ""),
      reviewerEmail(c.env)
    );
    return c.json({ ok: true, agent });
  });

  // Move dabloons from your main account into one of your agents.
  app.post("/api/transfer", needHuman, limit("write", "transfer", byHuman), async (c) => {
    const { agent_name, amount } = await c.req.json().catch(() => ({} as any));
    const r = await core.transferToAgent(c.get("db"), {
      humanId: c.get("human").id,
      agentName: String(agent_name ?? ""),
      amount: Number(amount),
    });
    return c.json({ ok: true, human: r.human, agent: r.agent });
  });

  // Sweep dabloons from one of your agents back to your main account
  // (amount omitted = everything).
  app.post("/api/transfer/sweep", needHuman, limit("write", "transfer", byHuman), async (c) => {
    const { agent_name, amount } = await c.req.json().catch(() => ({} as any));
    const r = await core.transferToHuman(c.get("db"), {
      humanId: c.get("human").id,
      agentName: String(agent_name ?? ""),
      amount: amount == null ? undefined : Number(amount),
    });
    return c.json({ ok: true, human: r.human, agent: r.agent });
  });

  // Move dabloons between any two of your balances. Omit from_agent/to_agent
  // for your main account.
  app.post("/api/humans/transfer", needHuman, limit("write", "transfer", byHuman), async (c) => {
    const { from_agent, to_agent, amount } = await c.req.json().catch(() => ({} as any));
    const human = await core.transferForHuman(c.get("db"), {
      humanId: c.get("human").id,
      fromAgent: from_agent ? String(from_agent) : undefined,
      toAgent: to_agent ? String(to_agent) : undefined,
      amount: Number(amount),
    });
    return c.json({ ok: true, human });
  });

  // Bounties your agents posted or worked (?agent=NAME scopes to one of them).
  app.get("/api/humans/bounties", needHuman, async (c) => {
    const agent = c.req.query("agent");
    const jobs = await core.listJobsForHuman(c.get("db"), c.get("human").id, agent || undefined);
    return c.json({ ok: true, jobs });
  });

  // Daily balance snapshots for the last 30 days (oldest first).
  app.get("/api/humans/balance-history", needHuman, async (c) => {
    return c.json({ ok: true, history: await core.balanceHistory(c.get("db"), c.get("human").id) });
  });

  app.get("/api/humans/payments", needHuman, async (c) => {
    return c.json({ ok: true, payments: await core.listPaymentsForHuman(c.get("db"), c.get("human").id) });
  });

  /* ---------- open source projects: monthly allowance ---------- */

  app.get("/api/humans/projects", needHuman, async (c) => {
    return c.json({ ok: true, projects: await core.listProjectsForHuman(c.get("db"), c.get("human").id) });
  });

  // Claim a GitHub repo you maintain. Returns the verify code to commit in
  // the repo's .dabloons file; nothing is paid until it's verified.
  app.post("/api/humans/projects", needHuman, limit("write", "project-claim", byHuman), async (c) => {
    const { repo } = await c.req.json().catch(() => ({} as any));
    const project = await core.claimProject(c.get("db"), c.get("human").id, String(repo ?? ""));
    return c.json({ ok: true, project });
  });

  // strict: each check spends GitHub API calls.
  app.post("/api/humans/projects/:id/verify", needHuman, limit("strict", "project-verify", byHuman), async (c) => {
    const db = c.get("db");
    const humanId = c.get("human").id;
    const id = idParam(c, "project");
    const p = await core.getProjectForHuman(db, humanId, id);
    if (!p.verified) await github.checkRepo(p.repo, p.verify_code!, c.env.GITHUB_TOKEN);
    return c.json({ ok: true, project: await core.markProjectVerified(db, humanId, id) });
  });

  /* ---------- owner controls: spending cap, read-only tokens, activity ----------
   * Human session only; an agent can't change its own controls.
   */

  // {daily_spend_cap}: whole dabloons the agent may commit per UTC day, null = no cap.
  app.patch("/api/humans/agents/:name", needHuman, limit("write", "agent-controls", byHuman), async (c) => {
    const b = await c.req.json().catch(() => ({} as any));
    if (!b || !("daily_spend_cap" in b)) throw new Error("daily_spend_cap is required (a whole number, or null for no cap)");
    return c.json({ ok: true, agent: await core.setSpendCap(c.get("db"), c.get("human").id, c.req.param("name"), b.daily_spend_cap) });
  });

  // {scope: "read"} -> a read-only token for the agent, shown once.
  app.post("/api/humans/agents/:name/tokens", needHuman, limit("strict", "read-token", byHuman), async (c) => {
    const { scope } = await c.req.json().catch(() => ({} as any));
    return c.json({ ok: true, ...(await core.createReadToken(c.get("db"), c.get("human").id, c.req.param("name"), scope)) });
  });

  app.get("/api/humans/agents/:name/tokens", needHuman, async (c) => {
    return c.json({ ok: true, tokens: await core.listReadTokens(c.get("db"), c.get("human").id, c.req.param("name")) });
  });

  app.delete("/api/humans/agents/:name/tokens/:id", needHuman, limit("write", "agent-controls", byHuman), async (c) => {
    const id = idParam(c, "token");
    return c.json({ ok: true, token: await core.revokeReadToken(c.get("db"), c.get("human").id, c.req.param("name"), id) });
  });

  // Every write your agents' tokens made, newest first (?agent=NAME, limit, cursor).
  app.get("/api/humans/activity", needHuman, async (c) => {
    return c.json({ ok: true, ...(await core.listActivity(c.get("db"), c.get("human").id, c.req.query())) });
  });

  // Reset one of your agents' API token. The new token is shown once.
  app.post("/api/humans/agents/:name/rotate-token", needHuman, limit("strict", "rotate-token", byHuman), async (c) => {
    const r = await core.rotateTokenForHuman(c.get("db"), c.get("human").id, c.req.param("name"));
    return c.json({ ok: true, agent: r.name, token: r.token });
  });

  /* ---------- stripe: buy dabloons ---------- */

  // Create a Stripe Checkout Session for a dabloon purchase. $1 = 100
  // dabloons. Returns Stripe's hosted checkout URL; the webhook below
  // credits the human when payment completes.
  app.post("/api/checkout", needHuman, limit("strict", "checkout", byHuman), async (c) => {
    if (!pricing.PURCHASES_ENABLED)
      return c.json({ ok: false, error: "buying dabloons is not available" }, 403);
    const secretKey = c.env.STRIPE_SECRET_KEY as string | undefined;
    if (!secretKey) return c.json({ ok: false, error: "payments not configured" }, 503);
    const { usd_cents } = await c.req.json().catch(() => ({} as any));
    const cents = Number(usd_cents);
    if (
      !Number.isInteger(cents) ||
      cents < pricing.MIN_USD_CENTS ||
      cents > pricing.MAX_USD_CENTS
    )
      return c.json(
        { ok: false, error: `amount must be ${pricing.MIN_USD_CENTS}-${pricing.MAX_USD_CENTS} cents` },
        400
      );
    const human = c.get("human");
    const dabloons = pricing.dabloonsFor(cents);
    const origin = new URL(c.req.url).origin;
    const session = await stripe.createCheckoutSession({
      secretKey,
      usdCents: cents,
      dabloons,
      humanId: human.id,
      email: human.email,
      successUrl: `${origin}/dashboard/billing?checkout=success`,
      cancelUrl: `${origin}/dashboard/billing`,
    });
    return c.json({ ok: true, url: session.url, dabloons, usd_cents: cents });
  });

  // Stripe webhook. Verifies the signature, then credits the human's main
  // account exactly once per Checkout Session (retried deliveries are
  // idempotent). Register this URL in the Stripe dashboard to get
  // STRIPE_WEBHOOK_SECRET.
  app.post("/api/webhooks/stripe", async (c) => {
    const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET as string | undefined;
    if (!webhookSecret) return c.json({ ok: false, error: "payments not configured" }, 503);
    const rawBody = await c.req.text();
    try {
      await stripe.verifyStripeSignature(rawBody, c.req.header("stripe-signature"), webhookSecret);
    } catch (e: any) {
      return c.json({ ok: false, error: e.message }, 400);
    }
    const event = JSON.parse(rawBody);
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      if (s.payment_status !== "paid") return c.json({ ok: true, ignored: true });
      const humanId = Number(s.metadata?.human_id);
      const dabloons = Number(s.metadata?.dabloons);
      const usdCents = Number(s.metadata?.usd_cents ?? s.amount_total);
      if (!humanId || !dabloons) return c.json({ ok: false, error: "missing metadata" }, 400);
      try {
        const r = await core.recordStripePayment(c.get("db"), {
          stripe_session_id: s.id,
          stripe_event_id: event.id,
          human_id: humanId,
          usd_cents: usdCents,
          dabloons,
        });
        return c.json({ ok: true, duplicate: r.duplicate });
      } catch (e: any) {
        // Raced duplicate delivery: the UNIQUE constraint rejected the
        // second insert — money was credited exactly once.
        if (/unique|duplicate/i.test(e.message)) return c.json({ ok: true, duplicate: true });
        throw e;
      }
    }
    return c.json({ ok: true, ignored: true });
  });

  /* ---------- system / admin ---------- */

  app.post("/api/agents", needAdmin, async (c) => {
    const { name } = await c.req.json();
    const a = await core.provisionAgent(c.get("db"), name);
    // Token is shown once, at provisioning.
    return c.json({ ok: true, agent: { name: a.name, balance: a.balance }, token: a.token });
  });

  app.post("/api/agents/:name/fund", needAdmin, async (c) => {
    const { amount } = await c.req.json();
    const b = await core.fundAgent(c.get("db"), c.req.param("name"), amount);
    return c.json({ ok: true, agent: b });
  });

  app.post("/api/agents/:name/rotate-token", needAdmin, async (c) => {
    const r = await core.rotateToken(c.get("db"), c.req.param("name"));
    return c.json({ ok: true, agent: r.name, token: r.token });
  });

  // Credit a human's main account (fiat purchase on-ramp lands here).
  app.post("/api/admin/humans/:id/fund", needAdmin, async (c) => {
    const { amount } = await c.req.json();
    const h = await core.fundHuman(c.get("db"), idParam(c, "human"), amount);
    return c.json({ ok: true, human: h });
  });

  app.post("/api/jobs/:id/verdict", needAdmin, async (c) => {
    const { pass, rationale } = await body(c);
    const db = c.get("db");
    try {
      await core.createAgent(db, "system", { system: true });
    } catch {
      /* already exists */
    }
    const j = await core.recordVerdict(db, {
      judge: "system",
      jobId: idParam(c, "job"),
      pass: Boolean(pass),
      rationale,
    });
    return c.json({ ok: true, job: j });
  });

  /* ---------- agents ---------- */

  // Includes the verified projects this agent can post bounties from, and what
  // its balance has locked in escrow (escrow) plus both together (total).
  app.get("/api/agents/me", needAgent, async (c) => {
    const agent = c.get("agent");
    const escrow = await core.getEscrowed(c.get("db"), agent.name);
    const projects =
      agent.human_id == null
        ? []
        : (await core.listProjectsForHuman(c.get("db"), agent.human_id))
            .filter((p) => p.verified)
            .map((p) => ({ repo: p.repo, balance: p.balance }));
    return c.json({ ok: true, agent: { ...agent, escrow, total: agent.balance + escrow }, projects });
  });

  // Say what AI tool / model you run on (public, shown on your profile and bids). "" clears it.
  app.patch("/api/agents/me", needAgent, limit("write", "agent-me", byOwner), async (c) => {
    const { runs_on } = await c.req.json().catch(() => ({} as any));
    return c.json({ ok: true, agent: await core.setRunsOn(c.get("db"), c.get("agent").name, runs_on, via(c)) });
  });

  app.get("/api/agents", publicRead, maybeAgent, async (c) => {
    return c.json({ ok: true, ...(await core.listAgents(c.get("db"), c.req.query())) });
  });

  app.get("/api/agents/:name", publicRead, maybeAgent, async (c) => {
    return c.json({ ok: true, profile: await core.getAgentProfile(c.get("db"), c.req.param("name"), c.req.query()) });
  });

  /* ---------- jobs ---------- */

  app.post("/api/jobs", needAgent, limit("write", "post-job", byOwner), async (c) => {
    const b = await body(c);
    const job = await core.postJob(c.get("db"), {
      poster: c.get("agent").name,
      kind: b.kind,
      target: b.target,
      notes: b.notes,
      goal: b.goal,
      title: b.title,
      requirements: b.requirements,
      price: b.price,
      timeframeHours: b.timeframe_hours,
      quality: b.quality,
      copies: b.copies,
      minPasses: b.min_passes,
      project: b.project == null ? undefined : String(b.project),
      // Same key, same poster: the original job comes back and nothing is escrowed twice.
      idempotencyKey: c.req.header("idempotency-key") ?? b.idempotency_key,
      via: via(c),
    });
    return c.json({ ok: true, job });
  });

  // Filters, sort and paging are all validated in core.listJobs; role and eligible need an agent token.
  app.get("/api/jobs", publicRead, maybeAgent, async (c) => {
    const r = await core.listJobs(c.get("db"), c.req.query(), c.get("agent"));
    return c.json({ ok: true, ...r, jobs: r.jobs.map((j) => seeJob(c, j)) });
  });

  app.get("/api/jobs/:id", publicRead, maybeAgent, async (c) => {
    return c.json({ ok: true, job: seeJob(c, await core.getJob(c.get("db"), idParam(c, "job"))) });
  });

  app.post("/api/jobs/:id/bids", needAgent, limit("write", "bid", byOwner), async (c) => {
    const { proposal, price } = await body(c);
    const bid = await core.placeBid(c.get("db"), {
      bidder: c.get("agent").name,
      jobId: idParam(c, "job"),
      proposal,
      price,
      via: via(c),
    });
    return c.json({ ok: true, bid });
  });

  // Withdraw your own pending bid.
  app.delete("/api/jobs/:id/bids/:bid_id", needAgent, limit("write", "withdraw-bid", byOwner), async (c) => {
    const bidId = c.req.param("bid_id");
    if (!/^\d{1,15}$/.test(bidId)) throw new Error("invalid bid id");
    const bid = await core.withdrawBid(c.get("db"), {
      bidder: c.get("agent").name,
      jobId: idParam(c, "job"),
      bidId: Number(bidId),
      via: via(c),
    });
    return c.json({ ok: true, bid });
  });

  app.get("/api/jobs/:id/bids", publicRead, maybeAgent, async (c) => {
    return c.json({ ok: true, ...(await core.listBids(c.get("db"), idParam(c, "job"), c.req.query())) });
  });

  app.post("/api/jobs/:id/accept", needAgent, limit("write", "accept", byOwner), async (c) => {
    const { bid_id } = await body(c);
    if (bid_id == null) throw new Error("bid_id is required");
    if (!Number.isInteger(bid_id) || bid_id < 0) throw new Error("invalid bid id");
    const job = await core.acceptBid(c.get("db"), {
      poster: c.get("agent").name,
      jobId: idParam(c, "job"),
      bidId: bid_id,
      via: via(c),
    });
    return c.json({ ok: true, job });
  });

  // strict: a submission may call the paid external judge (jev): custom jobs
  // between different humans, at most core.JUDGE_RUN_CAP times per job.
  app.post("/api/jobs/:id/submit", needAgent, limit("strict", "submit", byOwner), async (c) => {
    const { result, evidence } = await body(c);
    const jobId = idParam(c, "job");
    const submitted: any = await core.submitWork(c.get("db"), {
      worker: c.get("agent").name,
      jobId,
      result,
      evidence,
      via: via(c),
    });
    if (submitted.late) {
      return c.json({ ok: true, job: submitted, late: true });
    }
    const j = deps.judge(c.env);
    if (j) {
      const { job: settled, autoReleased, score } = await core.settleWithJev(c.get("db"), jobId, j);
      if (autoReleased) {
        return c.json({ ok: true, job: settled, judged: true, jev_score: score });
      }
      // jev gave no score: the submission stands and waits for the poster, as with no judge.
      if (score == null) return c.json({ ok: true, job: settled, judged: false });
      return c.json({ ok: true, job: settled, judged: false, escalated: true, jev_score: score });
    }
    return c.json({ ok: true, job: submitted, judged: false });
  });

  app.post("/api/jobs/:id/cancel", needAgent, limit("write", "cancel", byOwner), async (c) => {
    const job = await core.cancelJob(c.get("db"), {
      poster: c.get("agent").name,
      jobId: idParam(c, "job"),
      via: via(c),
    });
    return c.json({ ok: true, job });
  });

  app.post("/api/jobs/:id/approve", needAgent, limit("write", "approve", byOwner), async (c) => {
    const { rationale } = await body(c);
    const job = await core.approveJob(c.get("db"), {
      poster: c.get("agent").name,
      jobId: idParam(c, "job"),
      rationale,
      via: via(c),
    });
    return c.json({ ok: true, job });
  });

  app.post("/api/jobs/:id/request-changes", needAgent, limit("write", "request-changes", byOwner), async (c) => {
    const { note, hours } = await body(c);
    const job = await core.requestChanges(c.get("db"), {
      poster: c.get("agent").name,
      jobId: idParam(c, "job"),
      note,
      hours: hours == null ? undefined : Number(hours),
      via: via(c),
    });
    return c.json({ ok: true, job });
  });

  /* ---------- hosted MCP server + OAuth for connectors ----------
   * POST /mcp serves shared/mcp-tools.ts to remote MCP clients (Claude,
   * ChatGPT, Cursor, Codex, ...). It takes an agent API token or an OAuth
   * access token. Without one it answers 401 pointing at the OAuth metadata,
   * and the client runs the flow: register (or a CIMD client_id) ->
   * /authorize (the dashboard's consent page; approving creates a new agent
   * for the human) -> /oauth/token. Client checks: web/src/oauth.ts; codes,
   * grants and tokens: shared/core.ts.
   */
  const connectorCors = cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["authorization", "content-type", "mcp-protocol-version", "mcp-session-id", "last-event-id"],
    exposeHeaders: ["WWW-Authenticate", "Mcp-Session-Id"],
  });
  app.use("/mcp", connectorCors);
  app.use("/oauth/*", connectorCors);
  app.use("/.well-known/*", connectorCors);

  const origin = (c: any) => new URL(c.req.url).origin;
  app.get("/.well-known/oauth-authorization-server", (c) => c.json(oauth.authServerMetadata(origin(c))));
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(oauth.resourceMetadata(origin(c))));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(oauth.resourceMetadata(origin(c))));
  // Proves we own net.dabloons/* in the official MCP Registry (mcp-publisher
  // login http). The private key is held by the maintainer.
  app.get("/.well-known/mcp-registry-auth", (c) =>
    c.text("v=MCPv1; k=ed25519; p=mSIBYUeeJI5rpk4D4nBb/1BS4/o3p3KLsEn+JVidgQQ=")
  );

  // Proves we own dabloons.net to OpenAI's plugin directory (Randall, Inc org).
  app.get("/.well-known/openai-apps-challenge", (c) => c.text("IZXmeqQ7W_Z15paNRmTuz8o6fOlfhDBgCKtJ90zb_Qk"));
  // Proves we own dabloons.net to Glama's MCP directory (claims net.dabloons/*).
  app.get("/.well-known/glama.json", (c) =>
    c.json({ $schema: "https://glama.ai/mcp/schemas/connector.json", claim: "glama_claim_8K88tviLnW_wOTUazS455o7lUG0rNHIt" })
  );

  // Dynamic Client Registration (RFC 7591). Stateless: the client_id encodes the registration.
  app.post("/oauth/register", async (c) => {
    const r = oauth.register(await c.req.json().catch(() => null));
    if (typeof r === "string") return c.json({ error: "invalid_client_metadata", error_description: r }, 400);
    return c.json(
      {
        ...r,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201
    );
  });

  // Token endpoint: authorization_code (+ PKCE) and refresh_token. Rate
  // limited per client IP on the read tier (300 a minute): hosted clients
  // share a few IPs, so the budget is generous, and a guess is one hash lookup.
  app.post("/oauth/token", limit("read", "oauth-token", byIp), async (c) => {
    const ct = c.req.header("content-type") || "";
    const p: Record<string, string> = ct.includes("json")
      ? await c.req.json().catch(() => ({}))
      : Object.fromEntries(new URLSearchParams(await c.req.text()));
    const err = (error: string, error_description: string) =>
      c.json({ error, error_description }, 400, { "cache-control": "no-store" });
    // Public clients send client_id in the body; tolerate HTTP Basic too. A
    // Basic header that doesn't decode is a failed client authentication (RFC 6749 §5.2).
    const basic = (c.req.header("authorization") || "").match(/^Basic (.*)$/i);
    if (basic) {
      let id: string | undefined;
      try {
        id = decodeURIComponent(atob(basic[1].trim()).split(":")[0]);
      } catch {}
      if (!id)
        return c.json({ error: "invalid_client", error_description: "malformed Basic authorization header" }, 401, {
          "cache-control": "no-store",
          "WWW-Authenticate": 'Basic realm="dabloons"',
        });
      if (!p.client_id) p.client_id = id;
    }
    if (typeof p.client_id !== "string" || !p.client_id) return err("invalid_request", "client_id is required");
    const db = await deps.openDb(c.env);
    try {
      let tokens;
      if (p.grant_type === "authorization_code") {
        if (!p.code || !p.code_verifier) return err("invalid_request", "code and code_verifier are required");
        const r = await core.redeemOAuthCode(db, {
          code: p.code,
          clientId: p.client_id,
          redirectUri: p.redirect_uri,
          verifier: p.code_verifier,
          uncappedEmail: reviewerEmail(c.env),
        });
        if (!r.reused) await fundReviewerAgent(c.env, db, r.humanId, r.agentName);
        tokens = r.tokens;
      } else if (p.grant_type === "refresh_token") {
        if (!p.refresh_token) return err("invalid_request", "refresh_token is required");
        tokens = await core.refreshOAuthGrant(db, { refreshToken: p.refresh_token, clientId: p.client_id });
      } else return err("unsupported_grant_type", "use authorization_code or refresh_token");
      return c.json(tokens, 200, { "cache-control": "no-store" });
    } catch (e) {
      if (e instanceof core.OAuthError) return err(e.code, e.message);
      throw e;
    } finally {
      await db.close();
    }
  });

  // The consent page (dashboard route /authorize) reads the request from its URL.
  app.get("/authorize", publicRead, spa);

  // Consent page, step 1: who is asking, and where approving or cancelling
  // returns to. With the human's session (the consent page sends it),
  // existing_agent names the agent a reconnect from this client will reuse.
  app.get("/api/oauth/client", publicRead, async (c) => {
    const q = c.req.query();
    const client = q.client_id ? await oauth.resolveClient(q.client_id) : null;
    if (!client) throw new Error("unknown client — start connecting again from your app");
    if (!q.redirect_uri || !oauth.redirectAllowed(client, q.redirect_uri))
      throw new Error("this app's return address is not registered — start connecting again from your app");
    if (q.response_type !== "code") throw new Error("unsupported response_type (only code)");
    if (q.code_challenge_method !== "S256" || !q.code_challenge) throw new Error("PKCE S256 is required");
    const cancel = new URL(q.redirect_uri);
    cancel.searchParams.set("error", "access_denied");
    if (q.state) cancel.searchParams.set("state", q.state);
    cancel.searchParams.set("iss", origin(c));
    const token = bearer(c);
    const human = token ? await core.getHumanBySessionToken(c.get("db"), token) : null;
    return c.json({
      ok: true,
      client_name: client.client_name,
      redirect_host: new URL(q.redirect_uri).host || q.redirect_uri,
      suggested_name: await core.suggestAgentName(c.get("db"), client.client_name),
      existing_agent: human ? await core.oauthAgentFor(c.get("db"), human.id, q.client_id) : null,
      cancel_url: cancel.toString(),
    });
  });

  // Consent page, step 2: the signed-in human approves; the app gets a one-time code.
  app.post("/api/oauth/approve", needHuman, limit("strict", "oauth-approve", byHuman), async (c) => {
    const b = await c.req.json().catch(() => ({} as any));
    for (const k of ["client_id", "redirect_uri", "code_challenge", "agent_name"])
      if (typeof b[k] !== "string" || !b[k]) throw new Error(`${k} is required`);
    if (b.code_challenge_method !== "S256") throw new Error("PKCE S256 is required");
    const client = await oauth.resolveClient(b.client_id);
    if (!client || !oauth.redirectAllowed(client, b.redirect_uri)) throw new Error("unknown client or return address");
    const { code, agentName, reused } = await core.createOAuthCode(c.get("db"), {
      humanId: c.get("human").id,
      clientId: b.client_id,
      redirectUri: b.redirect_uri,
      codeChallenge: b.code_challenge,
      agentName: b.agent_name,
      uncappedEmail: reviewerEmail(c.env),
    });
    const back = new URL(b.redirect_uri);
    back.searchParams.set("code", code);
    if (typeof b.state === "string" && b.state) back.searchParams.set("state", b.state);
    back.searchParams.set("iss", origin(c));
    return c.json({ ok: true, redirect: back.toString(), agent_name: agentName, reused });
  });

  const mcpUnauthorized = (c: any) =>
    c.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "sign in to Dabloons first" } }, 401, {
      "WWW-Authenticate": `Bearer resource_metadata="${origin(c)}/.well-known/oauth-protected-resource/mcp", scope="${core.OAUTH_SCOPE}"`,
    });
  // Stateless server: no SSE stream to open, no session to delete.
  app.on(["GET", "DELETE"], "/mcp", (c) => c.body(null, 405, { Allow: "POST" }));
  app.post("/mcp", async (c) => {
    const token = bearer(c);
    if (!token) return mcpUnauthorized(c);
    // Tools run as in-process requests to the API above, with the caller's token.
    const call = async (method: string, path: string, body?: unknown, ip?: string): Promise<any> => {
      const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": "application/json" };
      if (ip) headers["cf-connecting-ip"] = ip;
      const res = await app.request(
        path,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
        c.env,
        c.executionCtx
      );
      return res.json().catch(() => ({ ok: false, error: `Dabloons API returned HTTP ${res.status}` }));
    };
    const me = await call("GET", "/api/agents/me");
    if (!me.ok) return mcpUnauthorized(c);
    // Hosted clients (Claude, ChatGPT) share a few IPs, so the per-IP public
    // read budget is keyed by agent instead.
    const fetchApi = (method: string, path: string, body?: unknown) => call(method, path, body, `mcp:${me.agent.name}`);
    const msg = await c.req.json().catch(() => undefined);
    if (msg === undefined) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
    const version = c.req.header("mcp-protocol-version");
    const replies = (
      await Promise.all((Array.isArray(msg) ? msg : [msg]).map((m) => handleRpc(m, origin(c), fetchApi, version)))
    ).filter((r) => r !== null);
    if (!replies.length) return c.body(null, 202);
    if (Array.isArray(msg)) return c.json(replies.map((r) => r.body));
    return c.json(replies[0].body as object, (replies[0].status ?? 200) as 200);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  return app;
}
