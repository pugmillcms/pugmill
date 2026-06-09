export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-auth";
import { getConfig } from "@/lib/config";
import { loadPlugins } from "@/lib/plugin-loader";
import type { ApiScope } from "@/lib/api-auth";
import {
  rpcSuccess,
  rpcError,
  isNotification,
  extractId,
  RPC_PARSE_ERROR,
  RPC_INVALID_PARAMS,
  RPC_METHOD_NOT_FOUND,
  RPC_INTERNAL_ERROR,
  type JsonRpcRequest,
} from "../../../../plugins/mcp-server/protocol";
import { ALL_TOOLS, TOOL_MAP } from "../../../../plugins/mcp-server/tools";

// ─── MCP server info ──────────────────────────────────────────────────────────

const SERVER_INFO = {
  name:    "pugmill-cms",
  version: "0.1.0",
} as const;

const PROTOCOL_VERSION = "2025-03-26";

// ─── GET handler — public health / discovery ─────────────────────────────────
// Returns basic server metadata. No auth required — it's public info and
// allows MCP admin pages and external tools to verify the endpoint is live
// before asking the user to generate a key.

export async function GET(_req: NextRequest) {
  await loadPlugins();
  const config = await getConfig();
  if (!config.modules.activePlugins.includes("mcp-server")) {
    return NextResponse.json({ error: "MCP server plugin is not active" }, { status: 404 });
  }
  return NextResponse.json({
    status:   "ok",
    name:     SERVER_INFO.name,
    version:  SERVER_INFO.version,
    protocol: PROTOCOL_VERSION,
    tools:    ALL_TOOLS.length,
  });
}

// ─── Request dispatcher ───────────────────────────────────────────────────────

async function dispatch(req: JsonRpcRequest, scope: ApiScope): Promise<Response | null> {
  const id = req.id ?? null;

  // Notifications have no id and expect no response
  if (isNotification(req)) {
    // Handle notifications/initialized — acknowledge silently
    return new Response(null, { status: 204 });
  }

  switch (req.method) {

    case "initialize": {
      return NextResponse.json(
        rpcSuccess(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        }),
        { status: 200 }
      );
    }

    case "tools/list": {
      return NextResponse.json(
        rpcSuccess(id, {
          tools: ALL_TOOLS.map((t) => t.definition),
        }),
        { status: 200 }
      );
    }

    case "tools/call": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      const toolName = typeof params.name === "string" ? params.name : "";
      const toolInput = params.arguments ?? {};

      const tool = TOOL_MAP.get(toolName);
      if (!tool) {
        return NextResponse.json(
          rpcError(id, RPC_METHOD_NOT_FOUND, `Unknown tool: ${toolName}`),
          { status: 200 } // JSON-RPC errors still use HTTP 200
        );
      }

      // Scope gate: content-mutating tools require a "readwrite" key.
      if (tool.write && scope !== "readwrite") {
        return NextResponse.json(
          rpcError(
            id,
            RPC_INVALID_PARAMS,
            `Tool "${toolName}" requires a read-write API key. This key is read-only.`,
          ),
          { status: 200 }
        );
      }

      try {
        const result = await tool.handler(toolInput);
        return NextResponse.json(rpcSuccess(id, result), { status: 200 });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return NextResponse.json(
          rpcError(id, RPC_INTERNAL_ERROR, message),
          { status: 200 }
        );
      }
    }

    default: {
      return NextResponse.json(
        rpcError(id, RPC_METHOD_NOT_FOUND, `Method not found: ${req.method}`),
        { status: 200 }
      );
    }
  }
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Ensure plugins are initialized (idempotent)
  await loadPlugins();

  // Check plugin is active
  const config = await getConfig();
  if (!config.modules.activePlugins.includes("mcp-server")) {
    return NextResponse.json(
      { error: "MCP server plugin is not active" },
      { status: 404 }
    );
  }

  // Require authentication — MCP always needs a key
  const auth = await authorizeApiRequest(req);
  if (auth.ok === false) return auth.response;
  if (!auth.authenticated) {
    return new Response("Unauthorized: API key required for MCP access", { status: 401 });
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      rpcError(null, RPC_PARSE_ERROR, "Parse error: request body is not valid JSON"),
      { status: 200 }
    );
  }

  // Validate basic JSON-RPC 2.0 shape
  if (
    !body ||
    typeof body !== "object" ||
    (body as Record<string, unknown>).jsonrpc !== "2.0" ||
    typeof (body as Record<string, unknown>).method !== "string"
  ) {
    const id = extractId(body);
    return NextResponse.json(
      rpcError(id, RPC_PARSE_ERROR, "Invalid JSON-RPC 2.0 request"),
      { status: 200 }
    );
  }

  const rpcReq = body as JsonRpcRequest;
  const response = await dispatch(rpcReq, auth.scope);

  // Notifications return null to signal 204 already sent, but dispatch returns the Response directly
  return response ?? new Response(null, { status: 204 });
}
