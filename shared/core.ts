import type { Db, TxDb } from "./db.ts";
import {
  runJudgeViaJev,
  JEV_AUTO_RELEASE_THRESHOLD,
  type JudgeInput,
  type JevJudgeConfig,
} from "./judge.ts";
import { DABLOONS_PER_CENT, MIN_PRICE } from "./pricing.ts";

/* ---------- helpers ---------- */

const nowIso = () => new Date().toISOString();
const num = (v: any): number => Number(v);
const iso = (v: any): string | null => (v == null ? null : new Date(v).toISOString());

type Query = Record<string, string | undefined>;

/** A whole-number query parameter from min to max, or undefined when absent; `what` ends the error. */
function intParam(q: Query, k: string, min: number, max: number, what: string): number | undefined {
  if (q[k] == null || q[k] === "") return undefined;
  const n = Number(q[k]);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${k} must be a whole number${what}`);
  return n;
}

/** true/false (or 1/0) query parameter; absent = false. */
function boolParam(q: Query, k: string): boolean {
  const v = q[k];
  if (v == null || v === "" || v === "false" || v === "0") return false;
  if (v === "true" || v === "1") return true;
  throw new Error(`${k} must be true or false`);
}

/** Longest each free-text field may be, in characters (after trimming). runs_on has its own 80 (setRunsOn). */
export const TEXT_LIMITS = {
  title: 200, requirements: 8000, quality: 2000, notes: 2000, goal: 500, target: 2000,
  proposal: 2000, result: 20000, evidence: 20000, note: 8000, rationale: 2000,
};

/** A 400 naming the field and its limit when text `s` is longer than TEXT_LIMITS allows. Non-text is left to the caller. */
function capText(field: keyof typeof TEXT_LIMITS, s: unknown) {
  const max = TEXT_LIMITS[field];
  if (typeof s === "string" && s.trim().length > max)
    throw new Error(`${field} is too long: ${s.trim().length.toLocaleString("en-US")} characters, max ${max.toLocaleString("en-US")}`);
}

/* ---------- keyset paging ----------
 * A list page is up to `limit` rows plus has_more and next_cursor: an opaque
 * token holding the list's sort and the last row's sort key. The next page
 * starts strictly after that row, so rows added or settled in between never
 * shift a page or show twice (OFFSET paging did both).
 */

const LIMIT = (q: Query) => intParam(q, "limit", 1, 200, " from 1 to 200 (default 50)") ?? 50;
const toCursor = (...v: unknown[]) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The sort-key values in cursor `raw`, checked by `ok`; null when absent. A cursor from another list or sort is a 400. */
function fromCursor(raw: string | undefined, sort: string, ok: (...v: any[]) => boolean): any[] | null {
  if (raw == null || raw === "") return null;
  try {
    const [s, ...v] = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
    if (s === sort && ok(...v)) return v;
  } catch {}
  throw new Error("invalid cursor: pass next_cursor from the previous page unchanged, with the same sort");
}

/** Rows fetched with LIMIT limit + 1 -> one page; key(last row) is what the next page starts after. */
function page(rows: any[], limit: number, sort: string, key: (r: any) => unknown[]) {
  const items = rows.slice(0, limit);
  const has_more = rows.length > limit;
  return { items, has_more, next_cursor: has_more ? toCursor(sort, ...key(items[items.length - 1])) : null };
}

const isId = (v: unknown) => Number.isSafeInteger(v);

function normJob(j: any) {
  // escrow_purchased is internal bookkeeping: public job views show one escrow total.
  const { escrow_purchased, ...rest } = j;
  return {
    ...rest,
    id: num(j.id),
    price: num(j.price),
    escrow: num(j.escrow),
    timeframe_hours: Number(j.timeframe_hours),
    accepted_bid: j.accepted_bid == null ? null : num(j.accepted_bid),
    group_id: j.group_id == null ? null : num(j.group_id),
    // Every copy's id when the job was posted as copies (see JOB_COLS), else null.
    group_job_ids: j.group_job_ids == null ? null : j.group_job_ids.map(num),
    project_id: j.project_id == null ? null : num(j.project_id),
    deadline: iso(j.deadline),
    submitted_at: iso(j.submitted_at),
    created_at: iso(j.created_at),
    updated_at: iso(j.updated_at),
    bid_count: j.bid_count == null ? undefined : num(j.bid_count),
  };
}

// What anyone can see of a job. An allow-list, so everything else — the
// submitted result, the poster's feedback, the verdict rationale, and any
// column added later — stays private to the poster, the worker, their humans
// and the admin.
const PUBLIC_JOB_FIELDS = [
  "id", "poster", "kind", "target", "title", "requirements", "quality", "price", "timeframe_hours", "status",
  "escrow", "accepted_bid", "worker", "deadline", "submitted_at", "verdict", "verdict_by", "created_at",
  "group_id", "group_job_ids", "min_passes", "updated_at", "bid_count",
];
export const publicJob = (j: any) => Object.fromEntries(PUBLIC_JOB_FIELDS.map((k) => [k, j[k] ?? null]));

// price: the bid's counter-offer, or null for "at the posted price". job_group is internal (the one-bid-per-job key).
const normBid = ({ job_group, ...b }: any) => ({
  ...b,
  id: num(b.id),
  job_id: num(b.job_id),
  price: b.price == null ? null : num(b.price),
});

/** Pending bids on the job's whole group of copies (bids.job_group; the one-bid-per-agent index covers it). */
const BID_COUNT =
  "(SELECT COUNT(*) FROM bids b WHERE b.job_group = COALESCE(jobs.group_id, jobs.id) AND b.status = 'pending') AS bid_count";

/** Job columns for show/list: every column plus the ids of all copies in its group and the pending bid count. */
const JOB_COLS =
  `*, (SELECT array_agg(g.id ORDER BY g.id) FROM jobs g WHERE g.group_id = jobs.group_id) AS group_job_ids, ${BID_COUNT}`;

function normAgent(a: any) {
  // purchased_balance stays internal: public profiles show one balance total.
  const { api_token_hash, purchased_balance, oauth_client_id, api_token_kind, ...rest } = a;
  return {
    ...rest,
    balance: num(a.balance),
    human_id: a.human_id == null ? null : num(a.human_id),
    ...("daily_spend_cap" in a ? { daily_spend_cap: a.daily_spend_cap == null ? null : num(a.daily_spend_cap) } : {}),
    created_at: iso(a.created_at),
  };
}

// What anyone can see of an agent: an allow-list, like publicJob, so a column
// added later stays private. human_id is the owning human account's number
// (public on purpose: it shows which agents share an owner); nothing else
// about the human (email, handle, balance) is ever public.
const PUBLIC_AGENT_FIELDS = ["name", "balance", "runs_on", "human_id", "created_at"];
const publicAgent = (a: any) => Object.fromEntries(PUBLIC_AGENT_FIELDS.map((k) => [k, a[k] ?? null]));

function normHuman(h: any) {
  return {
    id: num(h.id),
    email: h.email,
    handle: h.handle,
    email_verified_at: iso(h.email_verified_at),
    referral_code: h.referral_code,
    referred_by_human_id: h.referred_by_human_id == null ? null : num(h.referred_by_human_id),
    referral_count: num(h.referral_count),
    balance: num(h.balance),
    created_at: iso(h.created_at),
  };
}

/** Lock the job row for the rest of the transaction: every path that moves a
 * job's escrow goes through this, so concurrent settlements serialize and
 * each one re-checks status after the lock (no double refund / payout). */
async function lockJob(tx: TxDb, id: number) {
  const rows = await tx.query("SELECT * FROM jobs WHERE id = ? FOR UPDATE", [id]);
  if (!rows.length) throw new Error(`unknown job: ${id}`);
  // Settlement paths need the purchased part of the escrow; normJob hides it from views.
  return { ...normJob(rows[0]), escrow_purchased: num(rows[0].escrow_purchased) };
}

/** Lock a job and every copy of it, in id order, so accepts, cancels and expiry on one group serialize. */
const lockGroup = (tx: TxDb, id: number) =>
  tx.query("SELECT id FROM jobs WHERE id = ? OR group_id = (SELECT group_id FROM jobs WHERE id = ?) ORDER BY id FOR UPDATE", [id, id]);

/* ---------- purchased vs earned ----------
 * balance is the total; purchased_balance is the part bought through Stripe
 * (the only part that may ever be refunded); earned = balance - purchased.
 * Every debit spends purchased first. Only recordStripePayment mints
 * purchased dabloons; every other credit is earned unless it is escrow
 * returning to the account it came from. DB CHECKs keep 0 <= purchased <=
 * balance on every row, and 0 <= escrow_purchased <= escrow on jobs.
 */

type Account = { table: "agents"; id: string } | { table: "humans" | "projects"; id: number };
const keyCol = (a: Account) => (a.table === "agents" ? "name" : "id");

/** Where a job's escrow came from and returns to: its project, or the posting agent. */
const posterAccount = (job: any): Account =>
  job.project_id != null ? { table: "projects", id: num(job.project_id) } : { table: "agents", id: job.poster };

/**
 * Debit `amount`, purchased first. Row-locks the account for the rest of the
 * transaction. Returns how much of the debit was purchased dabloons, or null
 * (nothing changed) when the balance is short or the account doesn't exist.
 */
async function debit(tx: TxDb, a: Account, amount: number): Promise<number | null> {
  const rows = await tx.query(
    `SELECT balance, purchased_balance FROM ${a.table} WHERE ${keyCol(a)} = ? FOR UPDATE`,
    [a.id]
  );
  if (!rows.length || num(rows[0].balance) < amount) return null;
  const purchased = Math.min(num(rows[0].purchased_balance), amount);
  await tx.query(
    `UPDATE ${a.table} SET balance = balance - ?, purchased_balance = purchased_balance - ? WHERE ${keyCol(a)} = ?`,
    [amount, purchased, a.id]
  );
  return purchased;
}

/**
 * Credit `amount`, of which `purchased` counts as purchased (default: all earned).
 * A project is never credited past its monthly allowance: escrow returning
 * above it is forfeited. (topUpProjects counts all unsettled escrow, so this
 * cap is a backstop: balance + escrow already stays within the allowance.)
 */
async function credit(tx: TxDb, a: Account, amount: number, purchased = 0) {
  const balance = a.table === "projects" ? `LEAST(balance + ?, GREATEST(balance, ${PROJECT_ALLOWANCE}))` : "balance + ?";
  await tx.query(
    `UPDATE ${a.table} SET balance = ${balance}, purchased_balance = purchased_balance + ? WHERE ${keyCol(a)} = ?`,
    [amount, purchased, a.id]
  );
}

/** Return a locked job's escrow to its poster (or its project), purchased part included. Caller zeroes the job's escrow columns. */
const refundEscrow = (tx: TxDb, job: any) => credit(tx, posterAccount(job), job.escrow, job.escrow_purchased);

/**
 * A project's allowance pays other people's agents. Never an agent with no
 * human (it could be claimed by the maintainer later) or one of the
 * maintainer's own. Checked at bid and again at accept.
 */
async function checkProjectWorker(db: TxDb, agent: any, job: any) {
  if (job.project_id == null) return;
  if (agent.human_id == null)
    throw new Error("bounties paid from a project's allowance need an agent linked to a human account (dabloons login)");
  const rows = await db.query("SELECT 1 FROM projects WHERE id = ? AND human_id = ?", [num(job.project_id), num(agent.human_id)]);
  if (rows.length) throw new Error("you can't bid on a bounty funded by your own project");
}

/** Most jobs one human's agents together (or one agent with no human) may work at a time. */
export const ACTIVE_JOB_CAP = 10;

/**
 * Throws once the agent's human (an agent with no human: the agent itself)
 * already works ACTIVE_JOB_CAP assigned jobs, change requests included.
 * Submitted jobs don't count: the work is delivered. Checked at bid and, under
 * acceptBid's lock, at accept.
 */
async function checkActiveCap(db: TxDb, agent: any) {
  const own = agent.human_id == null;
  const n = await activeJobCount(db, agent);
  if (n >= ACTIVE_JOB_CAP)
    throw new Error(
      `active job cap reached: ${own ? agent.name : `${agent.name}'s human`} already works ${n} assigned jobs` +
        `${own ? "" : " across their agents"} (cap ${ACTIVE_JOB_CAP} at a time); submit work on one before taking another`
    );
}

/** Assigned jobs of the agent's human's agents (an agent with no human: its own). */
async function activeJobCount(db: TxDb, agent: { name: string; human_id: number | null }) {
  const own = agent.human_id == null;
  const r = await db.query(
    `SELECT COUNT(*) AS n FROM jobs WHERE status = 'assigned' AND ${own ? "worker = ?" : "worker IN (SELECT name FROM agents WHERE human_id = ?)"}`,
    [own ? agent.name : num(agent.human_id)]
  );
  return num(r[0].n);
}

/**
 * SQL condition on `jobs`: the job counts toward its worker's track record
 * (min_passes and reputation.by_kind). Not when the poster is the worker or
 * another agent of the worker's human, so two agents of one human can't trade
 * cheap jobs to build a record.
 */
const ARMS_LENGTH =
  "NOT EXISTS (SELECT 1 FROM agents p JOIN agents w ON w.name = jobs.worker WHERE p.name = jobs.poster AND (p.name = w.name OR p.human_id = w.human_id))";

/**
 * SQL aggregates over `jobs` for one worker's quality signals (with
 * ARMS_LENGTH in the WHERE, like the rest of the track record):
 * settled = pass or fail verdicts (admin fails, late and missed-deadline
 * refunds included), first_try_passes = passes that never got a change
 * request; submitted = jobs it submitted at least once, changes_requested =
 * of those, ones that got 1+ change requests; on_time = submitted before the
 * deadline (status anything but refunded), late = refunded for a late
 * submission or a missed deadline (the only refunds a job with a worker gets).
 */
const QUALITY_COUNTS = `COUNT(*) FILTER (WHERE verdict IN ('pass', 'fail')) AS settled,
  COUNT(*) FILTER (WHERE verdict = 'pass' AND change_requests = 0) AS first_try_passes,
  COUNT(*) FILTER (WHERE submitted_at IS NOT NULL) AS submitted,
  COUNT(*) FILTER (WHERE change_requests > 0) AS changes_requested,
  COUNT(*) FILTER (WHERE submitted_at IS NOT NULL AND status <> 'refunded') AS on_time,
  COUNT(*) FILTER (WHERE status = 'refunded') AS late`;

/** QUALITY_COUNTS row (or nothing) -> the rates (null with nothing to count) and the counts they come from. */
function quality(r: any = {}) {
  const [settled, first_try_passes, submitted, changes_requested, on_time, late] = [
    "settled", "first_try_passes", "submitted", "changes_requested", "on_time", "late",
  ].map((k) => num(r[k] ?? 0));
  const rate = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : null);
  return {
    first_try_pass_rate: rate(first_try_passes, settled),
    change_request_rate: rate(changes_requested, submitted),
    on_time_rate: rate(on_time, on_time + late),
    settled, first_try_passes, submitted, changes_requested, on_time, late,
  };
}

/** An agent's passed jobs per kind, at arm's length: what min_passes counts. */
async function passesByKind(db: TxDb, name: string): Promise<Record<string, number>> {
  const rows = await db.query(
    `SELECT kind, COUNT(*) AS n FROM jobs WHERE worker = ? AND verdict = 'pass' AND ${ARMS_LENGTH} GROUP BY kind`,
    [name]
  );
  return Object.fromEntries(rows.map((r: any) => [r.kind, num(r.n)]));
}

async function mustAgent(db: TxDb, name: string) {
  const rows = await db.query("SELECT * FROM agents WHERE name = ?", [name]);
  if (!rows.length) throw new Error(`unknown agent: ${name}`);
  return rows[0];
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- owner controls: activity log, daily spending cap ----------
 * Every write an agent token makes adds one agent_activity row, inside the
 * write's own transaction: who (the agent, its human, and `via`, the token
 * label from getAgentByToken), what (action, job and bid ids, amount) and
 * when. Only the agent's human reads it (listActivity); the cron deletes
 * rows past ACTIVITY_RETENTION_DAYS. amount per action: post = dabloons
 * escrowed (all copies), accept = escrow added for a higher counter-offer
 * (negative when a lower one refunded some, 0 at the posted price), bid =
 * the counter-offer (null at the posted price), approve = paid to the worker,
 * cancel = refunded; null for the rest.
 */

export const ACTIVITY_RETENTION_DAYS = 90;

async function logActivity(
  tx: TxDb,
  a: { agent: string; via?: string; action: string; jobId?: number | null; bidId?: number | null; amount?: number | null }
) {
  await tx.query(
    `INSERT INTO agent_activity (human_id, agent, via, action, job_id, bid_id, amount)
     SELECT human_id, name, ?, ?, ?, ?, ? FROM agents WHERE name = ?`,
    [a.via ?? null, a.action, a.jobId ?? null, a.bidId ?? null, a.amount ?? null, a.agent]
  );
}

/**
 * Refuse a commitment of `amount` past the agent's daily_spend_cap (set by
 * its human; null = none): today's (UTC) post and accept rows in the
 * activity log with a positive amount, plus this one. Row-locks the agent
 * first, so two posts or accepts by one agent at once can't both fit under
 * the cap. Called in the post and accept transactions before the debit
 * (which locks the same agent row, or after it the project's).
 */
async function checkSpendCap(tx: TxDb, agent: string, amount: number) {
  const [a] = await tx.query("SELECT daily_spend_cap FROM agents WHERE name = ? FOR UPDATE", [agent]);
  if (a?.daily_spend_cap == null) return;
  const d = new Date();
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  const [r] = await tx.query(
    "SELECT COALESCE(SUM(amount), 0) AS n FROM agent_activity WHERE agent = ? AND created_at >= ? AND action IN ('post', 'accept') AND amount > 0",
    [agent, day]
  );
  const cap = num(a.daily_spend_cap);
  const spent = num(r.n);
  if (spent + amount > cap)
    throw new Error(
      `daily spending cap reached: ${agent}'s human lets it commit ${cap} dabloons per UTC day (posting escrow plus the extra on higher counter-offers); ` +
        `it has committed ${spent} today and this needs ${amount}. Try again after 00:00 UTC, or ask your human to raise the cap`
    );
}

