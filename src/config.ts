import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export type TransportMode = "stdio" | "sse";

export interface Config {
  transport: TransportMode;
  port: number;
  apiKey: string;
  paths: Record<string, string>;
}

const DEFAULT_CONFIG_PATH = "./config.json";

export function loadConfig(configPath?: string): Config {
  const resolvedPath = resolve(configPath || DEFAULT_CONFIG_PATH);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const raw = readFileSync(resolvedPath, "utf-8");
  const config = JSON.parse(raw) as Partial<Config>;

  // Transport mode - can be overridden by env var or CLI arg
  const transportEnv = process.env.MCP_TRANSPORT as TransportMode | undefined;
  const transportArg = process.argv.includes("--stdio")
    ? "stdio"
    : process.argv.includes("--sse")
      ? "sse"
      : undefined;

  config.transport = transportArg || transportEnv || config.transport || "sse";

  if (config.transport !== "stdio" && config.transport !== "sse") {
    throw new Error(`Invalid transport mode: ${config.transport}. Must be "stdio" or "sse"`);
  }

  // Port is only required for SSE mode
  if (config.transport === "sse") {
    if (typeof config.port !== "number" || config.port <= 0) {
      throw new Error("Config must have a valid port number for SSE mode");
    }

    if (typeof config.apiKey !== "string" || config.apiKey.length === 0) {
      throw new Error("Config must have a non-empty apiKey for SSE mode");
    }
  } else {
    // Set defaults for stdio mode
    config.port = config.port || 0;
    config.apiKey = config.apiKey || "";
  }

  if (
    typeof config.paths !== "object" ||
    Object.keys(config.paths).length === 0
  ) {
    throw new Error("Config must have at least one path configured");
  }

  // Validate each path exists
  for (const [name, fsPath] of Object.entries(config.paths)) {
    const resolved = resolve(fsPath);
    if (!existsSync(resolved)) {
      throw new Error(`Configured path "${name}" does not exist: ${resolved}`);
    }
    // Store resolved absolute path
    config.paths[name] = resolved;
  }

  return config as Config;
}
