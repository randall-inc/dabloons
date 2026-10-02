/**
 * Open source project verification against the GitHub REST API. A repo
 * qualifies when it is public, not a fork or archived, has a license file
 * (any: GitHub can't name custom ones like curl's), has MIN_STARS stars, is
 * MIN_AGE_DAYS old, and its default branch has a .dabloons file containing the claim's verify code
 * (proof that the claimant can push to it). Unauthenticated calls share
 * GitHub's 60/hour per-IP limit with everything else on Cloudflare's egress
 * IPs; set the GITHUB_TOKEN secret (any token, no scopes needed) for 5,000/hour.
 */

export const MIN_STARS = 50;
export const MIN_AGE_DAYS = 90;
export const PROOF_FILE = ".dabloons";

async function gh(path: string, token?: string) {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "dabloons.net",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error(`GitHub is unavailable (${res.status}) — try again later`), { status: 502 });
  return res.json() as Promise<any>;
}

/** Throws a plain Error naming the first thing that fails; resolves when the repo qualifies. */
export async function checkRepo(repo: string, verifyCode: string, token?: string): Promise<void> {
  const r = await gh(`/repos/${repo}`, token);
  if (!r) throw new Error(`${repo} was not found on GitHub, or it is private`);
  if (String(r.full_name).toLowerCase() !== repo)
    throw new Error(`${repo} has moved to ${r.full_name} — claim that name instead`);
  if (r.private) throw new Error(`${repo} is private`);
  if (r.fork) throw new Error(`${repo} is a fork — claim the original repo`);
  if (r.archived) throw new Error(`${repo} is archived`);
  if (!r.license) throw new Error(`${repo} needs an open source license (a LICENSE file)`);
  if (r.stargazers_count < MIN_STARS)
    throw new Error(`${repo} needs at least ${MIN_STARS} stars (it has ${r.stargazers_count})`);
  if (Date.now() - new Date(r.created_at).getTime() < MIN_AGE_DAYS * 86400_000)
    throw new Error(`${repo} must be at least ${MIN_AGE_DAYS} days old`);

  const f = await gh(`/repos/${repo}/contents/${PROOF_FILE}?ref=${encodeURIComponent(r.default_branch)}`, token);
  if (!f || f.type !== "file")
    throw new Error(`add a ${PROOF_FILE} file to the root of ${r.default_branch} containing ${verifyCode}`);
  if (!atob(String(f.content).replace(/\s/g, "")).includes(verifyCode))
    throw new Error(`${PROOF_FILE} on ${r.default_branch} doesn't contain ${verifyCode}`);
}