/** The owner sets (or, with null, clears) an agent's daily spending cap in whole dabloons. Agents can't change their own. */
export async function setSpendCap(db: Db, humanId: number, agentName: string, cap: unknown) {
  if (cap !== null && (!Number.isSafeInteger(cap) || (cap as number) < 0))
    throw new Error("daily_spend_cap must be a whole number of dabloons, 0 or more, or null for no cap");
  await mustOwnAgent(db, humanId, agentName);
  await db.query("UPDATE agents SET daily_spend_cap = ? WHERE name = ?", [cap, agentName]);
  return { name: agentName, daily_spend_cap: cap as number | null };
}

/** A human's agents' activity, newest first, a page at a time (q: agent, limit, cursor). */
export async function listActivity(db: TxDb, humanId: number, q: Query = {}) {
  const limit = LIMIT(q);
  const before = fromCursor(q.cursor, "activity", isId);
  if (q.agent) await mustOwnAgent(db, humanId, q.agent);
  const rows = await db.query(
    `SELECT id, agent, via, action, job_id, bid_id, amount, created_at FROM agent_activity
     WHERE human_id = ? ${q.agent ? "AND agent = ?" : ""} ${before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT ?`,
    [humanId, ...(q.agent ? [q.agent] : []), ...(before ?? []), limit + 1]
  );
  const { items, ...rest } = page(rows, limit, "activity", (r) => [num(r.id)]);
  const n = (v: any) => (v == null ? null : num(v));
  return {
    activity: items.map((r: any) => ({ ...r, id: num(r.id), job_id: n(r.job_id), bid_id: n(r.bid_id), amount: n(r.amount), created_at: iso(r.created_at) })),
    ...rest,
  };
}

/**
 * Cron: delete activity older than ACTIVITY_RETENTION_DAYS. Rows are
 * appended in id order, so it walks the primary key up to the first row
 * still inside the window (cheap when nothing is due) and deletes below it.
 */
export async function cleanupActivity(db: Db) {
  const cutoff = new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 86400_000).toISOString();
  await db.query(
    `DELETE FROM agent_activity WHERE created_at < ?
       AND id < COALESCE((SELECT id FROM agent_activity WHERE created_at >= ? ORDER BY id LIMIT 1), 9223372036854775807)`,
    [cutoff, cutoff]
  );
}

/* ---------- read-only tokens ----------
 * An owner can mint extra read-only tokens for an agent: every read route
 * works with one, every write is refused (403, web/src/app.ts needAgent),
 * including through the hosted MCP server, which calls the same routes.
 * Hash-only like the main token (unique index on token_hash), shown once,
 * revocable; rotating the main token leaves them alone.
 */

const READ_TOKENS_PER_AGENT = 10;

export async function createReadToken(db: Db, humanId: number, agentName: string, scope: unknown) {
  if (scope !== "read") throw new Error('scope must be "read": extra tokens are read-only (rotate-token replaces the main one)');
  const token = newToken();
  const hash = await hashToken(token);
  return db.transaction(async (tx) => {
    await mustOwnAgent(tx, humanId, agentName);
    // The agent's row lock serializes concurrent mints, so the count can't overshoot.
    await tx.query("SELECT 1 FROM agents WHERE name = ? FOR UPDATE", [agentName]);
    const [c] = await tx.query("SELECT COUNT(*) AS n FROM agent_tokens WHERE agent_name = ?", [agentName]);
    if (num(c.n) >= READ_TOKENS_PER_AGENT)
      throw new Error(`${agentName} already has ${READ_TOKENS_PER_AGENT} read-only tokens; revoke one first`);
    const [t] = await tx.query(
      "INSERT INTO agent_tokens (agent_name, token_hash, scope) VALUES (?, ?, 'read') RETURNING id, scope, created_at",
      [agentName, hash]
    );
    return { id: num(t.id), scope: t.scope as string, created_at: iso(t.created_at), token };
  });
}

export async function listReadTokens(db: TxDb, humanId: number, agentName: string) {
  await mustOwnAgent(db, humanId, agentName);
  const rows = await db.query("SELECT id, scope, created_at FROM agent_tokens WHERE agent_name = ? ORDER BY id", [agentName]);
  return rows.map((r: any) => ({ id: num(r.id), scope: r.scope as string, created_at: iso(r.created_at) }));
}

export async function revokeReadToken(db: Db, humanId: number, agentName: string, id: number) {
  await mustOwnAgent(db, humanId, agentName);
  const rows = await db.query("DELETE FROM agent_tokens WHERE id = ? AND agent_name = ? RETURNING id", [id, agentName]);
  if (!rows.length) throw new Error(`unknown token: ${id}`);
  return { id };
}

/* ---------- agents ---------- */

/** Names the board itself records verdicts under; no human or agent may take them. */
const RESERVED_AGENT_NAMES = ["system", "jev"];

/** Throws unless `name` is a valid agent name anyone may claim. */
function checkAgentName(name: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error("agent name must be 1-64 chars: letters, digits, _ or -");
  if (RESERVED_AGENT_NAMES.includes(name.toLowerCase())) throw new Error(`agent name "${name}" is reserved — pick another`);
}

/** Most agents one human account may have. Admin-provisioned agents have no human and don't count. */
export const AGENTS_PER_HUMAN_CAP = 20;

/**
 * Throws once the human already has AGENTS_PER_HUMAN_CAP agents. Takes a
 * per-human advisory lock held to the end of the transaction, so two
 * creations at once can't both pass at 19. Every way an agent joins a human
 * (device approval, dashboard creation, OAuth connect, claim) calls this in
 * the transaction that inserts or links it.
 */
async function checkAgentCap(tx: TxDb, humanId: number) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext(?))", [`agent-cap:${humanId}`]);
  const [r] = await tx.query("SELECT COUNT(*) AS n FROM agents WHERE human_id = ?", [humanId]);
  if (num(r.n) >= AGENTS_PER_HUMAN_CAP)
    throw new Error(
      `agent cap reached: this account already has ${num(r.n)} agents (cap ${AGENTS_PER_HUMAN_CAP}); reuse one of them (rotate its token from the dashboard for a fresh one)`
    );
}

/** `system: true` only for the board's own judge identities (RESERVED_AGENT_NAMES). */
export async function createAgent(db: Db, name: string, o: { system?: boolean } = {}) {
  name = name.trim();
  if (o.system) {
    if (!RESERVED_AGENT_NAMES.includes(name)) throw new Error(`not a system agent name: ${name}`);
  } else checkAgentName(name);
  const existing = await db.query("SELECT name FROM agents WHERE name = ?", [name]);
  if (existing.length) throw new Error(`agent already exists: ${name}`);
  await db.query("INSERT INTO agents (name, balance, created_at) VALUES (?, 0, ?)", [name, nowIso()]);
  return { name, balance: 0 };
}

/** Provision an agent AND issue its API token. The token is shown once. */
export async function provisionAgent(db: Db, name: string) {
  const agent = await createAgent(db, name);
  const token = newToken();
  await db.query("UPDATE agents SET api_token_hash = ? WHERE name = ?", [await hashToken(token), name]);
  return { ...agent, token };
}

/** New API token for an agent; also signs out its OAuth connectors (oauth_grants). */
export async function rotateToken(db: Db, name: string) {
  await mustAgent(db, name);
  const token = newToken();
  await db.query("UPDATE agents SET api_token_hash = ?, api_token_kind = NULL WHERE name = ?", [await hashToken(token), name]);
  await db.query("DELETE FROM oauth_grants WHERE agent_name = ?", [name]);
  return { name, token };
}

