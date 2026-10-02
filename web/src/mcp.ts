/**
 * The hosted MCP server at /mcp: Streamable HTTP, stateless, JSON responses,
 * tools only. It speaks MCP's JSON-RPC directly, so the Worker needs no SDK.
 * Tools come from shared/mcp-tools.ts, the same list the stdio server serves;
 * each one runs as an in-process request to the board API with the caller's
 * token.
 *
 * Dual-era (spec 2026-07-28 "Versioning and Compatibility"): modern clients
 * send their version in each request's _meta and may call server/discover;
 * legacy clients (2025-11-25 and earlier) start with initialize. Neither needs
 * a session here, since nothing is kept between requests.
 */
import { SERVER_INSTRUCTIONS, runTool, toolList } from "../../shared/mcp-tools.ts";

const MODERN = ["2026-07-28"];
const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SUPPORTED = [...MODERN, ...LEGACY];
const VERSION_KEY = "io.modelcontextprotocol/protocolVersion";

type FetchApi = (method: string, path: string, body?: unknown) => Promise<any>;
export type Reply = { body: unknown; status?: number } | null;

const ok = (id: unknown, result: object, origin: string): Reply => ({
  body: { jsonrpc: "2.0", id, result: { resultType: "complete", ...result, _meta: { "io.modelcontextprotocol/serverInfo": serverInfo(origin) } } },
});
const fail = (id: unknown, code: number, message: string, data?: unknown, status?: number): Reply => ({
  body: { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } },
  status,
});

const serverInfo = (origin: string) => ({
  name: "dabloons",
  title: "Dabloons",
  version: "1.0.0",
  websiteUrl: origin,
  icons: [{ src: `${origin}/dashboard/icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }],
});
const CAPABILITIES = { tools: { listChanged: false } };
// tools/list never changes between deploys; let clients and caches keep it an hour.
const CACHE = { ttlMs: 3_600_000, cacheScope: "public" };

/** One JSON-RPC message -> its reply, or null for a notification. `headerVersion` is the MCP-Protocol-Version header. */
export async function handleRpc(msg: any, origin: string, fetchApi: FetchApi, headerVersion?: string): Promise<Reply> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg?.id, -32600, "invalid request", undefined, 400);
  if (msg.id === undefined) return null; // notifications/initialized and friends
  const { id, method, params } = msg;
  const asked = params?._meta?.[VERSION_KEY] ?? headerVersion;
  if (method !== "initialize" && asked && !SUPPORTED.includes(asked))
    return fail(id, -32022, "Unsupported protocol version", { supported: SUPPORTED, requested: asked }, 400);
  switch (method) {
    case "server/discover":
      return ok(id, { supportedVersions: SUPPORTED, capabilities: CAPABILITIES, instructions: SERVER_INSTRUCTIONS, ...CACHE }, origin);
    case "initialize": {
      const v = params?.protocolVersion;
      return ok(
        id,
        {
          protocolVersion: LEGACY.includes(v) ? v : LEGACY[0],
          capabilities: CAPABILITIES,
          serverInfo: serverInfo(origin),
          instructions: SERVER_INSTRUCTIONS,
        },
        origin
      );
    }
    case "ping": // legacy only; removed in 2026-07-28
      return ok(id, {}, origin);
    case "tools/list":
      return ok(id, { tools: toolList(), ...CACHE }, origin);
    case "tools/call": {
      if (typeof params?.name !== "string") return fail(id, -32602, "params.name is required");
      const result = await runTool(params.name, params.arguments, fetchApi);
      if (!result) return fail(id, -32602, `unknown tool: ${params.name}. Call tools/list for the tool names.`);
      return ok(id, result, origin);
    }
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}
