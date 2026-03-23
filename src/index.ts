import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { registerTools } from "./tools/index.js";

const config = loadConfig(process.env.CONFIG_PATH);
console.log(`[server] Config loaded (transport: ${config.transport})`);


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
  registerTools(server, config);
  return server;
}

// Start server based on transport mode
if (config.transport === "stdio") {
  startStdioServer(config);
} else {
  startSseServer(config);
}

// Stdio transport for local use (Claude Desktop, etc.)
async function startStdioServer(config: Config): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();

  console.log("[server] Starting in stdio mode");
  console.error(`Configured paths:`);
  for (const [name, path] of Object.entries(config.paths)) {
    console.error(`  ${name}: ${path}`);
  }

  await server.connect(transport);
}

// SSE transport for remote use (Claude Web, etc.)
function startSseServer(config: Config): void {
  // Store active transports by session ID
  const transports = new Map<string, SSEServerTransport>();

  // Create Express app
  const app = express();
  app.use(express.json());

  // basePath is used for client callback URLs when behind a reverse proxy
  // that strips the path prefix (e.g., Tailscale Funnel with --set-path)
  // The proxy strips the prefix on incoming requests, but clients need
  // the full path to POST messages back correctly.
  const basePath = config.basePath || "";

  // API key validation middleware - key is in the URL path
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

  // Request logger
  app.use((req, _res, next) => {
    console.log(`[http] --> ${req.method} ${req.path} from ${req.ip}`);
    next();
  });

  // SSE endpoint - establishes the SSE connection
  app.get("/:apiKey/sse", validateApiKey, async (req: Request, res: Response) => {
    // Create SSE transport - messages endpoint includes basePath for reverse proxy support
    // The client needs the full external path to POST messages back
    const messagesPath = basePath
      ? `${basePath}/${req.params.apiKey}/messages`
      : `/${req.params.apiKey}/messages`;
    const transport = new SSEServerTransport(messagesPath, res);
    transports.set(transport.sessionId, transport);
    console.log(`[http] SSE session created: ${transport.sessionId} (active: ${transports.size})`);

    // Clean up on close
    transport.onclose = () => {
      transports.delete(transport.sessionId);
      console.log(`[http] SSE session closed: ${transport.sessionId} (active: ${transports.size})`);
    };

    // Create a new MCP server instance for this connection
    const mcpServer = createMcpServer(config);

    // Connect to MCP server - this also starts the transport automatically
    await mcpServer.connect(transport);
  });

  // Messages endpoint - receives JSON-RPC messages from the client
  app.post(
    "/:apiKey/messages",
    validateApiKey,
    async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        console.warn("[http] POST /messages missing sessionId");
        res.status(400).json({ error: "Missing sessionId query parameter" });
        return;
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        console.warn(`[http] POST /messages unknown session: ${sessionId}`);
        res.status(404).json({ error: "Session not found" });
        return;
      }

      await transport.handlePostMessage(req, res, req.body);
    }
  );

  // Health check endpoint - always at root
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // Start server
  const server = app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
    console.log(`[server] SSE endpoint: http://localhost:${config.port}/{apiKey}/sse`);
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

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log(`[server] Shutting down (SIGINT), closing ${transports.size} session(s)...`);
    for (const transport of transports.values()) {
      await transport.close();
    }
    server.close();
    process.exit(0);
  });
}