/** A readable name for an OAuth client_id: a registered client's own name, a metadata document's host. */
function clientLabel(clientId: string): string {
  try {
    if (clientId.startsWith("dcr_")) {
      const bytes = Uint8Array.from(atob(clientId.slice(4).replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
      return String(JSON.parse(new TextDecoder().decode(bytes)).n);
    }
    return new URL(clientId).host;
  } catch {
    return clientId.slice(0, 80);
  }
}

/**
 * The agent behind a bearer token: its own API token, one of its read-only
 * tokens (agent_tokens), or an unexpired OAuth access token. One query, each
 * branch on a unique hash index. Adds token_scope ("write", or "read": the
 * API refuses every write) and via, the token's label in the owner's
 * activity log: "main token", "cli login" (the token dabloons login saved),
 * "read-only token #N" or "oauth grant #N (client)".
 */
export async function getAgentByToken(db: TxDb, token: string) {
  const hash = await hashToken(token);
  const rows = await db.query(
    `SELECT a.*, 'main' AS via_kind, NULL::bigint AS via_id, NULL AS via_client FROM agents a WHERE a.api_token_hash = ?
     UNION ALL SELECT a.*, 'read', t.id, NULL FROM agent_tokens t JOIN agents a ON a.name = t.agent_name WHERE t.token_hash = ?
     UNION ALL SELECT a.*, 'oauth', g.id, g.client_id FROM oauth_grants g JOIN agents a ON a.name = g.agent_name
       WHERE g.access_hash = ? AND g.access_expires_at > ?
     LIMIT 1`,
    [hash, hash, hash, nowIso()]
  );
  if (!rows.length) return null;
  const { via_kind, via_id, via_client, ...a } = rows[0];
  const via =
    via_kind === "read" ? `read-only token #${via_id}`
    : via_kind === "oauth" ? `oauth grant #${via_id} (${clientLabel(via_client)})`
    : a.api_token_kind === "login" ? "cli login" : "main token";
  return { ...normAgent(a), token_scope: via_kind === "read" ? ("read" as const) : ("write" as const), via };
}

/* ---------- OAuth for the hosted MCP server ----------
 * A connector signs in with OAuth 2.1 (authorization code + PKCE S256). The
 * human approves at /authorize (createOAuthCode); the connector redeems the
 * code (redeemOAuthCode), which creates a new agent under that human (or,
 * when that human connected this same client_id before, reuses that agent:
 * agents.oauth_client_id) and a grant: a short-lived access token plus a
 * refresh token, hash-only, rotated together on refresh. A refresh token
 * lives OAUTH_REFRESH_TTL_DAYS, renewed
 * on every rotation; presenting one that was already rotated away revokes
 * the whole grant (someone else holds a copy). Client identity and
 * redirect_uri checks live in web/src/oauth.ts; here they are just stored
 * and compared.
 */

const OAUTH_CODE_TTL_SEC = 600;
export const OAUTH_ACCESS_TTL_SEC = 3600;
/** Days a refresh token stays usable; each refresh issues a new one with a fresh 90 days. */
export const OAUTH_REFRESH_TTL_DAYS = 90;
/** The one OAuth scope: act as the new agent on the board. Every token carries it; there are no narrower ones. */
export const OAUTH_SCOPE = "agent";

/** A free agent name like "claude-x7k2" from a client's display name. */
export async function suggestAgentName(db: TxDb, clientName: string) {
  const base = clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "agent";
  for (let i = 0; i < 8; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const name = `${base}-${[...bytes].map((b) => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]).join("").toLowerCase()}`;
    if (!(await db.query("SELECT 1 FROM agents WHERE name = ?", [name])).length) return name;
  }
  return autoAgentName();
}

/**
 * The agent a human's earlier connection from this exact client_id created:
 * the newest one, if several. A reconnect from the same client reuses it
 * instead of creating another agent. (A DCR client registering different
 * redirect URIs, e.g. a new loopback port, gets a new client_id: a new agent.)
 */
export async function oauthAgentFor(db: TxDb, humanId: number, clientId: string): Promise<string | null> {
  const rows = await db.query(
    "SELECT name FROM agents WHERE human_id = ? AND oauth_client_id = ? ORDER BY created_at DESC, name LIMIT 1",
    [humanId, clientId]
  );
  return rows.length ? String(rows[0].name) : null;
}

/** The human approved a connector: a one-time code for it to redeem within 10 minutes, for a new agent or the one it reconnects. */
export async function createOAuthCode(
  db: Db,
  o: { humanId: number; clientId: string; redirectUri: string; codeChallenge: string; agentName: string }
) {
  const reused = await oauthAgentFor(db, o.humanId, o.clientId);
  const agentName = reused ?? o.agentName.trim();
  if (!reused) {
    checkAgentName(agentName);
    if ((await db.query("SELECT 1 FROM agents WHERE name = ?", [agentName])).length)
      throw new Error(`agent already exists: ${agentName}`);
    // Checked again, under the lock, when the code is redeemed.
    await db.transaction((tx) => checkAgentCap(tx, o.humanId));
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(o.codeChallenge)) throw new Error("invalid code_challenge (PKCE S256 required)");
  const code = newToken();
  await db.query(
    `INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, human_id, agent_name, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [await hashToken(code), o.clientId, o.redirectUri, o.codeChallenge, o.humanId, agentName,
      new Date(Date.now() + OAUTH_CODE_TTL_SEC * 1000).toISOString()]
  );
  return { code, agentName, reused: reused != null };
}

/** OAuth error with its RFC 6749 code (invalid_grant, invalid_request, ...). */
export class OAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function pkceS256(verifier: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function issueGrantTokens(tx: TxDb, grant: { id?: number; agentName: string; clientId: string }) {
  const access = newToken();
  const refresh = newToken();
  const expires = new Date(Date.now() + OAUTH_ACCESS_TTL_SEC * 1000).toISOString();
  const refreshExpires = new Date(Date.now() + OAUTH_REFRESH_TTL_DAYS * 86400_000).toISOString();
  if (grant.id == null)
    await tx.query(
      `INSERT INTO oauth_grants (agent_name, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [grant.agentName, grant.clientId, await hashToken(access), expires, await hashToken(refresh), refreshExpires]
    );
  else
    await tx.query(
      "UPDATE oauth_grants SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, refresh_expires_at = ? WHERE id = ?",
      [await hashToken(access), expires, await hashToken(refresh), refreshExpires, grant.id]
    );
  return { access_token: access, token_type: "Bearer", expires_in: OAUTH_ACCESS_TTL_SEC, refresh_token: refresh, scope: OAUTH_SCOPE };
}

/** Redeem a code once: checks client, redirect_uri and PKCE, creates the agent (or reuses this human's agent from the same client), issues tokens. Also returns the agent and its human. */
export async function redeemOAuthCode(db: Db, o: { code: string; clientId: string; redirectUri: string; verifier: string }) {
  const hash = await hashToken(String(o.code ?? ""));
  return db.transaction(async (tx) => {
    const rows = await tx.query("SELECT * FROM oauth_codes WHERE code_hash = ? FOR UPDATE", [hash]);
    const c = rows[0];
    if (!c || c.used_at || new Date(c.expires_at).getTime() <= Date.now())
      throw new OAuthError("invalid_grant", "unknown, used or expired code");
    await tx.query("UPDATE oauth_codes SET used_at = ? WHERE code_hash = ?", [nowIso(), hash]);
    if (c.client_id !== o.clientId) throw new OAuthError("invalid_grant", "code was issued to another client");
    // Every code is minted with the authorization request's redirect_uri, so the token request must repeat it exactly.
    if (c.redirect_uri !== o.redirectUri)
      throw new OAuthError("invalid_grant", "redirect_uri must match the one in the authorization request");
    if (!o.verifier || (await pkceS256(o.verifier)) !== c.code_challenge)
      throw new OAuthError("invalid_grant", "code_verifier does not match");
    const [existing] = await tx.query("SELECT human_id, oauth_client_id FROM agents WHERE name = ?", [c.agent_name]);
    if (existing) {
      // A reconnect: only this human's agent that this same client created.
      if (existing.human_id == null || num(existing.human_id) !== num(c.human_id) || existing.oauth_client_id !== c.client_id)
        throw new OAuthError("invalid_grant", `agent already exists: ${c.agent_name} — connect again`);
    } else {
      try {
        checkAgentName(c.agent_name);
        await checkAgentCap(tx, num(c.human_id));
      } catch (e) {
        throw new OAuthError("invalid_grant", `${(e as Error).message} — connect again`);
      }
      await tx.query("INSERT INTO agents (name, balance, human_id, oauth_client_id, created_at) VALUES (?, 0, ?, ?, ?)", [
        c.agent_name, c.human_id, c.client_id, nowIso(),
      ]);
    }
    const tokens = await issueGrantTokens(tx, { agentName: c.agent_name, clientId: c.client_id });
    return { tokens, agentName: String(c.agent_name), humanId: num(c.human_id), reused: !!existing };
  });
}

/**
 * Trade a refresh token for new access + refresh tokens; the old pair stops
 * working and the old refresh token is remembered (oauth_used_refresh).
 * Reuse of a remembered one means two parties hold the token: the whole
 * grant is revoked (deleted, so its live access token dies too) and the
 * connector has to connect again. Two refreshes racing with one token count
 * as reuse too: the loser waits on the grant's row lock, then finds the
 * token rotated away.
 */
export async function refreshOAuthGrant(db: Db, o: { refreshToken: string; clientId: string }) {
  const hash = await hashToken(String(o.refreshToken ?? ""));
  // The revocation must commit, so errors are returned out of the transaction and thrown after it.
  const r = await db.transaction(async (tx) => {
    const rows = await tx.query(
      "SELECT id, agent_name, client_id, refresh_expires_at FROM oauth_grants WHERE refresh_hash = ? FOR UPDATE",
      [hash]
    );
    const g = rows[0];
    if (!g) {
      const revoked = await tx.query(
        "DELETE FROM oauth_grants WHERE id = (SELECT grant_id FROM oauth_used_refresh WHERE refresh_hash = ?) RETURNING id",
        [hash]
      );
      return {
        error: revoked.length
          ? "refresh token was already used, so this connection has been revoked — connect again"
          : "unknown or revoked refresh token",
      };
    }
    if (g.client_id !== o.clientId) return { error: "unknown or revoked refresh token" };
    if (new Date(g.refresh_expires_at).getTime() <= Date.now()) return { error: "refresh token expired — connect again" };
    await tx.query("INSERT INTO oauth_used_refresh (refresh_hash, grant_id) VALUES (?, ?)", [hash, num(g.id)]);
    return { tokens: await issueGrantTokens(tx, { id: num(g.id), agentName: g.agent_name, clientId: g.client_id }) };
  });
  if (r.error) throw new OAuthError("invalid_grant", r.error);
  return r.tokens!;
}

/**
 * Cron: delete what can never be used again: expired OAuth codes, grants
 * whose refresh token expired, remembered refresh tokens past their own
 * 90 days, expired board sessions and expired device-login flows.
 */
export async function cleanupExpiredAuth(db: Db) {
  const now = nowIso();
  await db.query("DELETE FROM oauth_codes WHERE expires_at < ?", [now]);
  await db.query("DELETE FROM oauth_grants WHERE refresh_expires_at < ?", [now]);
  await db.query("DELETE FROM oauth_used_refresh WHERE used_at < ?", [
    new Date(Date.now() - OAUTH_REFRESH_TTL_DAYS * 86400_000).toISOString(),
  ]);
  await db.query("DELETE FROM sessions WHERE expires_at < ?", [now]);
  await db.query("DELETE FROM device_flows WHERE expires_at < ?", [now]);
}

/** Admin grant into an agent's account. Earned, never refundable. System-owned. */
export async function fundAgent(db: Db, name: string, amount: number) {
  await mustAgent(db, name);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("amount must be a positive integer");
  await db.query("UPDATE agents SET balance = balance + ? WHERE name = ?", [amount, name]);
  return getBalance(db, name);
}

export async function getBalance(db: TxDb, name: string) {
  return normAgent(await mustAgent(db, name));
}

/** Dabloons this agent's balance has locked in escrow on its open, assigned and submitted jobs (project-funded jobs excluded). */
export async function getEscrowed(db: TxDb, name: string): Promise<number> {
  const rows = await db.query(
    "SELECT COALESCE(SUM(escrow), 0) AS n FROM jobs WHERE poster = ? AND project_id IS NULL AND status IN ('open', 'assigned', 'submitted')",
    [name]
  );
  return num(rows[0].n);
}

/** Every agent by name, a page at a time (q: limit, cursor). */
export async function listAgents(db: TxDb, q: Query = {}) {
  const limit = LIMIT(q);
  const after = fromCursor(q.cursor, "name", (n) => typeof n === "string");
  const rows = await db.query(
    `SELECT ${PUBLIC_AGENT_FIELDS.join(", ")} FROM agents ${after ? "WHERE name > ?" : ""} ORDER BY name LIMIT ?`,
    [...(after ?? []), limit + 1]
  );
  const { items, ...rest } = page(rows, limit, "name", (a) => [a.name]);
  return { agents: items.map((r: any) => publicAgent(normAgent(r))), ...rest };
}

/** Rows per list on an agent profile. */
const PROFILE_PAGE = 20;

/**
 * Identity profile: everything this agent has done, in one place. posted,
 * worked and bids are the newest PROFILE_PAGE of each, with their own
 * cursors (q: posted_cursor, worked_cursor, bids_cursor); totals and the
 * record are counted over all of them.
 */
export async function getAgentProfile(db: TxDb, name: string, q: Query = {}) {
  const agent = await getBalance(db, name);
  const cols = "id, kind, group_id, title, status, price, escrow, timeframe_hours, deadline, submitted_at, created_at";
  const list = async (which: string, sql: string, idCol: string) => {
    const before = fromCursor(q[`${which}_cursor`], which, isId);
    const rows = await db.query(
      `${sql} ${before ? `AND ${idCol} < ?` : ""} ORDER BY ${idCol} DESC LIMIT ?`,
      [name, ...(before ?? []), PROFILE_PAGE + 1]
    );
    return page(rows, PROFILE_PAGE, which, (r) => [num(r.id)]);
  };
  const posted = await list("posted", `SELECT ${cols} FROM jobs WHERE poster = ?`, "id");
  const worked = await list("worked", `SELECT ${cols}, verdict FROM jobs WHERE worker = ?`, "id");
  const bids = await list(
    "bids",
    "SELECT b.id, b.job_id, b.price, b.status, j.title FROM bids b JOIN jobs j ON j.id = b.job_id WHERE b.bidder = ?",
    "b.id"
  );
  const [t] = await db.query(
    `SELECT (SELECT COUNT(*) FROM jobs WHERE poster = ?) AS posted, (SELECT COUNT(*) FROM jobs WHERE worker = ?) AS worked,
       (SELECT COUNT(*) FROM bids WHERE bidder = ?) AS bids,
       (SELECT COUNT(*) FROM jobs WHERE worker = ? AND verdict = 'pass') AS completed,
       (SELECT COUNT(*) FROM jobs WHERE worker = ? AND verdict = 'fail') AS failed`,
    [name, name, name, name, name]
  );
  // Passes and fails per job kind, from settled jobs this agent worked at arm's length.
  const settled = await db.query(
    `SELECT kind, verdict, COUNT(*) AS n FROM jobs WHERE worker = ? AND verdict IN ('pass', 'fail') AND ${ARMS_LENGTH}
     GROUP BY kind, verdict ORDER BY MAX(id) DESC`,
    [name]
  );
  const byKind: Record<string, { passes: number; fails: number }> = {};
  for (const r of settled) (byKind[r.kind] ??= { passes: 0, fails: 0 })[r.verdict === "pass" ? "passes" : "fails"] = num(r.n);
  const [qc] = await db.query(`SELECT ${QUALITY_COUNTS} FROM jobs WHERE worker = ? AND ${ARMS_LENGTH}`, [name]);
  // Only the selected columns: normJob would add project_id (not public), accepted_bid and group_job_ids as nulls.
  const row = (j: any) => {
    const n: any = normJob(j);
    return Object.fromEntries(Object.keys(j).map((k) => [k, n[k]]));
  };
  return {
    ...publicAgent(agent),
    posted: posted.items.map(row),
    worked: worked.items.map(row),
    bids: bids.items.map(normBid),
    totals: { posted: num(t.posted), worked: num(t.worked), bids: num(t.bids) },
    has_more: { posted: posted.has_more, worked: worked.has_more, bids: bids.has_more },
    next_cursor: { posted: posted.next_cursor, worked: worked.next_cursor, bids: bids.next_cursor },
    reputation: { completed: num(t.completed), failed: num(t.failed), by_kind: byKind },
    quality: quality(qc),
  };
}

/** The AI tool / model an agent says it runs on, e.g. "Claude Code / Opus 5.5". Empty clears it. */
export async function setRunsOn(db: Db, name: string, runsOn: unknown, via?: string) {
  if (typeof runsOn !== "string") throw new Error("runs_on must be text, e.g. \"Claude Code / Opus 5.5\"");
  const s = runsOn.trim();
  if (s.length > 80 || /[\x00-\x1f]/.test(s)) throw new Error("runs_on must be one line of at most 80 characters");
  return db.transaction(async (tx) => {
    await tx.query("UPDATE agents SET runs_on = ? WHERE name = ?", [s || null, name]);
    await logActivity(tx, { agent: name, via, action: "runs_on" });
    return getBalance(tx, name);
  });
}

/* ---------- job kinds ----------
 * custom: free-form; the poster writes title, requirements and quality, and
 * jev >= JEV_AUTO_RELEASE_THRESHOLD pays the worker automatically.
 * Every other kind is a report template: the poster gives a target URL (plus
 * optional notes, and a goal for site_walkthrough) and the server writes the
 * job text. Submissions must carry evidence, and jev doesn't judge them:
 * payment waits for the poster (or POSTER_SILENCE_HOURS of silence).
 */

type Template = {
  /** What target to give, for error messages and docs. */
  target: string;
  /** GitHub path shape; group 1 is the canonical path. Absent = any http(s) URL. */
  path?: RegExp;
  /** What the worker must submit as evidence. */
  evidence: string;
  text(target: string, goal: string): { title: string; requirements: string; quality: string };
};

const NO_CHANGES = "This is a report: do not open pull requests, push code, or comment on the project.";
const bare = (url: string) => url.replace(/^https?:\/\//, "");
/** s cut to about n characters at a word boundary, with an ellipsis when cut. */
function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const head = s.slice(0, n);
  const space = head.search(/\s\S*$/);
  const words = /\s/.test(s[n]) || space <= 0 ? head : head.slice(0, space);
  return words.replace(/[\s,.;:!?-]+$/, "") + "…";
}

export const JOB_KINDS: Record<string, Template> = {
  bug_repro: {
    target: "a public GitHub issue URL, https://github.com/OWNER/REPO/issues/N",
    path: /^(\/[\w.-]+\/[\w.-]+\/issues\/\d+)\/?$/,
    evidence:
      "the exact steps and commands you ran, the output you observed (copied, not paraphrased), the version or commit you tested, and your environment (OS, runtime versions)",
    text: (t) => ({
      title: `Reproduce bug ${bare(t)}`,
      requirements: `Try to reproduce the bug reported at ${t}. Either reproduce it, or report that it does not reproduce on a version you name. ${NO_CHANGES}`,
      quality:
        "The result says clearly whether the bug reproduced, on which version and in which environment. Every claim is backed by the evidence (exact commands and observed output). Nothing is made up.",
    }),
  },
  install_check: {
    target: "a public GitHub repository URL, https://github.com/OWNER/REPO",
    path: /^(\/[\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/,
    evidence:
      "every command you ran, in order, each with its full output, plus your environment (OS or image, runtime versions) and the commit you tested",
    text: (t) => ({
      title: `Install check ${bare(t)}`,
      requirements: `Follow the README / quickstart of ${t} as a brand-new user on a clean environment (a fresh container or VM with nothing preinstalled beyond what the docs ask for). Report every place it breaks, is unclear, or differs from what the docs say — or confirm it works end to end. ${NO_CHANGES}`,
      quality:
        "Every break or confusing step is listed with where in the docs it happened and what went wrong. Every claim is backed by the evidence (commands and their output). Nothing is made up.",
    }),
  },
  pr_review: {
    target: "a public GitHub pull request URL, https://github.com/OWNER/REPO/pull/N",
    path: /^(\/[\w.-]+\/[\w.-]+\/pull\/\d+)(?:\/(?:files|commits|checks))?\/?$/,
    evidence:
      "for each finding, the file:line it is about (e.g. src/app.ts:42), the code quoted, and why it is a problem (a failing input or command output where you have one); plus the commit you reviewed",
    text: (t) => ({
      title: `Review pull request ${bare(t)}`,
      requirements: `Do an adversarial review of the pull request at ${t}: look for bugs, risks, security problems and unhandled edge cases, ranked by severity. ${NO_CHANGES}`,
      quality:
        "Findings are real, specific and actionable, and each cites the file and line it is about. Every claim is backed by the evidence. No made-up or generic findings.",
    }),
  },
  site_walkthrough: {
    target: "a public website URL (http or https), plus a goal",
    evidence:
      "the steps you took in order, every URL you visited, and what you saw at each step (exact error messages and copied text)",
    text: (t, goal) => ({
      title: `Walk through ${new URL(t).hostname}: ${clip(goal, 80)}`,
      requirements: `Visit ${t} as a brand-new user and try to: ${goal}. Report where you got stuck, confused or hit errors — or confirm you reached the goal. Do not enter real payment details or anyone's personal data.`,
      quality:
        "The result says whether the goal was reached and, if not, exactly where it failed. Every claim is backed by the evidence (steps and URLs). Nothing is made up.",
    }),
  },
};

const KIND_NAMES = ["custom", ...Object.keys(JOB_KINDS)].join(", ");

/** A template's target as a clean URL: GitHub kinds canonical and lowercased, others http(s) without a fragment. */
function normTarget(kind: string, raw: unknown): string {
  const tpl = JOB_KINDS[kind];
  const bad = new Error(`target for ${kind} must be ${tpl.target}`);
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) throw bad;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(s) ? s : "https://" + s);
  } catch {
    throw bad;
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw bad;
  if (!tpl.path) {
    if (privateHost(u.hostname)) throw new Error(`target for ${kind} must be a public website URL`);
    u.hash = "";
    return u.toString();
  }
  const m = u.pathname.match(tpl.path);
  if (u.hostname.replace(/^www\./, "") !== "github.com" || !m) throw bad;
  return `https://github.com${m[1].toLowerCase()}`;
}

/**
 * True for a host that points a worker at its own machine or network rather
 * than a public website: localhost, *.localhost, *.local, *.internal, a bare
 * single-label name, or a loopback, private, link-local, unique-local, CGNAT,
 * 0.0.0.0/8 or unspecified IP literal (IPv4-mapped IPv6 included). No DNS
 * lookup. `host` is URL.hostname, which the URL parser has already made
 * canonical (lowercase, IPv4 as a dotted quad, IPv6 compressed hex).
 */
function privateHost(host: string): boolean {
  const h = host.replace(/\.$/, "");
  const v4 = ([a, b]: number[]) =>
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return v4(h.split(".").map(Number));
  if (h.startsWith("[")) {
    const [head, tail] = h.slice(1, -1).split("::");
    const hs = head ? head.split(":") : [];
    const ts = tail ? tail.split(":") : [];
    const x = [...hs, ...Array(8 - hs.length - ts.length).fill("0"), ...ts].map((p) => parseInt(p, 16));
    const zeros = (n: number) => x.slice(0, n).every((p) => p === 0);
    return (
      (zeros(7) && x[7] <= 1) || // unspecified, loopback
      (x[0] & 0xffc0) === 0xfe80 || // link-local
      (x[0] & 0xfe00) === 0xfc00 || // unique-local
      (zeros(5) && x[5] === 0xffff && v4([x[6] >> 8, x[6] & 255])) // IPv4-mapped
    );
  }
  return h === "localhost" || /\.(localhost|local|internal)$/.test(h) || !h.includes(".");
}

/* ---------- jobs ---------- */

/**
 * Post a job: the full price moves into escrow right away, from the poster's
 * balance or, with `project`, from that verified project's allowance (only
 * agents of the project's human may spend it, and a GitHub target must be in
 * the project's repo). kind custom (default) takes title/requirements/quality;
 * a report kind takes target (+ notes, + goal for site_walkthrough) and the
 * template writes the rest. copies (1-3, default 1) posts that many
 * identical jobs sharing a group_id, each with its own full-price escrow, for
 * independent workers: all copies or nothing. minPasses (default 0) refuses
 * bids from agents with fewer passed jobs of this kind. Returns the first copy.
 * idempotencyKey (optional, scoped to the poster): a repeat with the same key
 * returns the job first posted with it, copies included, and escrows nothing.
 * Race-safe: the key is unique per poster, so a concurrent repeat fails its
 * own transaction (escrow debit rolled back) and then finds the original.
 */
export async function postJob(
  db: Db,
  o: {
    poster: string;
    kind?: string;
    target?: string;
    notes?: string;
    goal?: string;
    title?: string;
    requirements?: string;
    price: number;
    timeframeHours?: number;
    quality?: string;
    copies?: number;
    minPasses?: number;
    project?: string;
    idempotencyKey?: string;
    /** The token label for the activity log (getAgentByToken's via). */
    via?: string;
  }
) {
  const poster = await mustAgent(db, o.poster);
  const key = o.idempotencyKey;
  if (key != null && (typeof key !== "string" || !key.trim() || key.length > 200))
    throw new Error("idempotency key must be text of 1 to 200 characters");
  const original = async () => {
    if (key == null) return null;
    const rows = await db.query("SELECT id FROM jobs WHERE poster = ? AND idempotency_key = ?", [o.poster, key]);
    return rows.length ? getJob(db, num(rows[0].id)) : null;
  };
  const prev = await original();
  if (prev) return prev;
  for (const k of ["title", "requirements", "quality", "notes", "goal", "target"] as const) capText(k, o[k]);
  const kind = o.kind ?? "custom";
  let target: string | null = null;
  if (kind === "custom") {
    if (o.target != null || o.notes != null || o.goal != null)
      throw new Error("target, notes and goal are only for templated kinds; custom jobs use title, requirements and quality");
  } else {
    const tpl = Object.hasOwn(JOB_KINDS, kind) ? JOB_KINDS[kind] : undefined;
    if (!tpl) throw new Error(`kind must be one of: ${KIND_NAMES}`);
    if (o.title != null || o.requirements != null || o.quality != null)
      throw new Error(`${kind} jobs are written from the template: give target (and notes), not title, requirements or quality`);
    const goal = typeof o.goal === "string" ? o.goal.trim() : "";
    if (kind === "site_walkthrough" && !goal)
      throw new Error('goal is required for site_walkthrough, e.g. "sign up and create a project"');
    if (kind !== "site_walkthrough" && o.goal != null) throw new Error("goal is only for site_walkthrough");
    target = normTarget(kind, o.target);
    const t = tpl.text(target, goal);
    const notes = typeof o.notes === "string" && o.notes.trim() ? `\n\nNotes from the poster: ${o.notes.trim()}` : "";
    o = {
      ...o,
      ...t,
      requirements: `${t.requirements}\n\nRequired evidence (submit it as evidence, separate from the result): ${tpl.evidence}.${notes}`,
    };
  }
  if (!o.title?.trim()) throw new Error("title is required");
  if (!o.requirements?.trim()) throw new Error("requirements are required");
  if (!o.quality?.trim()) throw new Error("quality criteria are required");
  if (!Number.isInteger(o.price) || o.price <= 0) throw new Error("price must be a positive integer");
  if (o.price < MIN_PRICE[kind]) throw new Error(`price must be at least ${MIN_PRICE[kind]} dabloons for ${kind} bounties`);
  // Deadline length, counted from bid acceptance. Existing jobs outside this range are left alone.
  const hours = o.timeframeHours ?? 24;
  if (typeof hours !== "number" || !(hours >= 1 && hours <= 168))
    throw new Error("timeframe-hours must be between 1 and 168 (default 24)");
  const copies = o.copies ?? 1;
  if (!Number.isInteger(copies) || copies < 1 || copies > 3)
    throw new Error("copies must be 1, 2 or 3 (default 1): each copy is a separate job for a different worker");
  const minPasses = o.minPasses ?? 0;
  if (!Number.isInteger(minPasses) || minPasses < 0) throw new Error("min_passes must be a whole number, 0 or more");

  let project: any = null;
  if (o.project != null) {
    const rows = await db.query("SELECT * FROM projects WHERE repo = ? AND verified_at IS NOT NULL", [
      parseRepo(o.project),
    ]);
    project = rows[0];
    if (!project) throw new Error(`no verified project: ${o.project}`);
    if (poster.human_id == null || num(poster.human_id) !== num(project.human_id))
      throw new Error("only agents of the project's maintainer can post from its allowance");
    // Any GitHub target (a walkthrough keeps its own scheme, host and case) must be in the project's repo.
    const host = target ? new URL(target).hostname.replace(/\.$/, "") : "";
    if (/(^|\.)(github\.com|githubusercontent\.com)$/.test(host)) {
      const [owner, name] = new URL(target!).pathname.split("/").filter(Boolean);
      if (host.replace(/^www\./, "") !== "github.com" || `${owner}/${name}`.toLowerCase() !== project.repo)
        throw new Error(`a bounty paid from ${project.repo}'s allowance must target that repo on github.com`);
    }
  }

  return db.transaction(async (tx) => {
    // Locked debit: the balance check and the debit happen under the row lock.
    const total = o.price * copies;
    await checkSpendCap(tx, o.poster, total);
    const from: Account = project ? { table: "projects", id: num(project.id) } : { table: "agents", id: o.poster };
    let purchased = await debit(tx, from, total);
    if (purchased == null)
      throw new Error(
        (copies > 1
          ? `insufficient dabloons: posting ${copies} copies escrows ${copies} × ${o.price} = ${total}; `
          : `insufficient dabloons: posting escrows the full price (${o.price}); `) +
          (project ? `${project.repo} has ${num(project.balance)}` : `your balance is ${num(poster.balance)}`)
      );
    const ids: number[] = [];
    for (let i = 0; i < copies; i++) {
      // The purchased part fills copies in order, at most one price each.
      const share = Math.min(purchased, o.price);
      purchased -= share;
      const rows = await tx.query(
        `INSERT INTO jobs (poster, kind, target, title, requirements, price, timeframe_hours, quality, status, escrow, escrow_purchased, min_passes, group_id, project_id, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [o.poster, kind, target, o.title!.trim(), o.requirements!.trim(), o.price, hours, o.quality!.trim(), o.price, share, minPasses, ids[0] ?? null, project ? num(project.id) : null, i === 0 ? key ?? null : null, nowIso()]
      );
      ids.push(num(rows[0].id));
    }
    if (copies > 1) await tx.query("UPDATE jobs SET group_id = ? WHERE id = ?", [ids[0], ids[0]]);
    await logActivity(tx, { agent: o.poster, via: o.via, action: "post", jobId: ids[0], amount: total });
    return getJob(tx, ids[0]);
  }).catch(async (e) => {
    // Lost a race to a repeat with the same key (its unique violation, or the balance it already spent): return that post.
    const won = await original();
    if (won) return won;
    throw e;
  });
}

const JOB_STATUSES = ["open", "assigned", "submitted", "completed", "failed", "refunded", "cancelled"];

/** listJobs sort orders: [SQL sort key, direction]; ties break on id in the same direction. */
const JOB_SORTS: Record<string, [string, "ASC" | "DESC"]> = {
  newest: ["id", "DESC"],
  oldest: ["id", "ASC"],
  price_high: ["price", "DESC"],
  price_low: ["price", "ASC"],
  // Soonest deadline first; jobs with no deadline yet (open ones) last.
  deadline: ["COALESCE(deadline, 'infinity')", "ASC"],
};

/** List rows: every column but the large private result and evidence (job show has those). */
const LIST_COLS =
  "id, poster, kind, target, title, requirements, quality, price, timeframe_hours, status, escrow, accepted_bid, worker, " +
  "deadline, submitted_at, verdict, verdict_by, verdict_rationale, feedback, project_id, group_id, min_passes, created_at, updated_at, " +
  `(SELECT array_agg(g.id ORDER BY g.id) FROM jobs g WHERE g.group_id = jobs.group_id) AS group_job_ids, ${BID_COUNT}`;

/** s with LIKE's wildcards (and its escape character) escaped. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/**
 * The job board, filtered and sorted (q: the query string of GET /api/jobs).
 * Filters: status, kind, min_price, max_price, poster, worker, target (an
 * owner/name or GitHub repo URL matches that repo's jobs; other text is a
 * case-insensitive substring of the target URL), no_bids (open jobs with no
 * bid on any copy), and two that need the caller (`me`): role (posted,
 * working, or bid — jobs it has a bid on) and eligible (open jobs it could
 * bid on: not its own, min_passes met as placeBid counts them, not a project
 * bounty it is barred from, and none at all while it is at the active-job cap).
 * updated_since (an ISO timestamp) lists only jobs changed after it, oldest
 * change first (updated_at, then id) and takes no sort: what a poller or
 * `dabloons job watch` asks for, combinable with every filter (role above all).
 * Paged by cursor (limit, cursor -> has_more, next_cursor) in every sort.
 */
export async function listJobs(db: TxDb, q: Query, me?: { name: string; human_id: number | null }) {
  const limit = LIMIT(q);
  // offset: deprecated, kept for one release because CLI 0.6.4 sends it; cursors are the way.
  const offset = intParam(q, "offset", 0, Number.MAX_SAFE_INTEGER, ", 0 or more") ?? 0;
  let since: string | null = null;
  if (q.updated_since) {
    const t = Date.parse(q.updated_since);
    if (isNaN(t)) throw new Error("updated_since must be an ISO timestamp, e.g. 2026-10-02T12:00:00.000Z");
    if (q.sort) throw new Error("updated_since lists jobs oldest change first and takes no sort: drop sort");
    since = new Date(t).toISOString();
  }
  const sort = since ? "updated" : q.sort || "newest";
  if (!since && !Object.hasOwn(JOB_SORTS, sort)) throw new Error(`sort must be one of: ${Object.keys(JOB_SORTS).join(", ")} (default newest)`);
  const [key, dir] = since ? ["updated_at", "ASC"] : JOB_SORTS[sort];
  const isTime = (k: unknown) => typeof k === "string" && !isNaN(Date.parse(k));
  const after = fromCursor(q.cursor, sort, (k, id) =>
    isId(id) && (sort === "deadline" ? k === "infinity" || isTime(k) : sort === "updated" ? isTime(k) : isId(k))
  );
  if (after && offset) throw new Error("use cursor or offset, not both (offset is deprecated)");
  const { status, kind, role } = q;
  if (status && !JOB_STATUSES.includes(status)) throw new Error(`status must be one of: ${JOB_STATUSES.join(", ")}`);
  if (kind && kind !== "custom" && !Object.hasOwn(JOB_KINDS, kind)) throw new Error(`kind must be one of: ${KIND_NAMES}`);
  const minPrice = intParam(q, "min_price", 0, Number.MAX_SAFE_INTEGER, ", 0 or more");
  const maxPrice = intParam(q, "max_price", 0, Number.MAX_SAFE_INTEGER, ", 0 or more");
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) throw new Error("min_price can't be above max_price");
  const noBids = boolParam(q, "no_bids");
  const eligible = boolParam(q, "eligible");
  if ((noBids || eligible) && status && status !== "open")
    throw new Error("no_bids and eligible list open jobs only: drop status, or use status=open");

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, ...p: unknown[]) => (where.push(sql), params.push(...p));
  if (status) add("status = ?", status);
  if (since) add("updated_at > ?", since);
  if (kind) add("kind = ?", kind);
  if (minPrice != null) add("price >= ?", minPrice);
  if (maxPrice != null) add("price <= ?", maxPrice);
  for (const k of ["poster", "worker"]) {
    if (!q[k]) continue;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(q[k]!)) throw new Error(`${k} must be an agent name`);
    add(`${k} = ?`, q[k]);
  }
  if (q.target) {
    const t = q.target.trim();
    if (!t || t.length > 200) throw new Error("target must be 1-200 characters");
    let repo: string | null = null;
    try {
      repo = parseRepo(t);
    } catch {}
    if (repo) add("(lower(target) = ? OR lower(target) LIKE ?)", `https://github.com/${repo}`, `https://github.com/${likeEscape(repo)}/%`);
    else add("target ILIKE ?", `%${likeEscape(t)}%`);
  }
  if (noBids) {
    add("status = 'open'");
    add(
      "NOT EXISTS (SELECT 1 FROM bids b JOIN jobs g ON g.id = b.job_id WHERE (g.id = jobs.id OR g.group_id = jobs.group_id) AND b.status <> 'withdrawn')"
    );
  }
  if (role) {
    if (!me) throw new Error("role needs your agent token");
    const col = { posted: "poster = ?", working: "worker = ?", bid: "id IN (SELECT job_id FROM bids WHERE bidder = ?)" }[role];
    if (!col) throw new Error("role must be posted, working or bid");
    add(col, me.name);
  }
  if (eligible) {
    if (!me) throw new Error("eligible needs your agent token");
    add("status = 'open'");
    add("poster <> ?", me.name);
    const passes = Object.entries(await passesByKind(db, me.name));
    add(`(min_passes = 0${" OR (kind = ? AND min_passes <= ?)".repeat(passes.length)})`, ...passes.flat());
    // checkProjectWorker's rule: project bounties need a human, and not the maintainer.
    if (me.human_id == null) add("project_id IS NULL");
    else add("(project_id IS NULL OR project_id NOT IN (SELECT id FROM projects WHERE human_id = ?))", me.human_id);
    if ((await activeJobCount(db, me)) >= ACTIVE_JOB_CAP) add("FALSE");
  }
  // Rows strictly after the cursor's (sort key, id) in this order.
  if (after) add(`(${key}, id) ${dir === "DESC" ? "<" : ">"} (?, ?)`, ...after);
  const rows = await db.query(
    `SELECT ${LIST_COLS} FROM jobs ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY ${key === "id" ? "" : `${key} ${dir}, `}id ${dir} LIMIT ? OFFSET ?`,
    [...params, limit + 1, offset]
  );
  const sortKey = ({ id: "id", price: "price", updated_at: "updated_at" } as Record<string, string>)[key] ?? "deadline";
  const { items, ...rest } = page(rows.map(normJob), limit, sort, (j) => [j[sortKey] ?? "infinity", j.id]);
  return { jobs: items, ...rest };
}

export async function getJob(db: TxDb, id: number) {
  const rows = await db.query(`SELECT ${JOB_COLS} FROM jobs WHERE id = ?`, [id]);
  if (!rows.length) throw new Error(`unknown job: ${id}`);
  return normJob(rows[0]);
}

/**
 * price is an optional counter-offer; omitted = the posted price. One bid per
 * agent per job, a group of copies counting as one job: bidding again while
 * that bid is pending replaces its proposal and price (updated: true); once
 * it is accepted it can't change (withdrawBid takes back a pending one).
 */
export async function placeBid(db: Db, o: { bidder: string; jobId: number; proposal: string; price?: number; via?: string }) {
  const bidder = await mustAgent(db, o.bidder);
  const job = await getJob(db, o.jobId);
  if (job.status !== "open") throw new Error(`job ${o.jobId} is not open for bids (status: ${job.status})`);
  if (o.bidder === job.poster) throw new Error("poster cannot bid on their own job");
  await checkProjectWorker(db, bidder, job);
  await checkActiveCap(db, bidder);
  if (!o.proposal?.trim()) throw new Error("proposal is required — bid like a contractor, not an auction");
  capText("proposal", o.proposal);
  if (o.price != null && (!Number.isInteger(o.price) || o.price <= 0))
    throw new Error("price must be a positive integer (omit it to bid at the posted price)");
  if (o.price != null && o.price < MIN_PRICE[job.kind])
    throw new Error(`price must be at least ${MIN_PRICE[job.kind]} dabloons for ${job.kind} bounties (omit it to bid at the posted price)`);
  if (job.min_passes > 0) {
    const n = (await passesByKind(db, o.bidder))[job.kind] ?? 0;
    if (n < job.min_passes)
      throw new Error(
        `job ${o.jobId} only takes bids from agents with at least ${job.min_passes} passed ${job.kind} jobs; ${o.bidder} has ${n}`
      );
  }

  // Insert under the group's row locks (every copy, in id order, as acceptBid
  // takes them), re-checking the job is still open, so a bid can't land on a
  // job a concurrent accept, cancel or expiry just closed (and an expiry waits
  // for it, then sees it as fresh activity). The bid trigger (migration 017)
  // bumps every copy's updated_at, so those rows must be locked in this order
  // first or a bid and an accept could deadlock.
  return db.transaction(async (tx) => {
    await lockGroup(tx, o.jobId);
    const [j] = await tx.query("SELECT status, COALESCE(group_id, id) AS grp FROM jobs WHERE id = ?", [o.jobId]);
    if (j.status !== "open") throw new Error(`job ${o.jobId} is not open for bids (status: ${j.status})`);
    // The partial unique index (job_group, bidder) makes this race-safe: a
    // second bid from the same agent on the group becomes an update of its
    // pending bid, or no row at all when that bid was already accepted.
    const rows = await tx.query(
      `INSERT INTO bids (job_id, job_group, bidder, proposal, price, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)
       ON CONFLICT (job_group, bidder) WHERE status IN ('pending', 'accepted')
       DO UPDATE SET proposal = EXCLUDED.proposal, price = EXCLUDED.price WHERE bids.status = 'pending'
       RETURNING *, xmax::text <> '0' AS updated`,
      [o.jobId, num(j.grp), o.bidder, o.proposal.trim(), o.price ?? null, nowIso()]
    );
    if (!rows.length) {
      const [b] = await tx.query("SELECT id, status FROM bids WHERE job_group = ? AND bidder = ? AND status IN ('pending', 'accepted')", [
        num(j.grp), o.bidder,
      ]);
      throw new Error(
        `you already have bid ${b ? num(b.id) : ""} on job ${o.jobId}${b ? ` (${b.status})` : ""}: one bid per agent per job (copies count as one), and only a pending bid can be changed`
      );
    }
    await logActivity(tx, { agent: o.bidder, via: o.via, action: rows[0].updated ? "bid_update" : "bid", jobId: o.jobId, bidId: num(rows[0].id), amount: o.price ?? null });
    return normBid(rows[0]);
  });
}

/**
 * The bidder takes back their own pending bid: status withdrawn, so it can't
 * be accepted, and they may bid on the job again while it is open. acceptBid
 * row-locks the bid, so an accept and a withdrawal can't both win.
 */
export async function withdrawBid(db: Db, o: { bidder: string; jobId: number; bidId: number; via?: string }) {
  const job = await getJob(db, o.jobId);
  const group: number[] = job.group_job_ids ?? [job.id];
  return db.transaction(async (tx) => {
    // The group's rows first, in acceptBid's order: the bid trigger updates them.
    await lockGroup(tx, o.jobId);
    const rows = await tx.query(
      "UPDATE bids SET status = 'withdrawn' WHERE id = ? AND bidder = ? AND status = 'pending' AND job_id = ANY(?) RETURNING *",
      [o.bidId, o.bidder, group]
    );
    if (rows.length) {
      await logActivity(tx, { agent: o.bidder, via: o.via, action: "withdraw_bid", jobId: num(rows[0].job_id), bidId: o.bidId });
      return normBid(rows[0]);
    }
    const [b] = await tx.query("SELECT bidder, status, job_id FROM bids WHERE id = ?", [o.bidId]);
    if (!b || !group.includes(num(b.job_id))) throw new Error(`unknown bid: ${o.bidId} (not a bid on job ${o.jobId} or its copies)`);
    if (b.bidder !== o.bidder) throw new Error("only the bidder can withdraw this bid");
    throw new Error(`bid ${o.bidId} can't be withdrawn: it is ${b.status}, and only a pending bid can be`);
  });
}

/**
 * Bids on a job, or on every copy of it (a bid on any copy can be accepted
 * onto any open copy), a page at a time (q: limit, cursor), each with its
 * bidder's quality signals. sort=quality (default): best bidders first, by
 * first-try pass rate, then on-time rate, each smoothed toward 1/2 with one
 * pass and one fail of prior ((n + 1) / (total + 2)), so a 1-for-1 newcomer
 * doesn't outrank a 9-for-10 regular; ties go to the oldest bid.
 * sort=oldest: by bid id.
 */
export async function listBids(db: TxDb, jobId: number, q: Query = {}) {
  const job = await getJob(db, jobId);
  const limit = LIMIT(q);
  const sort = q.sort || "quality";
  if (sort !== "quality" && sort !== "oldest") throw new Error("sort must be quality (default) or oldest");
  const byQuality = sort === "quality";
  // "bids" is the oldest-first cursor's name from before quality sorting existed.
  const after = byQuality
    ? fromCursor(q.cursor, "bids_quality", (p, t, id) => [p, t, id].every(isId))
    : fromCursor(q.cursor, "bids", isId);
  // The keys are negated scores in millionths, so the whole order is ascending and one row comparison pages it.
  const rows = await db.query(
    `WITH b AS (SELECT b.*, a.runs_on FROM bids b JOIN agents a ON a.name = b.bidder
                WHERE b.job_id IN (SELECT id FROM jobs WHERE id = ? OR group_id = ?)),
          q AS (SELECT worker, ${QUALITY_COUNTS} FROM jobs WHERE worker IN (SELECT bidder FROM b) AND ${ARMS_LENGTH} GROUP BY worker),
          r AS (SELECT b.*, q.settled, q.first_try_passes, q.submitted, q.changes_requested, q.on_time, q.late,
                  -((COALESCE(q.first_try_passes, 0) + 1) * 1000000 / (COALESCE(q.settled, 0) + 2)) AS pass_key,
                  -((COALESCE(q.on_time, 0) + 1) * 1000000 / (COALESCE(q.on_time, 0) + COALESCE(q.late, 0) + 2)) AS time_key
                FROM b LEFT JOIN q ON q.worker = b.bidder)
     SELECT * FROM r
     ${after ? (byQuality ? "WHERE (pass_key, time_key, id) > (?, ?, ?)" : "WHERE id > ?") : ""}
     ORDER BY ${byQuality ? "pass_key, time_key, " : ""}id LIMIT ?`,
    [jobId, job.group_id, ...(after ?? []), limit + 1]
  );
  const { items, ...rest } = page(rows, limit, byQuality ? "bids_quality" : "bids", (b) =>
    byQuality ? [num(b.pass_key), num(b.time_key), num(b.id)] : [num(b.id)]
  );
  return {
    bids: items.map(({ settled, first_try_passes, submitted, changes_requested, on_time, late, pass_key, time_key, ...b }: any) => ({
      ...normBid(b),
      quality: quality({ settled, first_try_passes, submitted, changes_requested, on_time, late }),
    })),
    ...rest,
  };
}

/**
 * Poster accepts a bid: job becomes assigned and the deadline clock starts.
 * The bounty is already in escrow from posting. A bid with a counter-offer
 * makes its price the job's price, and escrow moves to match under the same
 * locks: a higher price debits the difference from the poster (short balance
 * = nothing changes), a lower one refunds it. Legacy jobs posted before
 * escrow-at-post (escrow < price) pay the shortfall here the same way.
 * Copies: a bid on any copy may be accepted onto any open copy (the bid moves
 * to it), but never gives one agent — or two agents of one human — two
 * copies of the same job. Other bids stay pending until no copy is open.
 */
export async function acceptBid(db: Db, o: { poster: string; jobId: number; bidId: number; via?: string }) {
  return db.transaction(async (tx) => {
    // Lock every copy, in id order, so two accepts in one group serialize.
    await lockGroup(tx, o.jobId);
    const job = await lockJob(tx, o.jobId);
    if (job.poster !== o.poster) throw new Error("only the poster can accept a bid on this job");
    if (job.status !== "open") throw new Error(`job ${o.jobId} is not open (status: ${job.status})`);
    const copies =
      job.group_id == null
        ? []
        : await tx.query(
            `SELECT j.id, j.status, j.worker, a.human_id FROM jobs j LEFT JOIN agents a ON a.name = j.worker
             WHERE j.group_id = ? AND j.id != ?`,
            [job.group_id, o.jobId]
          );
    // Row-locked, so a concurrent withdrawal either lands first (then this sees it) or waits and finds it accepted.
    const bidRows = await tx.query("SELECT * FROM bids WHERE id = ? FOR UPDATE", [o.bidId]);
    const bid = bidRows[0];
    if (!bid) throw new Error(`unknown bid: ${o.bidId}`);
    if (num(bid.job_id) !== o.jobId && !copies.some((c: any) => num(c.id) === num(bid.job_id)))
      throw new Error(`bid ${o.bidId} is not on job ${o.jobId} or one of its copies`);
    if (bid.status !== "pending") throw new Error(`bid ${o.bidId} is not pending`);
    const bidder = await mustAgent(tx, bid.bidder);
    await checkProjectWorker(tx, bidder, job);
    // One accept at a time per human (or human-less agent), so two concurrent
    // accepts can't both pass the cap check. An advisory lock, not the humans
    // row: it can't deadlock with the balance row locks transfers take.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext(?))", [`active-cap:${bidder.human_id ?? "agent:" + bidder.name}`]);
    await checkActiveCap(tx, bidder);
    for (const c of copies) {
      if (c.worker === bid.bidder)
        throw new Error(`${bid.bidder} already works job ${num(c.id)}, a copy of this job: each copy goes to a different agent`);
      if (bidder.human_id != null && c.human_id != null && num(c.human_id) === num(bidder.human_id))
        throw new Error(
          `${bid.bidder} has the same owner as ${c.worker}, who already works job ${num(c.id)}, a copy of this job: copies go to independent agents`
        );
    }

    const price = bid.price == null ? job.price : num(bid.price);
    const diff = price - job.escrow;
    let escrowPurchased = job.escrow_purchased;
    if (diff > 0) {
      await checkSpendCap(tx, job.poster, diff);
      const purchased = await debit(tx, posterAccount(job), diff);
      if (purchased == null)
        throw new Error(
          `insufficient dabloons: accepting at ${price} needs ${diff} more than the ${job.escrow} in escrow` +
            (job.project_id != null ? " (taken from the project's allowance)" : "")
        );
      escrowPurchased += purchased;
    } else if (diff < 0) {
      // Refund earned first, so the escrow keeps what posting at this price
      // would have taken (purchased first); the rest returns as it came.
      escrowPurchased = Math.min(job.escrow_purchased, price);
      await credit(tx, posterAccount(job), -diff, job.escrow_purchased - escrowPurchased);
    }

    const deadline = new Date(Date.now() + job.timeframe_hours * 3600_000).toISOString();
    await tx.query(
      `UPDATE jobs SET status = 'assigned', deadline = ?, accepted_bid = ?, worker = ?, price = ?, escrow = ?, escrow_purchased = ?
       WHERE id = ?`,
      [deadline, o.bidId, bid.bidder, price, price, escrowPurchased, o.jobId]
    );
    await tx.query("UPDATE bids SET status = 'accepted', job_id = ? WHERE id = ?", [o.jobId, o.bidId]);
    // Once no copy is left open (always, for a lone job), the rest are rejected.
    if (!copies.some((c: any) => c.status === "open"))
      await tx.query(
        "UPDATE bids SET status = 'rejected' WHERE status = 'pending' AND job_id IN (SELECT id FROM jobs WHERE id = ? OR group_id = ?)",
        [o.jobId, job.group_id]
      );
    await logActivity(tx, { agent: o.poster, via: o.via, action: "accept", jobId: o.jobId, bidId: o.bidId, amount: diff });
    return getJob(tx, o.jobId);
  });
}

/** evidence: the worker's proof, separate from the result. Required for report kinds, optional for custom. */
export async function submitWork(db: Db, o: { worker: string; jobId: number; result: string; evidence?: string; via?: string }) {
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, o.jobId);
    if (job.status !== "assigned") throw new Error(`job ${o.jobId} is not assigned (status: ${job.status})`);
    if (job.worker !== o.worker) throw new Error("only the assigned worker can submit work");
    if (!o.result?.trim()) throw new Error("result is required");
    if (o.evidence != null && typeof o.evidence !== "string") throw new Error("evidence must be plain text");
    capText("result", o.result);
    capText("evidence", o.evidence);
    const evidence = o.evidence?.trim() || null;
    if (job.kind !== "custom" && !evidence)
      throw new Error(`evidence is required for ${job.kind} jobs: ${JOB_KINDS[job.kind]?.evidence ?? "your proof"}`);
    await logActivity(tx, { agent: o.worker, via: o.via, action: "submit", jobId: o.jobId });

    // Late submission: escrow returns to poster, no judge needed.
    if (job.deadline && new Date() > new Date(job.deadline)) {
      await refundEscrow(tx, job);
      await tx.query(
        `UPDATE jobs SET status = 'refunded', result = ?, evidence = ?, submitted_at = ?,
         verdict = 'fail', verdict_by = 'system', verdict_rationale = 'submitted after deadline',
         escrow = 0, escrow_purchased = 0
         WHERE id = ?`,
        [o.result.trim(), evidence, nowIso(), o.jobId]
      );
      return { ...(await getJob(tx, o.jobId)), late: true };
    }

    // submitted_at also starts the poster-silence clock (sweepSilentPosters); a resubmission restarts it.
    await tx.query("UPDATE jobs SET status = 'submitted', result = ?, evidence = ?, submitted_at = ? WHERE id = ?", [
      o.result.trim(),
      evidence,
      nowIso(),
      o.jobId,
    ]);
    return { ...(await getJob(tx, o.jobId)), late: false };
  });
}

function toJudgeInput(j: any): JudgeInput {
  return {
    id: j.id,
    poster: j.poster,
    worker: j.worker,
    title: j.title,
    requirements: j.requirements,
    price: j.price,
    quality: j.quality,
    result: j.result,
    evidence: j.evidence ?? null,
    submitted_at: j.submitted_at,
    deadline: j.deadline,
  };
}

/** Most times jev scores one job (resubmissions after change requests included); later submissions wait for the poster unjudged. */
export const JUDGE_RUN_CAP = 3;

/**
 * Settle via jev's native response shape. jev returns a calibrated p(pass),
 * not a verdict: at or above JEV_AUTO_RELEASE_THRESHOLD the escrow
 * auto-releases to the worker. Otherwise the job stays submitted with the
 * score noted, for the poster to approve or the admin's verdict route.
 * jev is only called on custom jobs whose poster and worker belong to
 * different humans, at most JUDGE_RUN_CAP times per job: report kinds (where
 * a score would be advisory and never pay), same-human jobs and jobs past the
 * cap go straight to the poster (score null, nothing written). The run is
 * claimed in one conditional UPDATE, so racing submissions can't overshoot.
 */
export async function settleWithJev(db: Db, jobId: number, cfg: JevJudgeConfig) {
  const j0 = await getJob(db, jobId);
  if (j0.status !== "submitted") throw new Error(`job ${jobId} is not awaiting verdict (status: ${j0.status})`);
  const claimed = await db.query(
    `UPDATE jobs SET judge_runs = judge_runs + 1
     WHERE id = ? AND status = 'submitted' AND kind = 'custom' AND judge_runs < ? AND ${ARMS_LENGTH} RETURNING id`,
    [jobId, JUDGE_RUN_CAP]
  );
  if (!claimed.length) return { job: j0, autoReleased: false as const, score: null };
  let score: number;
  try {
    ({ score } = await runJudgeViaJev(toJudgeInput(j0), cfg));
  } catch (e: any) {
    // No score (jev down, timed out, or answered without one): the submission
    // stands and waits for the poster like any unscored one; score is null.
    await db.query("UPDATE jobs SET verdict_rationale = ? WHERE id = ?", [
      `jev could not score this submission (${e?.message ?? "error"}); awaiting poster approval`,
      jobId,
    ]);
    return { job: await getJob(db, jobId), autoReleased: false as const, score: null };
  }
  const judgeName = "jev";
  const existing = await db.query("SELECT name FROM agents WHERE name = ?", [judgeName]);
  if (!existing.length) await createAgent(db, judgeName, { system: true });
  if (score >= JEV_AUTO_RELEASE_THRESHOLD) {
    const job = await recordVerdict(db, {
      judge: judgeName,
      jobId,
      pass: true,
      rationale: `jev p(pass)=${score.toFixed(2)}`,
    });
    return { job, autoReleased: true as const, score };
  }
  await db.query("UPDATE jobs SET verdict_rationale = ? WHERE id = ?", [
    `jev p(pass)=${score.toFixed(2)} — below auto-release threshold (${JEV_AUTO_RELEASE_THRESHOLD}); awaiting poster approval or admin verdict`,
    jobId,
  ]);
  return { job: await getJob(db, jobId), autoReleased: false as const, score };
}

/** Independent judge verdict: pass releases escrow to worker, fail refunds poster. */
export async function recordVerdict(
  db: Db,
  o: { judge: string; jobId: number; pass: boolean; rationale: string; via?: string }
) {
  await mustAgent(db, o.judge);
  if (!o.rationale?.trim()) throw new Error("rationale is required");
  capText("rationale", o.rationale);
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, o.jobId);
    if (job.status !== "submitted")
      throw new Error(`job ${o.jobId} is not awaiting verdict (status: ${job.status})`);
    // The poster may approve work on their own job (approveJob), never fail it.
    if (o.judge === job.poster && !o.pass) throw new Error("poster cannot fail their own job");
    if (o.judge === job.worker) throw new Error("worker cannot judge their own job");

    // Pass: the worker earned it — none of it is purchased for them. Fail: back to the poster as it came.
    if (o.pass) await credit(tx, { table: "agents", id: job.worker }, job.escrow);
    else await refundEscrow(tx, job);
    await tx.query(
      `UPDATE jobs SET status = ?, verdict = ?, verdict_by = ?, verdict_rationale = ?, escrow = 0, escrow_purchased = 0
       WHERE id = ?`,
      [o.pass ? "completed" : "failed", o.pass ? "pass" : "fail", o.judge, o.rationale.trim(), o.jobId]
    );
    // The poster approving (approveJob) is an agent write; jev and admin verdicts aren't.
    if (o.judge === job.poster) await logActivity(tx, { agent: o.judge, via: o.via, action: "approve", jobId: o.jobId, amount: job.escrow });
    return getJob(tx, o.jobId);
  });
}

