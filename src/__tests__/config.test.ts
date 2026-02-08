import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";

// Mock fs module
vi.mock("fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

// Need to import after mocking
const { loadConfig } = await import("../config.js");

describe("loadConfig", () => {
  beforeEach(() => {
    vol.reset();
    // Reset process.argv
    process.argv = ["node", "index.js"];
    // Reset env vars
    delete process.env.MCP_TRANSPORT;
  });

  afterEach(() => {
    vol.reset();
  });

  it("loads valid SSE config", () => {
    vol.fromJSON({
      "/config.json": JSON.stringify({
        port: 3000,
        apiKey: "test-key",
        paths: { vault: "/" },
      }),
      "/": null, // Directory
    });

    const config = loadConfig("/config.json");

    expect(config.transport).toBe("sse");
    expect(config.port).toBe(3000);
    expect(config.apiKey).toBe("test-key");
  });

  it("loads config with explicit transport mode", () => {
    vol.fromJSON({
      "/config.json": JSON.stringify({
        transport: "stdio",
        paths: { vault: "/" },
      }),
      "/": null,
    });

    const config = loadConfig("/config.json");

    expect(config.transport).toBe("stdio");
  });

  it("allows stdio mode without port and apiKey", () => {
    vol.fromJSON({
      "/config.json": JSON.stringify({
        transport: "stdio",
        paths: { vault: "/" },
      }),
      "/": null,
    });

    const config = loadConfig("/config.json");

    expect(config.transport).toBe("stdio");
    expect(config.port).toBe(0);
    expect(config.apiKey).toBe("");
  });

  it("overrides transport with --stdio CLI arg", () => {
    process.argv = ["node", "index.js", "--stdio"];

    vol.fromJSON({
      "/config.json": JSON.stringify({
        transport: "sse",
        port: 3000,
        apiKey: "test-key",
        paths: { vault: "/" },
      }),
      "/": null,
    });

    const config = loadConfig("/config.json");

    expect(config.transport).toBe("stdio");
  });

  it("overrides transport with --sse CLI arg", () => {
    process.argv = ["node", "index.js", "--sse"];

    vol.fromJSON({
      "/config.json": JSON.stringify({
        transport: "stdio",
        port: 3000,
        apiKey: "test-key",
        paths: { vault: "/" },
      }),
      "/": null,
    });

    const config = loadConfig("/config.json");

    expect(config.transport).toBe("sse");
  });

  it("overrides transport with MCP_TRANSPORT env var", () => {
    process.env.MCP_TRANSPORT = "stdio";

    vol.fromJSON({
      "/config.json": JSON.stringify({
        transport: "sse",
        port: 3000,
        apiKey: "test-key",
        paths: { vault: "/" },
      }),
      "/": null,
    });

    const config = loadConfig("/config.json");

    expect(config.transport).toBe("stdio");
  });

  it("CLI arg takes precedence over env var", () => {
    process.argv = ["node", "index.js", "--sse"];
    process.env.MCP_TRANSPORT = "stdio";

    vol.fromJSON({
      "/config.json": JSON.stringify({
        port: 3000,
        apiKey: "test-key",
        paths: { vault: "/" },
      }),
      "/": null,
    });

    const config = loadConfig("/config.json");

    expect(config.transport).toBe("sse");
  });

  it("throws on missing config file", () => {
    expect(() => loadConfig("/nonexistent.json")).toThrow("Config file not found");
  });

  it("throws on invalid transport mode", () => {
    vol.fromJSON({
      "/config.json": JSON.stringify({
        transport: "invalid",
        paths: { vault: "/" },
      }),
      "/": null,
    });

    expect(() => loadConfig("/config.json")).toThrow("Invalid transport mode");
  });

  it("throws on SSE mode without port", () => {
    vol.fromJSON({
      "/config.json": JSON.stringify({
        transport: "sse",
        apiKey: "test-key",
        paths: { vault: "/" },
      }),
      "/": null,
    });

    expect(() => loadConfig("/config.json")).toThrow("valid port number");
  });

  it("throws on SSE mode without apiKey", () => {
    vol.fromJSON({
      "/config.json": JSON.stringify({
        transport: "sse",
        port: 3000,
        paths: { vault: "/" },
      }),
      "/": null,
    });

    expect(() => loadConfig("/config.json")).toThrow("non-empty apiKey");
  });

  it("throws on missing paths", () => {
    vol.fromJSON({
      "/config.json": JSON.stringify({
        transport: "stdio",
      }),
    });

    expect(() => loadConfig("/config.json")).toThrow("at least one path configured");
  });

  it("normalizes basePath - adds leading slash", () => {
    vol.fromJSON({
      "/config.json": JSON.stringify({
        port: 3000,
        apiKey: "test-key",
        basePath: "obsidian-mcp",
        paths: { vault: "/" },
      }),
      "/": null,
    });

    const config = loadConfig("/config.json");

    expect(config.basePath).toBe("/obsidian-mcp");
  });

  it("normalizes basePath - removes trailing slash", () => {
    vol.fromJSON({
      "/config.json": JSON.stringify({
        port: 3000,
        apiKey: "test-key",
        basePath: "/obsidian-mcp/",
        paths: { vault: "/" },
      }),
      "/": null,
    });

    const config = loadConfig("/config.json");

    expect(config.basePath).toBe("/obsidian-mcp");
  });

  it("normalizes basePath - handles both issues", () => {
    vol.fromJSON({
      "/config.json": JSON.stringify({
        port: 3000,
        apiKey: "test-key",
        basePath: "api/mcp/",
        paths: { vault: "/" },
      }),
      "/": null,
    });

    const config = loadConfig("/config.json");

    expect(config.basePath).toBe("/api/mcp");
  });

  it("allows config without basePath", () => {
    vol.fromJSON({
      "/config.json": JSON.stringify({
        port: 3000,
        apiKey: "test-key",
        paths: { vault: "/" },
      }),
      "/": null,
    });

    const config = loadConfig("/config.json");

    expect(config.basePath).toBeUndefined();
  });
});
