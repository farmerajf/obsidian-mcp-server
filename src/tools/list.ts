import { readdirSync, statSync } from "fs";
import { join } from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath, toVirtualPath, getAllBasePaths } from "../utils/paths.js";

export async function listDirectory(
  path: string,
  config: Config
): Promise<CallToolResult> {
  try {
    // Special case: root path lists all accessible directories
    if (path === "/" || path === "") {
      const items: { name: string; path: string; type: string }[] = [];
      const seen = new Set<string>();

      for (const basePath of getAllBasePaths(config)) {
        const entries = readdirSync(basePath, { withFileTypes: true });
        for (const entry of entries) {
          if (!seen.has(entry.name)) {
            seen.add(entry.name);
            const fullPath = join(basePath, entry.name);
            const stats = statSync(fullPath);
            items.push({
              name: entry.name,
              path: "/" + entry.name,
              type: entry.isDirectory() ? "directory" : "file",
            });
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(items, null, 2),
          },
        ],
      };
    }

    const resolved = resolvePath(path, config);
    const entries = readdirSync(resolved.fullPath, { withFileTypes: true });

    const items = entries.map((entry) => {
      const fullPath = join(resolved.fullPath, entry.name);
      const virtualPath = toVirtualPath(fullPath, resolved.basePath);
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