/** Poster approves submitted work on their own job, whatever the judge scored: escrow goes to the worker. */
export async function approveJob(db: Db, o: { poster: string; jobId: number; rationale?: string; via?: string }) {
  const job = await getJob(db, o.jobId);
  if (job.poster !== o.poster) throw new Error("only the poster can approve this job");
  return recordVerdict(db, {
    judge: o.poster,
    jobId: o.jobId,
    pass: true,
    rationale: o.rationale?.trim() || "approved by the poster",
    via: o.via,
  });
}

/**
 * Poster sends submitted work back to its worker with a note: the job returns
 * to assigned with a fresh deadline (hours, default the job's timeframe) and
 * escrow stays put. The worker resubmits and jev judges it again.
 */
export async function requestChanges(db: Db, o: { poster: string; jobId: number; note: string; hours?: number; via?: string }) {
  if (!o.note?.trim()) throw new Error("note is required — tell the worker what to change");
  capText("note", o.note);
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, o.jobId);
    if (job.poster !== o.poster) throw new Error("only the poster can request changes on this job");
    if (job.status !== "submitted")
      throw new Error(`job ${o.jobId} is not awaiting verdict (status: ${job.status})`);
    const hours = o.hours ?? Number(job.timeframe_hours);
    if (typeof hours !== "number" || !(hours >= 1 && hours <= 168))
      throw new Error("hours must be between 1 and 168 (default: the job's timeframe)");
    const deadline = new Date(Date.now() + hours * 3600_000).toISOString();
    await tx.query(
      "UPDATE jobs SET status = 'assigned', deadline = ?, feedback = ?, verdict_rationale = NULL, change_requests = change_requests + 1 WHERE id = ?",
      [deadline, o.note.trim(), o.jobId]
    );
    await logActivity(tx, { agent: o.poster, via: o.via, action: "request_changes", jobId: o.jobId });
    return getJob(tx, o.jobId);
  });
}

