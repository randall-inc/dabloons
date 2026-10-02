/**
 * Neon Auth (managed Better Auth) email-OTP sign-in, verified by the Worker.
 *
 * Primary path: the device (browser or headless agent) talks to Neon Auth
 * directly — sends the code, redeems it, then GETs {base}/token with Neon's
 * session cookie to get a short-lived EdDSA JWT — and POSTs that JWT to
 * /api/auth/neon-exchange. The Worker verifies it locally against Neon's
 * JWKS (verifyJwt), so there is no per-sign-in call to Neon and Neon's
 * per-IP limit on /sign-in/* applies to each user's own IP.
 *
 * Fallback (verifyEmailOtp): the Worker redeems {email, otp} with Neon
 * server-to-server, for browsers that drop Neon's partitioned third-party
 * cookie so /token fails. That shares Neon's per-IP limit across every user
 * (all calls come from Cloudflare egress), so the route rate-limits it.
 * (Neon has no bearer plugin: /get-session only honours its signed HttpOnly
 * cookie; the `token` in the sign-in response body is useless server-side.)
 */

export interface NeonUser {
  id: string;
  email: string;
  name?: string;
  emailVerified: boolean;
}

/**
 * Redeem an emailed one-time code with Neon Auth. Returns the signed-in user,
 * null if Neon rejects the code, or "rate_limited" if Neon's per-IP limit
 * (shared by every user on this path) answered 429 — the code is still
 * unused. `origin` must be one of Neon Auth's trusted origins (the board's).
 */
export async function verifyEmailOtp(
  baseUrl: string,
  origin: string,
  email: string,
  otp: string
): Promise<NeonUser | null | "rate_limited"> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, "")}/sign-in/email-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email, otp }),
    });
  } catch {
    return null;
  }
  if (res.status === 429) return "rate_limited";
  if (!res.ok) return null;
  const data: any = await res.json().catch(() => null);
  const u = data?.user;
  if (!u?.id || !u?.email) return null;
  return {
    id: String(u.id),
    email: String(u.email),
    name: typeof u.name === "string" && u.name ? u.name : undefined,
    emailVerified: !!u.emailVerified,
  };
}

/* ---------- JWT (primary path) ---------- */

type Jwk = { kid?: string; kty?: string; crv?: string; x?: string };

// Per-isolate JWKS cache. Refetched after JWKS_TTL_MS, or early when a token
// names a kid we don't have (key rotation) — at most once per
// JWKS_MIN_REFETCH_MS, so junk kids can't make us hammer Neon.
const JWKS_TTL_MS = 10 * 60_000;
const JWKS_MIN_REFETCH_MS = 30_000;
const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();

async function jwks(base: string, kid: unknown, now: number): Promise<Jwk[]> {
  const url = `${base}/.well-known/jwks.json`;
  const hit = jwksCache.get(url);
  const fresh = hit && now - hit.at < JWKS_TTL_MS;
  const knowsKid = hit?.keys.some((k) => k.kid === kid);
  if (hit && fresh && (knowsKid || now - hit.at < JWKS_MIN_REFETCH_MS)) return hit.keys;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`jwks ${res.status}`);
    const keys = ((await res.json()) as any)?.keys;
    if (!Array.isArray(keys)) throw new Error("jwks: no keys");
    jwksCache.set(url, { keys, at: now });
    return keys;
  } catch (e) {
    if (hit) return hit.keys; // Neon blip: keep the keys we had
    throw e;
  }
}

const b64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const b64json = (s: string): any => JSON.parse(new TextDecoder().decode(b64url(s)));

/**
 * Verify a Neon Auth JWT (from GET {base}/token) against Neon's JWKS.
 * Returns the user, or null for anything invalid: malformed, bad signature,
 * unknown key, expired, wrong issuer/audience, unverified email, banned.
 * Neon sets iss = aud = the auth host's origin, sub = user id, 15-min exp.
 * Throws only if the JWKS can't be fetched at all.
 */
export async function verifyJwt(
  baseUrl: string,
  jwt: string,
  now = Date.now()
): Promise<NeonUser | null> {
  const base = baseUrl.replace(/\/+$/, "");
  const expected = new URL(base).origin;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  let header: any, claims: any, sig: Uint8Array;
  try {
    header = b64json(parts[0]);
    claims = b64json(parts[1]);
    sig = b64url(parts[2]);
  } catch {
    return null;
  }
  if (header?.alg !== "EdDSA" || !claims || typeof claims !== "object") return null;
  const jwk = (await jwks(base, header.kid, now)).find(
    (k) => k.kid === header.kid && k.kty === "OKP" && k.crv === "Ed25519" && k.x
  );
  if (!jwk) return null;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: jwk.x },
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    if (!(await crypto.subtle.verify({ name: "Ed25519" }, key, sig, data))) return null;
  } catch {
    return null;
  }
  const sec = now / 1000;
  const skew = 30;
  if (typeof claims.exp !== "number" || claims.exp + skew < sec) return null;
  if (typeof claims.nbf === "number" && claims.nbf - skew > sec) return null;
  if (claims.iss !== expected) return null;
  if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(expected)) return null;
  // Board accounts link to pre-Neon humans by email, so only a verified email counts.
  if (!claims.sub || !claims.email || claims.emailVerified !== true || claims.banned === true)
    return null;
  return {
    id: String(claims.sub),
    email: String(claims.email),
    name: typeof claims.name === "string" && claims.name ? claims.name : undefined,
    emailVerified: true,
  };
}
