import { api } from './api'

/**
 * Email one-time-code sign-in via Neon Auth, the same flow the Worker
 * documents in llms.txt.
 *
 * Primary: the browser redeems the code with Neon itself (its own IP, its own
 * Neon rate limit), fetches a JWT from Neon's /token with Neon's cookie, and
 * trades the JWT at /api/auth/neon-exchange. If the browser won't keep Neon's
 * partitioned third-party cookie (/token fails), that code is already spent:
 * email a fresh one and let the board redeem codes from then on (fallback,
 * remembered in localStorage).
 */

const FALLBACK_KEY = 'dabloons_neon_fallback'

export const RESENT_MESSAGE =
  "This browser blocks Neon's sign-in cookie, so we emailed you a new code. Enter that one."

type AuthConfig = { neon_auth_base_url: string | null; reviewer_email?: string | null }
let config: Promise<AuthConfig> | undefined
const authConfig = () => (config ??= api<AuthConfig>('/auth/config'))

async function authBaseUrl() {
  const r = await authConfig()
  if (!r.neon_auth_base_url) throw new Error('Sign-in is not configured')
  return r.neon_auth_base_url
}

/** The app-directory reviewer's email (signs in with a password), or null. */
export async function reviewerEmail() {
  return (await authConfig()).reviewer_email ?? null
}

async function neon(path: string, body?: unknown) {
  const init: RequestInit = { credentials: 'include' }
  if (body) {
    init.method = 'POST'
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  try {
    const r = await fetch((await authBaseUrl()) + path, init)
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) }
  } catch {
    return { ok: false, status: 0, json: {} as Record<string, unknown> }
  }
}

function neonError(r: { status: number; json: Record<string, unknown> }, fallback: string) {
  if (r.status === 429) return new Error('Too many attempts. Wait a minute and try again.')
  if (r.status === 0) return new Error('Network error. Try again.')
  return new Error(typeof r.json.message === 'string' ? r.json.message : fallback)
}

export async function sendCode(email: string) {
  const r = await neon('/email-otp/send-verification-otp', { email, type: 'sign-in' })
  if (!r.ok) throw neonError(r, "Couldn't send code")
}

type Exchange = { session_token: string }

/**
 * Signs in and returns the board session token, or `{ resent: true }` when
 * the browser blocked Neon's cookie and a fresh code was emailed instead.
 */
export async function verifyCode(
  email: string,
  otp: string,
  referralCode?: string,
  ageConfirmed?: boolean
): Promise<string | { resent: true }> {
  if (localStorage.getItem(FALLBACK_KEY)) {
    const x = await api<Exchange>('/auth/neon-exchange', { email, otp, referral_code: referralCode, age_confirmed: ageConfirmed })
    return x.session_token
  }
  const r = await neon('/sign-in/email-otp', { email, otp })
  if (!r.ok) throw neonError(r, 'Invalid or expired code')
  const t = await neon('/token')
  if (t.ok && typeof t.json.token === 'string') {
    const x = await api<Exchange>('/auth/neon-exchange', { jwt: t.json.token, referral_code: referralCode, age_confirmed: ageConfirmed })
    return x.session_token
  }
  localStorage.setItem(FALLBACK_KEY, '1')
  await sendCode(email)
  return { resent: true }
}