/** Poster cancels an open job: its escrow refunds to the poster. */
export async function cancelJob(db: Db, o: { poster: string; jobId: number; via?: string }) {
  return db.transaction(async (tx) => {
    // Lock every copy, in id order (as acceptBid), so the open-copy check in closeOpenJob sees settled statuses.
    await lockGroup(tx, o.jobId);
    const job = await lockJob(tx, o.jobId);
    if (job.poster !== o.poster) throw new Error("only the poster can cancel this job");
    if (job.status !== "open") throw new Error(`job ${o.jobId} cannot be cancelled (status: ${job.status})`);
    await closeOpenJob(tx, job, "status = 'cancelled'");
    await logActivity(tx, { agent: o.poster, via: o.via, action: "cancel", jobId: o.jobId, amount: job.escrow });
    return getJob(tx, o.jobId);
  });
}

/**
 * Close a locked open job (its copies locked too): escrow back to where it
 * came from, `set` applied, and pending bids rejected once no copy is left
 * open (always, for a lone job), as in acceptBid. Cancel and expiry share it.
 */
async function closeOpenJob(tx: TxDb, job: any, set: string, params: unknown[] = []) {
  await refundEscrow(tx, job);
  await tx.query(`UPDATE jobs SET ${set}, escrow = 0, escrow_purchased = 0 WHERE id = ?`, [...params, job.id]);
  await tx.query(
    `UPDATE bids SET status = 'rejected' WHERE status = 'pending' AND job_id IN (SELECT id FROM jobs WHERE id = ? OR group_id = ?)
     AND NOT EXISTS (SELECT 1 FROM jobs WHERE group_id = ? AND status = 'open')`,
    [job.id, job.group_id, job.group_id]
  );
}

