import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { resolveUrlToPath } from "../utils/resolve-url.js";

export async function obsidianUrlToPath(
  url: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const path = resolveUrlToPath(url, config);

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
