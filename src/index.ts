import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { registerTools } from "./tools/index.js";

const config = loadConfig(process.env.CONFIG_PATH);

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

  console.error("Starting Obsidian MCP Server in stdio mode...");
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

  // API key validation middleware - key is in the URL path
  function validateApiKey(
    req: Request,
    res: Response,
    next: () => void
  ): void {
    const providedKey = req.params.apiKey;
    if (providedKey !== config.apiKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  // SSE endpoint - establishes the SSE connection
  // URL format: /:apiKey/sse
  app.get("/:apiKey/sse", validateApiKey, async (req: Request, res: Response) => {
    console.log("New SSE connection");

    // Create SSE transport - messages endpoint is relative to the apiKey path
    const transport = new SSEServerTransport(`/${req.params.apiKey}/messages`, res);
    transports.set(transport.sessionId, transport);

    // Clean up on close
    transport.onclose = () => {
      console.log(`SSE connection closed: ${transport.sessionId}`);
      transports.delete(transport.sessionId);
    };

    // Create a new MCP server instance for this connection
    const mcpServer = createMcpServer(config);

    // Connect to MCP server - this also starts the transport automatically
    await mcpServer.connect(transport);
  });

  // Messages endpoint - receives JSON-RPC messages from the client
  // URL format: /:apiKey/messages
  app.post(
    "/:apiKey/messages",
    validateApiKey,
    async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        res.status(400).json({ error: "Missing sessionId query parameter" });
        return;
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      await transport.handlePostMessage(req, res, req.body);
    }
  );

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // Start server
  const server = app.listen(config.port, () => {
    console.log(`Remote Obsidian MCP Server running on port ${config.port}`);
    console.log(`SSE endpoint: http://localhost:${config.port}/{apiKey}/sse`);
    console.log(`Configured paths:`);
    for (const [name, path] of Object.entries(config.paths)) {
      console.log(`  ${name}: ${path}`);
    }
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    for (const transport of transports.values()) {
      await transport.close();
    }
    server.close();
    process.exit(0);
  });
}