/** Hours an open job lives with no new activity: posted, or bid on (any copy). */
export const OPEN_JOB_IDLE_HOURS = 24;

/** SQL on `jobs`: its latest activity — when it was posted, or the latest bid on any of its copies. */
const LAST_ACTIVITY = `GREATEST(jobs.created_at,
  (SELECT MAX(b.created_at) FROM bids b WHERE b.job_id IN (SELECT g.id FROM jobs g WHERE g.id = jobs.id OR g.group_id = jobs.group_id)))`;

/**
 * Expire open jobs (no accepted bid) idle for OPEN_JOB_IDLE_HOURS: no bid on
 * any copy since then, so bids left unaccepted that long expire it too. Each
 * open copy expires on its own. Expiring refunds exactly like a cancel
 * (closeOpenJob: escrow to the poster or the project, within the project's
 * cap; pending bids rejected once no copy is open) and marks the job refunded
 * by the system, as a missed deadline is. At most `batch` per run, one
 * transaction each; a job that fails is logged and the rest go on.
 * System-owned; runs on the cron next to sweepExpired.
 */
export async function sweepIdleOpenJobs(db: Db, batch = 500) {
  const cutoff = () => new Date(Date.now() - OPEN_JOB_IDLE_HOURS * 3600_000).toISOString();
  const rows = await db.query(`SELECT id FROM jobs WHERE status = 'open' AND ${LAST_ACTIVITY} < ? ORDER BY id LIMIT ?`, [
    cutoff(),
    batch,
  ]);
  const expired: number[] = [];
  for (const r of rows) {
    try {
      const done = await db.transaction(async (tx) => {
        await lockGroup(tx, num(r.id));
        const job = await lockJob(tx, num(r.id));
        // Re-check under the locks: an accept, cancel or new bid (placeBid locks the group too) may have landed since the scan.
        if (job.status !== "open") return false;
        if (!(await tx.query(`SELECT 1 FROM jobs WHERE id = ? AND ${LAST_ACTIVITY} < ?`, [job.id, cutoff()])).length) return false;
        await closeOpenJob(tx, job, "status = 'refunded', verdict = 'fail', verdict_by = 'system', verdict_rationale = ?", [
          `expired: no bid accepted and no new bid for ${OPEN_JOB_IDLE_HOURS} hours; escrow refunded`,
        ]);
        return true;
      });
      if (done) expired.push(num(r.id));
    } catch (e) {
      console.error(`expiring open job ${r.id} failed`, e);
    }
  }
  return { expired };
}

/**
 * Refund escrow on assigned jobs whose workers never submitted before the
 * deadline. System-owned; runs on a cron in the hosted version.
 */
export async function sweepExpired(db: Db) {
  const rows = await db.query("SELECT id FROM jobs WHERE status = 'assigned' AND deadline < ?", [nowIso()]);
  const refunded: number[] = [];
  for (const r of rows) {
    const done = await db.transaction(async (tx) => {
      // Re-check under the lock: a submit or verdict may have landed since the scan.
      const job = await lockJob(tx, num(r.id));
      if (job.status !== "assigned" || !job.deadline || new Date(job.deadline) >= new Date()) return false;
      await refundEscrow(tx, job);
      await tx.query(
        `UPDATE jobs SET status = 'refunded', verdict = 'fail', verdict_by = 'system',
         verdict_rationale = 'deadline passed without submission', escrow = 0, escrow_purchased = 0 WHERE id = ?`,
        [job.id]
      );
      return true;
    });
    if (done) refunded.push(num(r.id));
  }
  return { refunded };
}

/** Hours a submitted job waits for the poster before its escrow releases to the worker. */
export const POSTER_SILENCE_HOURS = 72;

/**
 * Pay the worker on submitted jobs (any kind) whose poster neither approved
 * nor requested changes within POSTER_SILENCE_HOURS of the latest
 * submission. System-owned; runs on the cron next to sweepExpired.
 */
export async function sweepSilentPosters(db: Db) {
  const cutoff = () => new Date(Date.now() - POSTER_SILENCE_HOURS * 3600_000);
  const rows = await db.query("SELECT id FROM jobs WHERE status = 'submitted' AND submitted_at < ?", [
    cutoff().toISOString(),
  ]);
  const released: number[] = [];
  for (const r of rows) {
    const done = await db.transaction(async (tx) => {
      // Re-check under the lock: a verdict, request-changes or resubmission may have landed since the scan.
      const job = await lockJob(tx, num(r.id));
      if (job.status !== "submitted" || !job.submitted_at || new Date(job.submitted_at) >= cutoff()) return false;
      await credit(tx, { table: "agents", id: job.worker }, job.escrow);
      await tx.query(
        `UPDATE jobs SET status = 'completed', verdict = 'pass', verdict_by = 'system', verdict_rationale = ?,
         escrow = 0, escrow_purchased = 0 WHERE id = ?`,
        [
          `poster neither approved nor requested changes within ${POSTER_SILENCE_HOURS} hours of submission; escrow released to the worker`,
          job.id,
        ]
      );
      return true;
    });
    if (done) released.push(num(r.id));
  }
  return { released };
}

/**
 * Upsert today's balance snapshot for every human: main account plus the sum
 * of their agents' balances. Cron-driven, so the day's last run is its close.
 */
export async function snapshotBalances(db: Db) {
  // ponytail: rewrites every human's row each tick; limit to recently changed humans if it gets slow
  await db.query(
    `INSERT INTO balance_snapshots (human_id, day, account, agents)
     SELECT h.id, CURRENT_DATE, h.balance,
       COALESCE((SELECT SUM(a.balance) FROM agents a WHERE a.human_id = h.id), 0)
     FROM humans h
     ON CONFLICT (human_id, day) DO UPDATE SET account = EXCLUDED.account, agents = EXCLUDED.agents`
  );
}

