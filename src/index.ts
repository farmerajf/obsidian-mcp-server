import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

  // --- Token store (persisted to disk so restarts don't force re-auth) ---
  const TOKENS_FILE = "./tokens.json";
  const validTokens = new Set<string>(
    existsSync(TOKENS_FILE)
      ? (JSON.parse(readFileSync(TOKENS_FILE, "utf8")) as string[])
      : []
  );
  function saveTokens() {
    writeFileSync(TOKENS_FILE, JSON.stringify([...validTokens]));
  }

  // Short-lived auth codes: code → { codeChallenge, expires }
  const pendingCodes = new Map<string, { codeChallenge: string; expires: number }>();

  const app = express();
  app.use((req, _res, next) => {
    console.log(`[http] --> ${req.method} ${req.path} from ${req.ip}`);
    next();
  });
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  function externalBase(req: Request): string {
    const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] ?? req.protocol;
    return `${proto}://${req.get("host")}`;
  }

  // --- OAuth discovery ---

  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    const base = externalBase(req);
    res.json({ resource: base, authorization_servers: [base] });
  });

  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    const base = externalBase(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  // Dynamic client registration (RFC 7591) — accepts any client, issues a client_id
  app.post("/oauth/register", (req, res) => {
    const clientId = randomBytes(16).toString("hex");
    console.log(`[oauth] Client registered: ${clientId}`);
    res.status(201).json({
      ...req.body,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    });
  });

  // --- Authorization endpoint: show password form, then redirect with code ---

  app.get("/oauth/authorize", (req, res) => {
    const { redirect_uri, state, code_challenge, code_challenge_method, client_id } =
      req.query as Record<string, string>;
    if (!redirect_uri || !code_challenge) {
      res.status(400).send("Missing required parameters"); return;
    }
    // Render password form; OAuth params carried as hidden fields
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Obsidian MCP — Authorize</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #f5f5f5; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; padding: 2rem;
            box-shadow: 0 4px 24px rgba(0,0,0,.08); width: 100%; max-width: 360px; }
    h1 { font-size: 1.2rem; margin-bottom: .25rem; }
    p  { font-size: .875rem; color: #666; margin-bottom: 1.5rem; }
    label { display: block; font-size: .875rem; font-weight: 500; margin-bottom: .4rem; }
    input[type=password] { width: 100%; padding: .6rem .8rem; border: 1px solid #ddd;
                           border-radius: 8px; font-size: 1rem; outline: none; }
    input[type=password]:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.15); }
    .error { color: #dc2626; font-size: .875rem; margin-bottom: 1rem; }
    button { width: 100%; margin-top: 1rem; padding: .65rem; background: #6366f1;
             color: white; border: none; border-radius: 8px; font-size: 1rem;
             cursor: pointer; font-weight: 500; }
    button:hover { background: #4f46e5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Obsidian MCP</h1>
    <p>Enter your password to authorize access.</p>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirect_uri)}">
      <input type="hidden" name="state" value="${encodeURIComponent(state ?? "")}">
      <input type="hidden" name="code_challenge" value="${encodeURIComponent(code_challenge)}">
      <input type="hidden" name="code_challenge_method" value="${encodeURIComponent(code_challenge_method ?? "S256")}">
      <input type="hidden" name="client_id" value="${encodeURIComponent(client_id ?? "")}">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus autocomplete="current-password">
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`);
  });

  app.post("/oauth/authorize", (req, res) => {
    const { password, redirect_uri, state, code_challenge, code_challenge_method } =
      req.body as Record<string, string>;

    const redirectUri = decodeURIComponent(redirect_uri ?? "");
    if (!redirectUri) { res.status(400).send("Missing redirect_uri"); return; }

    if (password !== config.password) {
      console.warn("[oauth] Failed authorization attempt");
      res.setHeader("Content-Type", "text/html");
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Obsidian MCP — Authorize</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #f5f5f5; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; padding: 2rem;
            box-shadow: 0 4px 24px rgba(0,0,0,.08); width: 100%; max-width: 360px; }
    h1 { font-size: 1.2rem; margin-bottom: .25rem; }
    p  { font-size: .875rem; color: #666; margin-bottom: 1.5rem; }
    label { display: block; font-size: .875rem; font-weight: 500; margin-bottom: .4rem; }
    input[type=password] { width: 100%; padding: .6rem .8rem; border: 1px solid #ddd;
                           border-radius: 8px; font-size: 1rem; outline: none; }
    input[type=password]:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.15); }
    .error { color: #dc2626; font-size: .875rem; margin-bottom: 1rem; }
    button { width: 100%; margin-top: 1rem; padding: .65rem; background: #6366f1;
             color: white; border: none; border-radius: 8px; font-size: 1rem;
             cursor: pointer; font-weight: 500; }
    button:hover { background: #4f46e5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Obsidian MCP</h1>
    <p>Enter your password to authorize access.</p>
    <p class="error">Incorrect password. Please try again.</p>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="redirect_uri" value="${redirect_uri}">
      <input type="hidden" name="state" value="${state ?? ""}">
      <input type="hidden" name="code_challenge" value="${code_challenge}">
      <input type="hidden" name="code_challenge_method" value="${code_challenge_method ?? "S256"}">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus autocomplete="current-password">
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`);
      return;
    }

    // Generate short-lived auth code, store with PKCE challenge
    const code = randomBytes(32).toString("hex");
    pendingCodes.set(code, {
      codeChallenge: decodeURIComponent(code_challenge),
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    const dest = new URL(redirectUri);
    dest.searchParams.set("code", code);
    const decodedState = decodeURIComponent(state ?? "");
    if (decodedState) dest.searchParams.set("state", decodedState);

    console.log("[oauth] Password accepted, redirecting with code");
    res.redirect(dest.toString());
  });

  // --- Token endpoint: verify code + PKCE, issue access token ---

  app.post("/oauth/token", (req, res) => {
    const { code, grant_type, code_verifier } = req.body as Record<string, string>;

    if (grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" }); return;
    }

    const pending = pendingCodes.get(code);
    if (!pending || Date.now() > pending.expires) {
      pendingCodes.delete(code);
      res.status(400).json({ error: "invalid_grant" }); return;
    }

    // Verify PKCE: SHA256(code_verifier) must equal stored code_challenge
    const digest = createHash("sha256").update(code_verifier).digest("base64url");
    if (digest !== pending.codeChallenge) {
      console.warn("[oauth] PKCE verification failed");
      res.status(400).json({ error: "invalid_grant" }); return;
    }

    pendingCodes.delete(code);

    const token = randomBytes(32).toString("hex");
    validTokens.add(token);
    saveTokens();

    console.log("[oauth] Token issued");
    res.json({ access_token: token, token_type: "bearer" });
  });

  // --- MCP auth middleware ---

  function validateToken(req: Request, res: Response, next: () => void): void {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    if (!token || !validTokens.has(token)) {
      console.warn(`[http] Unauthorized request from ${req.ip}`);
      const base = externalBase(req);
      res
        .status(401)
        .set("WWW-Authenticate", `Bearer realm="${base}", resource_metadata="${base}/.well-known/oauth-protected-resource"`)
        .json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  app.post("/mcp", validateToken, async (req: Request, res: Response) => {
    return mcpPost(req, res);
  });
  app.get("/mcp", validateToken, async (req: Request, res: Response) => {
    return mcpGet(req, res);
  });
  app.delete("/mcp", validateToken, async (req: Request, res: Response) => {
    return mcpDelete(req, res);
  });

  async function mcpPost(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    console.log(`[http] POST /mcp session=${sessionId ?? "none"} (active sessions: ${transports.size})`);

    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req, res, req.body);
      return;
    }
    if (sessionId) {
      console.warn(`[http] POST with stale session: ${sessionId}, returning 404`);
      res.status(404).json({ error: "Session not found" });
      return;
    }

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
  }

  async function mcpGet(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    console.log(`[http] GET /mcp session=${sessionId ?? "none"}`);
    if (!sessionId || !transports.has(sessionId)) {
      console.warn(`[http] GET with unknown/missing session: ${sessionId ?? "none"}`);
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    await transports.get(sessionId)!.handleRequest(req, res);
  }

  async function mcpDelete(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    console.log(`[http] DELETE /mcp session=${sessionId ?? "none"}`);
    if (!sessionId || !transports.has(sessionId)) {
      console.warn(`[http] DELETE for unknown session: ${sessionId ?? "none"}`);
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    await transports.get(sessionId)!.handleRequest(req, res);
  }

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  const server = app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
    console.log(`[server] MCP endpoint: http://localhost:${config.port}/mcp`);
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
