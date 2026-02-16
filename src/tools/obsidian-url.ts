import { extname } from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";

export async function obsidianUrlToPath(
  url: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "obsidian:") {
      throw new Error(`Invalid URL scheme: expected "obsidian:", got "${parsed.protocol}"`);
    }

    const action = parsed.hostname;
    if (action !== "open") {
      throw new Error(`Unsupported action: "${action}". Only "open" is supported.`);
    }

    const vault = parsed.searchParams.get("vault");
    if (!vault) {
      throw new Error("Missing required 'vault' parameter in URL");
    }

    const file = parsed.searchParams.get("file");
    if (!file) {
      throw new Error("Missing required 'file' parameter in URL");
    }

    // Find config vault by case-insensitive match
    const vaultKey = Object.keys(config.paths).find(
      (k) => k.toLowerCase() === vault.toLowerCase()
    );
    if (!vaultKey) {
      const available = Object.keys(config.paths).join(", ");
      throw new Error(
        `Unknown vault: "${vault}". Available vaults: ${available}`
      );
    }

    // Append .md if no extension
    const filePath = extname(file) ? file : file + ".md";
    const path = "/" + vaultKey + "/" + filePath;

    return {
      content: [{ type: "text", text: JSON.stringify({ path, obsidianUrl: url }, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}

export async function pathToObsidianUrl(
  path: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    // Use config vault key as the Obsidian vault name
    const vaultName = resolved.vaultName;
    let filePath = resolved.relativePath;

    if (!filePath) {
      throw new Error("Cannot create Obsidian URL for a vault root path");
    }

    // Strip .md extension (Obsidian convention)
    if (filePath.endsWith(".md")) {
      filePath = filePath.slice(0, -3);
    }

    // Build URL manually to use %20 instead of + for spaces
    const encodedVault = encodeURIComponent(vaultName);
    const encodedFile = encodeURIComponent(filePath);
    const obsidianUrl = `obsidian://open?vault=${encodedVault}&file=${encodedFile}`;

    return {
      content: [{ type: "text", text: JSON.stringify({ obsidianUrl, path }, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}