/** A human's daily snapshots for the last 30 days, oldest first. `day` is YYYY-MM-DD (UTC). */
export async function balanceHistory(db: TxDb, humanId: number) {
  const rows = await db.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, account, agents FROM balance_snapshots
     WHERE human_id = ? AND day > CURRENT_DATE - 30 ORDER BY day`,
    [humanId]
  );
  return rows.map((r: any) => ({ day: r.day as string, account: num(r.account), agents: num(r.agents) }));
}

/* ---------- humans ---------- */
/*
 * Moltbook-style linked model: humans and agents are separate accounts.
 * The human owns the dabloon balance (the main account); agents link to a
 * human and hold operational balances for posting bounties. Referral
 * rewards land in the human's main account and can be transferred down.
 *
 * Humans authenticate with magic-link sessions (Bearer). Agents keep their
 * own API tokens. Every agent action is attributable to a human owner —
 * attribution, not proof-of-agenthood, is the enforceable boundary.
 */

/** Referral economics: only a referred signup earns anything. Both sides get
 * this many dabloons on the referee's first email verification; the referrer
 * stops earning after MAX_REFERRALS. A signup with no referral gets nothing. */
export const REFERRAL_BONUS = 100;
export const MAX_REFERRALS = 20;

const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => REFERRAL_CODE_ALPHABET[b % 32]).join("");
}

// Providers where "you+tag@" delivers to "you@" (and, for Gmail, dots in the
// name are ignored). Only these fold together: elsewhere "a+b@" may be a
// different person's mailbox, and folding it would hand them a's account.
const PLUS_ALIAS_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "fastmail.com", "proton.me", "protonmail.com", "pm.me",
]);

/** One address per inbox: lowercase, and fold aliases that reach the same inbox. */
export function normEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  let [local, domain] = [e.slice(0, at), e.slice(at + 1)];
  if (at < 1 || !PLUS_ALIAS_DOMAINS.has(domain)) return e;
  local = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return local ? `${local}@${domain}` : e;
}

function validHandle(handle: string) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(handle);
}

/**
 * Sign up a human. Idempotent on email: an existing address returns the
 * existing row with created:false. authUserId links the row to a Neon Auth
 * user (set at creation for Neon signups).
 */
export async function createHuman(
  db: TxDb,
  o: { email: string; handle?: string; referralCode?: string; authUserId?: string }
) {
  const email = normEmail(o.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("invalid email");
  const handle = o.handle?.trim() || null;
  if (handle && !validHandle(handle))
    throw new Error("handle must be 1-64 chars: letters, digits, _ or -");

  const existing = await db.query("SELECT * FROM humans WHERE email = ?", [email]);
  if (existing.length) return { human: normHuman(existing[0]), created: false };

  let referredBy: number | null = null;
  if (o.referralCode) {
    const ref = await db.query("SELECT id FROM humans WHERE referral_code = ?", [
      o.referralCode.trim().toUpperCase(),
    ]);
    if (!ref.length) throw new Error("unknown referral code");
    referredBy = num(ref[0].id);
  }
  if (handle) {
    const taken = await db.query("SELECT id FROM humans WHERE handle = ?", [handle]);
    if (taken.length) throw new Error(`handle already taken: ${handle}`);
  }

  for (let i = 0; i < 5; i++) {
    try {
      const rows = await db.query(
        `INSERT INTO humans (email, handle, auth_user_id, referral_code, referred_by_human_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
        [email, handle, o.authUserId ?? null, newReferralCode(), referredBy, nowIso()]
      );
      return { human: normHuman(rows[0]), created: true };
    } catch (e: any) {
      if (!/duplicate|unique/i.test(String(e?.message))) throw e;
      const raced = await db.query("SELECT * FROM humans WHERE email = ?", [email]);
      if (raced.length) return { human: normHuman(raced[0]), created: false };
    }
  }
  throw new Error("could not create account — try again");
}

/**
 * Pay the referral bonus: a referred human gets REFERRAL_BONUS, and so does
 * their referrer while still under MAX_REFERRALS. No referral, no bonus.
 * Called once per human: at first verification, or when they redeem a code
 * later (redeemReferral).
 */
async function payReferralBonus(tx: TxDb, humanId: number) {
  const hrows = await tx.query("SELECT referred_by_human_id FROM humans WHERE id = ?", [humanId]);
  const referredBy = hrows[0]?.referred_by_human_id;
  if (referredBy != null) {
    await tx.query("UPDATE humans SET balance = balance + ? WHERE id = ?", [REFERRAL_BONUS, humanId]);
    // Check and increment in one statement: a concurrent referee of the same
    // referrer waits on the row and re-checks the cap after this commits, so
    // two redemptions at 19 can't both pay.
    await tx.query(
      "UPDATE humans SET balance = balance + ?, referral_count = referral_count + 1 WHERE id = ? AND referral_count < ?",
      [REFERRAL_BONUS, num(referredBy), MAX_REFERRALS]
    );
  }
}

/**
 * Find or provision the board human for a verified Neon Auth identity.
 * Matches by auth_user_id first, then by normalized email: a pre-Neon row,
 * or the same inbox under an alias (you+tag@gmail.com signs in to
 * you@gmail.com). A genuinely new, referred human gets the referral bonus.
 */
export async function findOrCreateHumanByAuthId(
  db: Db,
  o: { authUserId: string; email: string; name?: string; referralCode?: string }
) {
  if (!o.authUserId) throw new Error("missing auth user id");
  return db.transaction(async (tx) => {
    const byAuth = await tx.query("SELECT * FROM humans WHERE auth_user_id = ?", [o.authUserId]);
    if (byAuth.length) return { human: normHuman(byAuth[0]), created: false as const };

    const byEmail = await tx.query("SELECT * FROM humans WHERE lower(email) = lower(?)", [
      normEmail(o.email),
    ]);
    if (byEmail.length) {
      // Same inbox (pre-Neon row, or an alias of an existing account): link
      // this Neon identity to it. Neon already verified the email.
      const rows = await tx.query(
        "UPDATE humans SET auth_user_id = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ? RETURNING *",
        [o.authUserId, nowIso(), byEmail[0].id]
      );
      return { human: normHuman(rows[0]), created: false as const };
    }

    const { human } = await createHumanWithFallbackHandle(tx, {
      email: o.email,
      handle: handleFromName(o.name),
      referralCode: o.referralCode,
      authUserId: o.authUserId,
    });
    await tx.query("UPDATE humans SET email_verified_at = ? WHERE id = ?", [nowIso(), human.id]);
    await payReferralBonus(tx, human.id);
    return { human: await getHuman(tx, human.id), created: true as const };
  });
}

/**
 * An existing human enters a referral code after signing up. Once per account,
 * never their own code, and never the code of someone they referred (so two
 * accounts can't trade codes). Pays the same bonus as a referred signup.
 */
export async function redeemReferral(db: Db, humanId: number, code: string) {
  return db.transaction(async (tx) => {
    const ref = await tx.query("SELECT id FROM humans WHERE referral_code = ?", [code.trim().toUpperCase()]);
    if (!ref.length) throw new Error("unknown referral code");
    const referrerId = num(ref[0].id);
    if (referrerId === humanId) throw new Error("you can't use your own referral code");
    // Lock both humans, lower id first, before checking: two people redeeming
    // each other's codes at once take turns here (no deadlock), and the second
    // sees the first's referred_by and is refused.
    const both = await tx.query(
      "SELECT id, referred_by_human_id FROM humans WHERE id = ANY(?) ORDER BY id FOR UPDATE",
      [[humanId, referrerId]]
    );
    const referrer = both.find((r: any) => num(r.id) === referrerId);
    if (referrer?.referred_by_human_id != null && num(referrer.referred_by_human_id) === humanId)
      throw new Error("you can't use a code from someone you referred");
    const set = await tx.query(
      "UPDATE humans SET referred_by_human_id = ? WHERE id = ? AND referred_by_human_id IS NULL RETURNING id",
      [referrerId, humanId]
    );
    if (!set.length) throw new Error("you've already used a referral code");
    await payReferralBonus(tx, humanId);
    return getHuman(tx, humanId);
  });
}

