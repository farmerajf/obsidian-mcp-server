import { randomUUID } from "node:crypto";
import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { registerTools } from "./tools/index.js";
import { wrapWithToolLogging } from "./utils/logger.js";

const config = loadConfig(process.env.CONFIG_PATH);
console.error(`[server] Config loaded (transport: ${config.transport})`);


function buildInstructions(config: Config): string {
  const vaultNames = Object.keys(config.paths);
  const vaultList = vaultNames.map((v) => `/${v}/`).join(", ");
  const vaultLine =
    vaultNames.length === 1
      ? `You have access to one vault. All file paths are prefixed with the vault name: ${vaultList}.`
      : `You have access to ${vaultNames.length} vaults. All file paths are prefixed with the vault name: ${vaultList}. Use / to list all vaults.`;

  return [
    vaultLine,
    "When referencing or citing Obsidian notes, always provide Obsidian URLs (obsidian://open?vault=...&file=...) so users can click to open them directly in Obsidian. Use the path_to_obsidian_url tool to convert file paths to Obsidian URLs.",
    "When referencing notes within the vault, prefer [[wikilinks]] over markdown links. Use resolve_wikilink to verify a link target exists before inserting it.",
    "Before editing a file, read it first to understand its structure. Use update_frontmatter for metadata changes instead of raw text edits — it preserves existing frontmatter structure and uses merge semantics.",
    "Always pass expectedEtag when updating files to avoid overwriting concurrent changes made in the Obsidian app. Prefer soft delete (default) over permanent delete.",
    "For large files, read_file truncates at 500 lines by default. When a file is truncated or get_file_metadata shows largeFile: true, use get_sections to see the heading structure first, then read_section to read specific sections. This saves context window budget. Prefer read_section over read_file with maxLines: 0.",
    "For image and audio files, read_file returns native content blocks so you can view images and hear audio directly. For PDF files, read_file returns the document as a readable resource. Video files are not supported for content reading — use get_file_metadata for their info.",
  ].join(" ");
}

// Factory function to create a new MCP server instance
function createMcpServer(config: Config): McpServer {
  const server = new McpServer(
    {
      name: "remote-obsidian-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: buildInstructions(config),
    }
  );
  wrapWithToolLogging(server);
  registerTools(server, config);
  return server;
}

// Start server based on transport mode
if (config.transport === "stdio") {
  startStdioServer(config);
} else {
  startHttpServer(config);
}

// Stdio transport for local use (Claude Desktop, etc.)
async function startStdioServer(config: Config): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();

  console.error("[server] Starting in stdio mode");
  console.error(`Configured paths:`);
  for (const [name, path] of Object.entries(config.paths)) {
    console.error(`  ${name}: ${path}`);
  }

  await server.connect(transport);
}

// Streamable HTTP transport for remote use (Claude Web, etc.)
function startHttpServer(config: Config): void {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const app = express();
  app.use((req, _res, next) => {
    console.log(`[http] --> ${req.method} ${req.path} from ${req.ip}`);
    next();
  });
  app.use(express.json());

  function validateApiKey(
    req: Request,
    res: Response,
    next: () => void
  ): void {
    const providedKey = req.params.apiKey;
    if (providedKey !== config.apiKey) {
      console.warn(`[http] Unauthorized request from ${req.ip}: invalid API key`);
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  // Streamable HTTP endpoint - handles POST, GET, DELETE
  app.post(
    "/:apiKey/mcp",
    validateApiKey,
    async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      console.log(`[http] POST /mcp session=${sessionId ?? "none"} (active sessions: ${transports.size})`);

      // Existing session
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Stale session ID - tell client to re-initialize
      if (sessionId) {
        console.warn(`[http] POST with stale session: ${sessionId}, returning 404`);
        res.status(404).json({ error: "Session not found" });
        return;
      }

      // New session - create transport and MCP server
      console.log("[http] Creating new session");
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          console.log(`[http] Session closed: ${transport.sessionId} (active: ${transports.size - 1})`);
          transports.delete(transport.sessionId);
        }
      };

      const mcpServer = createMcpServer(config);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
        console.log(`[http] Session initialized: ${transport.sessionId} (active: ${transports.size})`);
      }
    },
  );

  // GET for server-initiated SSE notifications stream
  app.get(
    "/:apiKey/mcp",
    validateApiKey,
    async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      console.log(`[http] GET /mcp session=${sessionId ?? "none"}`);
      if (!sessionId || !transports.has(sessionId)) {
        console.warn(`[http] GET with unknown/missing session: ${sessionId ?? "none"}`);
        res.status(400).json({ error: "Invalid or missing session ID" });
        return;
      }
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    },
  );

  // DELETE to terminate session
  app.delete(
    "/:apiKey/mcp",
    validateApiKey,
    async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      console.log(`[http] DELETE /mcp session=${sessionId ?? "none"}`);
      if (!sessionId || !transports.has(sessionId)) {
        console.warn(`[http] DELETE for unknown session: ${sessionId ?? "none"}`);
        res.status(400).json({ error: "Invalid or missing session ID" });
        return;
      }
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    },
  );

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  const basePath = config.basePath || "";
  const server = app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
    console.log(`[server] MCP endpoint: http://localhost:${config.port}/{apiKey}/mcp`);
    if (basePath) {
      console.log(`[server] External base path: ${basePath}`);
    }
    for (const [name, path] of Object.entries(config.paths)) {
      console.log(`[server] Vault "${name}": ${path}`);
    }
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[server] Port ${config.port} is already in use`);
    } else {
      console.error(`[server] Failed to start: ${err.message}`);
    }
    process.exit(1);
  });

  process.on("SIGINT", async () => {
    console.log(`[server] Shutting down (SIGINT), closing ${transports.size} session(s)...`);
    for (const transport of transports.values()) {
      await transport.close();
    }
    server.close();
    process.exit(0);
  });
}
