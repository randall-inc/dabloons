/**
 * OAuth 2.1 client handling for the hosted MCP server. Grants and tokens live
 * in shared/core.ts; this file only answers "who is this client and may it
 * redirect there?".
 *
 * Two kinds of client_id, neither stored:
 *   https://...   a Client ID Metadata Document (CIMD): we fetch it and read
 *                 its client_name and redirect_uris (Claude, ChatGPT, VS Code).
 *   dcr_<b64url>  issued by POST /oauth/register (Dynamic Client Registration):
 *                 the registration itself, encoded. Registration is open to
 *                 anyone, so encoding it instead of storing it changes nothing
 *                 about trust: the consent page always shows where it returns.
 */

export type Client = { client_id: string; client_name: string; redirect_uris: string[] };

const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0)));

const isLoopback = (u: URL) => u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);

/** https, http on loopback, or a native app's private scheme (cursor://...). Never javascript:, data:, file:. */
function allowedRedirect(uri: string) {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:" || isLoopback(u)) return true;
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !["http:", "javascript:", "data:", "file:", "vbscript:", "blob:"].includes(u.protocol);
}

/** Exact match, except loopback redirects may use any port (RFC 8252 §7.3). */
export function redirectAllowed(client: Client, uri: string) {
  if (client.redirect_uris.includes(uri)) return true;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (!isLoopback(u)) return false;
  return client.redirect_uris.some((r) => {
    try {
      const v = new URL(r);
      return isLoopback(v) && v.hostname === u.hostname && v.pathname === u.pathname && v.search === u.search;
    } catch {
      return false;
    }
  });
}

/** POST /oauth/register body -> the client, or an error message. */
export function register(body: any): Client | string {
  const uris = body?.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((u) => typeof u === "string" && allowedRedirect(u)))
    return "redirect_uris must be 1-10 https, loopback http, or app-scheme URLs";
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : "MCP client";
  const client_id = "dcr_" + b64url(JSON.stringify({ n: name, r: uris }));
  if (client_id.length > 4000) return "registration too large";
  return { client_id, client_name: name, redirect_uris: uris };
}

const CIMD_MAX_BYTES = 5 * 1024;

/** The body as text, or null once it passes `max` bytes (stops reading there). */
async function readCapped(res: Response, max: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Resolve a client_id, or null if it is unknown or malformed. */
export async function resolveClient(clientId: string): Promise<Client | null> {
  if (clientId.startsWith("dcr_")) {
    try {
      const { n, r } = JSON.parse(unb64url(clientId.slice(4)));
      if (typeof n === "string" && Array.isArray(r) && r.every((u: unknown) => typeof u === "string" && allowedRedirect(u)))
        return { client_id: clientId, client_name: n, redirect_uris: r };
    } catch {}
    return null;
  }
  if (clientId.startsWith("https://")) {
    try {
      // Anyone can name any URL here, so: no redirects, JSON only, at most 5 KB.
      const res = await fetch(clientId, {
        headers: { accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      if (res.status !== 200 || !/^application\/(.+\+)?json\b/i.test(res.headers.get("content-type") ?? "")) return null;
      if (Number(res.headers.get("content-length") ?? 0) > CIMD_MAX_BYTES) return null;
      const text = await readCapped(res, CIMD_MAX_BYTES);
      if (text == null) return null;
      const doc: any = JSON.parse(text);
      if (doc?.client_id !== clientId || !Array.isArray(doc.redirect_uris)) return null;
      const uris = doc.redirect_uris.filter((u: unknown) => typeof u === "string" && allowedRedirect(u));
      if (!uris.length) return null;
      const name = typeof doc.client_name === "string" && doc.client_name.trim() ? doc.client_name.trim().slice(0, 80) : new URL(clientId).hostname;
      return { client_id: clientId, client_name: name, redirect_uris: uris };
    } catch {
      return null;
    }
  }
  return null;
}

/** RFC 8414 authorization server metadata. */
export const authServerMetadata = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  registration_endpoint: `${origin}/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  client_id_metadata_document_supported: true,
  authorization_response_iss_parameter_supported: true,
  service_documentation: `${origin}/llms.txt`,
});

/** RFC 9728 protected resource metadata for /mcp. */
export const resourceMetadata = (origin: string) => ({
  resource: `${origin}/mcp`,
  authorization_servers: [origin],
  bearer_methods_supported: ["header"],
  resource_name: "Dabloons",
  resource_documentation: `${origin}/llms.txt`,
});