/** Turn a display name into a valid handle, or undefined if nothing usable. */
function handleFromName(name?: string): string | undefined {
  const h = (name ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
  return h || undefined;
}

/**
 * createHuman, but a taken handle falls back to no handle (the human can set
 * one later) instead of failing the whole signup.
 */
async function createHumanWithFallbackHandle(
  tx: TxDb,
  o: { email: string; handle?: string; referralCode?: string; authUserId?: string }
) {
  try {
    return await createHuman(tx, o);
  } catch (e: any) {
    if (o.handle && /handle already taken/.test(e.message)) {
      return await createHuman(tx, { ...o, handle: undefined });
    }
    throw e;
  }
}

/** Mint a 30-day board session for a human. Returns the raw token once. */
export async function createBoardSession(db: Db, humanId: number) {
  const sessionToken = newToken();
  const sessionExpires = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
  await db.query("INSERT INTO sessions (token_hash, human_id, expires_at) VALUES (?, ?, ?)", [
    await hashToken(sessionToken),
    humanId,
    sessionExpires,
  ]);
  return { sessionToken, sessionExpires };
}

export async function getHumanBySessionToken(db: TxDb, token: string) {
  const rows = await db.query(
    `SELECT h.* FROM sessions s JOIN humans h ON h.id = s.human_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    [await hashToken(token), nowIso()]
  );
  return rows.length ? normHuman(rows[0]) : null;
}

export async function destroySession(db: Db, token: string) {
  await db.query("DELETE FROM sessions WHERE token_hash = ?", [await hashToken(token)]);
}

export async function getHuman(db: TxDb, id: number) {
  const rows = await db.query("SELECT * FROM humans WHERE id = ?", [id]);
  if (!rows.length) throw new Error(`unknown human: ${id}`);
  return normHuman(rows[0]);
}

/** Purchased dabloons still in the human's main account — the only refundable part. */
export async function getRefundable(db: TxDb, humanId: number): Promise<number> {
  const rows = await db.query("SELECT purchased_balance FROM humans WHERE id = ?", [humanId]);
  if (!rows.length) throw new Error(`unknown human: ${humanId}`);
  return num(rows[0].purchased_balance);
}

export async function setHandle(db: Db, humanId: number, handle: string) {
  handle = handle.trim();
  if (!validHandle(handle))
    throw new Error("handle must be 1-64 chars: letters, digits, _ or -");
  const taken = await db.query("SELECT id FROM humans WHERE handle = ? AND id != ?", [handle, humanId]);
  if (taken.length) throw new Error(`handle already taken: ${handle}`);
  await db.query("UPDATE humans SET handle = ? WHERE id = ?", [handle, humanId]);
  return getHuman(db, humanId);
}

/**
 * A human's agents with their bounty activity: active_jobs counts bounties
 * they posted or are working that aren't settled yet; escrow is what's locked
 * in bounties they posted from their own balance (not a project's allowance).
 */
export async function listAgentsForHuman(db: TxDb, humanId: number) {
  const rows = await db.query(
    `SELECT a.name, a.balance, a.daily_spend_cap, a.created_at,
       (SELECT COUNT(*) FROM jobs j WHERE (j.poster = a.name OR j.worker = a.name)
          AND j.status IN ('open', 'assigned', 'submitted')) AS active_jobs,
       (SELECT COALESCE(SUM(j.escrow), 0) FROM jobs j WHERE j.poster = a.name AND j.project_id IS NULL) AS escrow
     FROM agents a WHERE a.human_id = ? ORDER BY a.name`,
    [humanId]
  );
  return rows.map((r: any) => ({ ...normAgent(r), active_jobs: num(r.active_jobs), escrow: num(r.escrow) }));
}

/** Admin grant into a human's main account. Earned, never refundable. System-owned. */
export async function fundHuman(db: Db, id: number, amount: number) {
  await getHuman(db, id);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("amount must be a positive integer");
  await db.query("UPDATE humans SET balance = balance + ? WHERE id = ?", [amount, id]);
  return getHuman(db, id);
}

/**
 * A human provisions an agent under their account. The token is shown once —
 * this is what the human pastes into their agent's environment.
 */
export async function provisionAgentForHuman(db: Db, humanId: number, name: string) {
  name = name.trim();
  checkAgentName(name);
  const token = newToken();
  const tokenHash = await hashToken(token);
  return db.transaction(async (tx) => {
    await checkAgentCap(tx, humanId);
    if ((await tx.query("SELECT 1 FROM agents WHERE name = ?", [name])).length) throw new Error(`agent already exists: ${name}`);
    await tx.query("INSERT INTO agents (name, balance, api_token_hash, human_id, created_at) VALUES (?, 0, ?, ?, ?)", [
      name, tokenHash, humanId, nowIso(),
    ]);
    return { name, balance: 0, human_id: humanId, token };
  });
}

/**
 * A human claims an agent that self-registered before sign-up required a
 * human, by proving control of its API token (Moltbook-style). After claiming, the human can fund and manage it.
 */
export async function claimAgent(db: Db, humanId: number, agentName: string, agentToken: string) {
  const tokenHash = await hashToken(agentToken);
  return db.transaction(async (tx) => {
    const rows = await tx.query("SELECT * FROM agents WHERE name = ? FOR UPDATE", [agentName]);
    const agent = rows[0];
    if (!agent) throw new Error(`unknown agent: ${agentName}`);
    if (!agent.api_token_hash || agent.api_token_hash !== tokenHash)
      throw new Error("agent token does not match — only the agent's owner can claim it");
    if (agent.human_id != null && num(agent.human_id) !== humanId)
      throw new Error("agent is already claimed by another human");
    if (agent.human_id == null) await checkAgentCap(tx, humanId);
    await tx.query("UPDATE agents SET human_id = ? WHERE name = ?", [humanId, agentName]);
    return normAgent({ ...agent, human_id: humanId });
  });
}

/**
 * Lock the balance rows a transfer touches before reading or moving
 * anything, in one global order: the human, then their agents by name. Every
 * transfer between a human and agents goes through this, so two opposite
 * transfers (main -> agent vs agent -> main, or A -> B vs B -> A) wait for
 * each other instead of deadlocking. Lock order overall: job rows (by id),
 * then acceptBid's per-human advisory lock, then one project, human or agent
 * balance (settlements); transfers take human, then agents.
 */
async function lockBalances(tx: TxDb, humanId: number, agentNames: string[]) {
  await tx.query("SELECT 1 FROM humans WHERE id = ? FOR UPDATE", [humanId]);
  if (agentNames.length) await tx.query("SELECT 1 FROM agents WHERE name = ANY(?) ORDER BY name FOR UPDATE", [agentNames]);
}

/** Move dabloons from a human's main account into one of their agents. Atomic. */
export async function transferToAgent(db: Db, o: { humanId: number; agentName: string; amount: number }) {
  if (!Number.isInteger(o.amount) || o.amount <= 0)
    throw new Error("amount must be a positive integer");
  return db.transaction(async (tx) => {
    await lockBalances(tx, o.humanId, [o.agentName]);
    const arows = await tx.query("SELECT * FROM agents WHERE name = ?", [o.agentName]);
    const agent = arows[0];
    if (!agent) throw new Error(`unknown agent: ${o.agentName}`);
    if (agent.human_id == null || num(agent.human_id) !== o.humanId)
      throw new Error("you can only fund your own agents — claim it first");
    // The purchased part travels with the dabloons, purchased first; earned stays earned.
    const purchased = await debit(tx, { table: "humans", id: o.humanId }, o.amount);
    if (purchased == null) throw new Error("insufficient dabloons in your main account");
    await credit(tx, { table: "agents", id: o.agentName }, o.amount, purchased);
    const updated = await tx.query("SELECT * FROM agents WHERE name = ?", [o.agentName]);
    return { human: await getHuman(tx, o.humanId), agent: normAgent(updated[0]) };
  });
}

/** Sweep dabloons from one of your agents back to your main account. Atomic. */
export async function transferToHuman(
  db: Db,
  o: { humanId: number; agentName: string; amount?: number }
) {
  return db.transaction(async (tx) => {
    await lockBalances(tx, o.humanId, [o.agentName]);
    const arows = await tx.query("SELECT * FROM agents WHERE name = ?", [o.agentName]);
    const agent = arows[0];
    if (!agent) throw new Error(`unknown agent: ${o.agentName}`);
    if (agent.human_id == null || num(agent.human_id) !== o.humanId)
      throw new Error("you can only sweep your own agents");
    const amount = o.amount == null ? num(agent.balance) : o.amount;
    if (!Number.isInteger(amount) || amount <= 0)
      throw new Error("amount must be a positive integer");
    // The purchased part travels with the dabloons, purchased first; earned stays earned.
    const purchased = await debit(tx, { table: "agents", id: o.agentName }, amount);
    if (purchased == null) throw new Error("insufficient dabloons in the agent's account");
    await credit(tx, { table: "humans", id: o.humanId }, amount, purchased);
    const updated = await tx.query("SELECT * FROM agents WHERE name = ?", [o.agentName]);
    return { human: await getHuman(tx, o.humanId), agent: normAgent(updated[0]) };
  });
}

async function mustOwnAgent(db: TxDb, humanId: number, agentName: string) {
  const agent = await mustAgent(db, agentName);
  if (agent.human_id == null || num(agent.human_id) !== humanId)
    throw new Error("you can only manage your own agents");
  return agent;
}

/** Bounties any of a human's agents posted or worked, newest first. Optionally one agent. */
export async function listJobsForHuman(db: TxDb, humanId: number, agentName?: string) {
  // ponytail: fixed 500-row cap, add limit/offset when an owner outgrows it
  if (agentName) {
    await mustOwnAgent(db, humanId, agentName);
    const rows = await db.query(
      "SELECT * FROM jobs WHERE poster = ? OR worker = ? ORDER BY id DESC LIMIT 500",
      [agentName, agentName]
    );
    return rows.map(normJob);
  }
  const rows = await db.query(
    `SELECT * FROM jobs
     WHERE poster IN (SELECT name FROM agents WHERE human_id = ?)
        OR worker IN (SELECT name FROM agents WHERE human_id = ?)
     ORDER BY id DESC LIMIT 500`,
    [humanId, humanId]
  );
  return rows.map(normJob);
}

/**
 * Move dabloons between any two of a human's balances: the main account
 * (fromAgent/toAgent omitted) or one of their agents. Atomic.
 */
export async function transferForHuman(
  db: Db,
  o: { humanId: number; fromAgent?: string; toAgent?: string; amount: number }
) {
  if (!Number.isInteger(o.amount) || o.amount <= 0) throw new Error("amount must be a positive integer");
  if (o.fromAgent === o.toAgent) throw new Error("choose two different accounts");
  return db.transaction(async (tx) => {
    await lockBalances(tx, o.humanId, [o.fromAgent, o.toAgent].filter((n): n is string => !!n));
    for (const name of [o.fromAgent, o.toAgent]) if (name) await mustOwnAgent(tx, o.humanId, name);
    const account = (name?: string): Account =>
      name ? { table: "agents", id: name } : { table: "humans", id: o.humanId };
    const purchased = await debit(tx, account(o.fromAgent), o.amount);
    if (purchased == null) throw new Error("insufficient dabloons");
    // Both ends are this human's own (checked above), so the purchased part
    // travels with the dabloons, purchased first. A transfer to anyone else
    // must credit all of it as earned (credit's default) — never pass
    // `purchased` across owners, or a purchase could be refunded by someone else.
    await credit(tx, account(o.toAgent), o.amount, purchased);
    return getHuman(tx, o.humanId);
  });
}

/** Owner resets one of their agents' API token. The new token is shown once. */
export async function rotateTokenForHuman(db: Db, humanId: number, agentName: string) {
  await mustOwnAgent(db, humanId, agentName);
  return rotateToken(db, agentName);
}

/* ---------- open source projects ----------
 * A human claims a GitHub repo, commits a .dabloons file holding the claim's
 * verify_code, and web/src/github.ts checks the file and the bar (public, not
 * a fork, has a license file, enough stars, old enough) before
 * markProjectVerified. A verified project gets PROJECT_ALLOWANCE right away,
 * then is topped back up to it every calendar month (UTC) by the cron: unused
 * dabloons don't pile up. Only the owning human's agents post from it
 * (postJob's `project`), refunds return to it, and its own agents can't bid.
 */

/** Monthly allowance for a verified project: about 100 bounties at the minimum prices ($200 at 100 dabloons per $1). */
export const PROJECT_ALLOWANCE = 20000;

/** "owner/name" from "owner/name" or a github.com URL, lowercased. */
export function parseRepo(input: string): string {
  const m = String(input ?? "")
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/(\.git)?\/*$/i, "")
    .match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
  if (!m || /^\.+$/.test(m[2])) throw new Error("repo must be a GitHub repo like owner/name");
  return `${m[1]}/${m[2]}`.toLowerCase();
}

function normProject(p: any) {
  return {
    id: num(p.id),
    repo: p.repo as string,
    verified: p.verified_at != null,
    verified_at: iso(p.verified_at),
    // Only needed until verified: it's what goes in the repo's .dabloons file.
    verify_code: p.verified_at == null ? (p.verify_code as string) : null,
    balance: num(p.balance),
    created_at: iso(p.created_at),
  };
}

/** Start (or return) this human's claim on a repo. Nothing is paid until it's verified. */
export async function claimProject(db: TxDb, humanId: number, repoInput: string) {
  const repo = parseRepo(repoInput);
  const taken = await db.query("SELECT human_id FROM projects WHERE repo = ? AND verified_at IS NOT NULL", [repo]);
  if (taken.length)
    throw new Error(
      num(taken[0].human_id) === humanId ? `you already verified ${repo}` : `${repo} is already verified by its maintainer`
    );
  await db.query(
    "INSERT INTO projects (repo, human_id, verify_code) VALUES (?, ?, ?) ON CONFLICT (repo, human_id) DO NOTHING",
    [repo, humanId, "dabloons-verify-" + newToken().slice(0, 24)]
  );
  const rows = await db.query("SELECT * FROM projects WHERE repo = ? AND human_id = ?", [repo, humanId]);
  return normProject(rows[0]);
}

export async function listProjectsForHuman(db: TxDb, humanId: number) {
  const rows = await db.query("SELECT * FROM projects WHERE human_id = ? ORDER BY id", [humanId]);
  return rows.map(normProject);
}

export async function getProjectForHuman(db: TxDb, humanId: number, id: number) {
  const rows = await db.query("SELECT * FROM projects WHERE id = ? AND human_id = ?", [id, humanId]);
  if (!rows.length) throw new Error(`unknown project: ${id}`);
  return normProject(rows[0]);
}

/**
 * Mark a claim verified (the caller already checked GitHub) and pay the first
 * allowance. The partial unique index is the backstop: two claims on one repo
 * can't both be verified.
 */
export async function markProjectVerified(db: Db, humanId: number, id: number) {
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx.query("SELECT * FROM projects WHERE id = ? AND human_id = ? FOR UPDATE", [id, humanId]);
      if (!rows.length) throw new Error(`unknown project: ${id}`);
      if (rows[0].verified_at != null) return normProject(rows[0]);
      const now = nowIso();
      const updated = await tx.query(
        "UPDATE projects SET verified_at = ?, topped_up_at = ?, balance = GREATEST(balance, ?) WHERE id = ? RETURNING *",
        [now, now, PROJECT_ALLOWANCE, id]
      );
      return normProject(updated[0]);
    });
  } catch (e: any) {
    if (/unique|duplicate/i.test(String(e?.message))) throw new Error("this repo is already verified by its maintainer");
    throw e;
  }
}

/**
 * Cron: once per calendar month (UTC), refill every verified project to
 * PROJECT_ALLOWANCE. Escrow in all its unsettled bounties (open, assigned or
 * submitted) counts toward the new month, so balance + escrow never exceeds
 * PROJECT_ALLOWANCE: escrow refunded later in the month (cancel, expiry,
 * missed deadline, late submission, admin fail) only gives back what was
 * already counted, and the allowance can't be banked across months.
 * Race-safe: the due projects are row-locked first, and every escrow
 * increase (posting, accepting at a higher price) debits its project under
 * that row lock, so the escrow sum read after the lock misses none of them.
 */
export async function topUpProjects(db: Db) {
  const d = new Date();
  const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  const due = "verified_at IS NOT NULL AND (topped_up_at IS NULL OR topped_up_at < ?)";
  await db.transaction(async (tx) => {
    await tx.query(`SELECT id FROM projects WHERE ${due} ORDER BY id FOR UPDATE`, [monthStart]);
    await tx.query(
      `UPDATE projects p SET topped_up_at = ?, balance = GREATEST(balance, ? -
         (SELECT COALESCE(SUM(escrow), 0) FROM jobs WHERE project_id = p.id AND status IN ('open', 'assigned', 'submitted')))
       WHERE ${due}`,
      [nowIso(), PROJECT_ALLOWANCE, monthStart]
    );
  });
}

/* ---------- stripe payments ---------- */

export interface StripePayment {
  stripe_session_id: string;
  stripe_event_id: string;
  human_id: number;
  usd_cents: number;
  dabloons: number;
}

function normPayment(r: any) {
  return {
    ...r,
    id: num(r.id),
    human_id: num(r.human_id),
    usd_cents: num(r.usd_cents),
    dabloons: num(r.dabloons),
    created_at: iso(r.created_at),
  };
}

/**
 * Record a completed Stripe Checkout payment and credit the human's main
 * account. Idempotent on stripe_session_id: a retried webhook returns the
 * existing row instead of crediting twice. The UNIQUE constraint is the
 * backstop — a raced duplicate insert fails rather than double-pays.
 */
export async function recordStripePayment(db: Db, p: StripePayment) {
  return db.transaction(async (tx) => {
    const existing = await tx.query("SELECT * FROM payments WHERE stripe_session_id = ?", [
      p.stripe_session_id,
    ]);
    if (existing.length) return { payment: normPayment(existing[0]), duplicate: true as const };
    if (!Number.isInteger(p.usd_cents) || p.usd_cents <= 0) throw new Error("bad usd amount");
    if (!Number.isInteger(p.dabloons) || p.dabloons <= 0) throw new Error("bad dabloon amount");
    await getHuman(tx, p.human_id);
    const rows = await tx.query(
      `INSERT INTO payments (stripe_session_id, stripe_event_id, human_id, usd_cents, dabloons, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'completed', ?) RETURNING *`,
      [p.stripe_session_id, p.stripe_event_id, p.human_id, p.usd_cents, p.dabloons, nowIso()]
    );
    // The only mint of purchased dabloons: a completed Stripe checkout. Only
    // what the card paid for counts; bonus-tier dabloons on top are earned.
    const paidFor = Math.min(p.dabloons, p.usd_cents * DABLOONS_PER_CENT);
    await credit(tx, { table: "humans", id: p.human_id }, p.dabloons, paidFor);
    return { payment: normPayment(rows[0]), duplicate: false as const };
  });
}

export async function listPaymentsForHuman(db: TxDb, humanId: number) {
  const rows = await db.query("SELECT * FROM payments WHERE human_id = ? ORDER BY id DESC", [humanId]);
  return rows.map(normPayment);
}

/* ---------- device-flow login (`dabloons login`) ----------
 * The CLI starts a flow and shows a short user_code; the human approves it
 * in the browser at /device; the CLI polls until approved and receives the
 * agent API token once. The agent is born linked to the approving human, so
 * transfers work immediately — no separate claim step.
 *
 * Security: the random device_code IS the future agent API token. Only its
 * SHA-256 hash is ever stored — device_code_hash doubles as the agent's
 * api_token_hash at approval. No plaintext credential is persisted anywhere;
 * the token is handed to the polling device exactly once.
 */

const DEVICE_CODE_TTL_SEC = 600;
// Unambiguous: no 0/O, 1/I.
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]);
  return chars.slice(0, 4).join("") + "-" + chars.slice(4).join("");
}

function autoAgentName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = [...bytes].map((b) => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]).join("").toLowerCase();
  return `agent-${suffix}`;
}

function normDeviceFlow(f: any) {
  return {
    id: num(f.id),
    status: f.status,
    user_code: f.user_code,
    suggested_name: f.suggested_name ?? null,
    human_id: f.human_id == null ? null : num(f.human_id),
    agent_name: f.agent_name ?? null,
    created_at: iso(f.created_at),
    expires_at: iso(f.expires_at),
  };
}

/**
 * Start a device flow. Returns the plaintext device_code (for the device
 * only — only its hash is stored) plus the public flow details.
 */
export async function createDeviceFlow(db: Db, o: { suggestedName?: string } = {}) {
  const deviceCode = newToken();
  const suggested = (o.suggestedName ?? "").trim() || null;
  if (suggested) checkAgentName(suggested);
  for (let tries = 0; tries < 8; tries++) {
    try {
      const rows = await db.query(
        `INSERT INTO device_flows (device_code_hash, user_code, suggested_name, expires_at)
         VALUES (?, ?, ?, ?)
         RETURNING id, status, user_code, suggested_name, human_id, agent_name, created_at, expires_at`,
        [await hashToken(deviceCode), makeUserCode(), suggested, new Date(Date.now() + DEVICE_CODE_TTL_SEC * 1000).toISOString()]
      );
      return { deviceCode, flow: normDeviceFlow(rows[0]), expiresIn: DEVICE_CODE_TTL_SEC };
    } catch (e: any) {
      if (!/unique|duplicate/i.test(e.message)) throw e; // user_code collision: mint another
    }
  }
  throw new Error("could not mint a device code — try again");
}

/**
 * Device polling. Returns { agent, token } exactly once: the first poll
 * after approval consumes the flow and hands the device its API token —
 * the device_code itself, which only ever existed as a hash server-side.
 * Later polls fail; the token is never persisted.
 * Throws authorization_pending / expired / unknown errors for the poller.
 */
export async function pollDeviceFlow(db: Db, deviceCode: string) {
  const code = String(deviceCode ?? "");
  const rows = await db.query("SELECT id, status, agent_name, expires_at FROM device_flows WHERE device_code_hash = ?", [
    await hashToken(code),
  ]);
  const flow = rows[0];
  if (!flow) throw new Error("unknown device code — run `dabloons login` again");
  // Expiry is checked on this one row (the cron deletes expired flows); a flow never approved in time is dead.
  if (flow.status === "expired" || (flow.status === "pending" && new Date(flow.expires_at).getTime() <= Date.now()))
    throw new Error("device code expired — run `dabloons login` again");
  if (flow.status === "pending") throw new Error("authorization_pending");
  if (flow.status !== "approved") throw new Error("token already retrieved — it was shown once");
  return db.transaction(async (tx) => {
    const picked = await tx.query(
      "UPDATE device_flows SET status = 'consumed' WHERE id = ? AND status = 'approved' RETURNING agent_name",
      [flow.id]
    );
    if (!picked.length) throw new Error("token already retrieved — it was shown once");
    const a = await tx.query("SELECT name, balance FROM agents WHERE name = ?", [picked[0].agent_name]);
    return {
      agent: { name: a[0].name, balance: num(a[0].balance) },
      token: code, // the device_code doubles as the agent API token
    };
  });
}

/**
 * Human approves a pending flow in the browser. Atomic: provisions the agent
 * already linked to them and marks the flow approved in one transaction, so a
 * racing/failed approval can't orphan an agent. The device_code becomes the
 * agent's API token — only its hash is stored, on both the flow and the
 * agent. Name precedence: approve-time name > device-suggested name >
 * generated.
 */
export async function approveDeviceFlow(db: Db, humanId: number, userCode: string, name?: string) {
  const code = String(userCode ?? "").trim().toUpperCase();
  return db.transaction(async (tx) => {
    const rows = await tx.query(
      "SELECT * FROM device_flows WHERE user_code = ? AND status = 'pending' AND expires_at > ? FOR UPDATE",
      [code, nowIso()]
    );
    const flow = rows[0];
    if (!flow) throw new Error("unknown or expired code — check the code on your device and try again");
    await checkAgentCap(tx, humanId);
    const finalName = (name ?? "").trim() || flow.suggested_name || autoAgentName();
    checkAgentName(finalName);
    const taken = await tx.query("SELECT name FROM agents WHERE name = ?", [finalName]);
    if (taken.length) throw new Error(`agent already exists: ${finalName}`);
    await tx.query("INSERT INTO agents (name, balance, created_at) VALUES (?, 0, ?)", [finalName, nowIso()]);
    await tx.query("UPDATE agents SET api_token_hash = ?, api_token_kind = 'login', human_id = ? WHERE name = ?", [
      flow.device_code_hash,
      humanId,
      finalName,
    ]);
    await tx.query(
      "UPDATE device_flows SET status = 'approved', human_id = ?, agent_name = ?, approved_at = ? WHERE id = ?",
      [humanId, finalName, nowIso(), flow.id]
    );
    return { agent: { name: finalName, balance: 0 } };
  });
}

