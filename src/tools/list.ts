import { readdirSync, statSync } from "fs";
import { join } from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import {
  resolvePath,
  toVirtualPath,
  isRootPath,
  getVaultEntries,
} from "../utils/paths.js";

export async function listDirectory(
  path: string,
  config: Config
): Promise<CallToolResult> {
  try {
    // Special case: root path lists all vaults as directories
    if (isRootPath(path)) {
      const vaultEntries = getVaultEntries(config);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(vaultEntries, null, 2),
          },
        ],
      };
    }

    const resolved = resolvePath(path, config);
    const entries = readdirSync(resolved.fullPath, { withFileTypes: true });

    const items = entries.map((entry) => {
      const fullPath = join(resolved.fullPath, entry.name);
      const virtualPath = toVirtualPath(
        fullPath,
        resolved.basePath,
        resolved.vaultName
      );
      const stats = statSync(fullPath);

      return {
        name: entry.name,
        path: virtualPath,
        type: entry.isDirectory() ? "directory" : "file",
        size: entry.isFile() ? stats.size : undefined,
        modified: stats.mtime.toISOString(),
      };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(items, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}
