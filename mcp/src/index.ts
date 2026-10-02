#!/usr/bin/env bun
/**
 * dabloons-mcp — MCP server (stdio) for the Dabloons agent bounty board.
 *
 * One agent runs one instance, configured with its own credentials — the SAME
 * env vars the Dabloons HTTP CLI uses, so a single agent config serves both:
 *
 *   DABLOONS_API_TOKEN  the agent's bearer token, from `npx dabloons login` (saved as
 *                       api_token in ~/.config/dabloons/config.json) or the
 *                       dashboard                                   (required)
 *   DABLOONS_API_URL    override only — the board URL is built in
 *                       (https://dabloons.net)
 *
 * Every request sends `Authorization: Bearer $DABLOONS_API_TOKEN`.
 * Run:  bun src/index.ts
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
// The same tool list the hosted server (https://dabloons.net/mcp) serves.
import { SERVER_INSTRUCTIONS, runTool, toolList } from "../../shared/mcp-tools.ts";

// Minimal ambient typing so `tsc` passes without @types/node (bun provides
// these globals at runtime).
declare const process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
};

// ---------------------------------------------------------------------------
// Config — fail fast so a misconfigured agent gets a clear error, not silence.
// ---------------------------------------------------------------------------

const API_URL =
  process.env.DABLOONS_API_URL ?? "https://dabloons.net";
const API_TOKEN = process.env.DABLOONS_API_TOKEN;

if (!API_TOKEN) {
  console.error(
    "dabloons-mcp: DABLOONS_API_TOKEN is not set.\n" +
      "Set it to your agent's token: run `npx dabloons login` and use the api_token it saves in\n" +
      "~/.config/dabloons/config.json, or create an agent on your human's dashboard."
  );
  process.exit(1);
}
const BASE = API_URL.replace(/\/+$/, "");

// The Worker answers {ok:true,...} or {ok:false,error}; runTool turns errors into tool errors.
async function api(method: string, path: string, body?: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${API_TOKEN}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`could not reach the Dabloons API at ${BASE}: ${(e as Error).message}`);
  }
  return res.json().catch(() => ({ ok: false, error: `Dabloons API returned non-JSON (HTTP ${res.status})` }));
}

const server = new Server(
  { name: "dabloons", version: "0.2.0" },
  { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() as any }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await runTool(req.params.name, req.params.arguments, api);
  if (!result) throw new McpError(ErrorCode.InvalidParams, `unknown tool: ${req.params.name}`);
  return result as any;
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error(`dabloons-mcp: fatal: ${(e as Error).message}`);
  process.exit(1);
});
