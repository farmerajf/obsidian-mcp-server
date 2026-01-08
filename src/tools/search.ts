import { readFileSync } from "fs";
import { basename } from "path";
import { glob } from "glob";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath, toVirtualPath, getAllVaults } from "../utils/paths.js";

interface SearchResult {
  path: string;
  matches?: { line: number; content: string }[];
}

export async function searchFiles(
  query: string,
  path: string | undefined,
  type: "content" | "filename",
  config: Config
): Promise<CallToolResult> {
  try {
    const results: SearchResult[] = [];
    const regex = new RegExp(query, "gi");

    // Determine which vaults to search
    let searchVaults: Array<{ name: string; basePath: string }>;

    if (path) {
      const resolved = resolvePath(path, config);
      searchVaults = [
        { name: resolved.vaultName, basePath: resolved.fullPath },
      ];
    } else {
      // Search all configured vaults
      searchVaults = getAllVaults(config);
    }

    for (const vault of searchVaults) {
      // Find all files in the vault
      const files = await glob("**/*", {
        cwd: vault.basePath,
        nodir: true,
        absolute: true,
      });

      for (const filePath of files) {
        const fileName = basename(filePath);
        const virtualPath = toVirtualPath(filePath, vault.basePath, vault.name);

        if (type === "filename") {
          // Match against filename
          if (regex.test(fileName)) {
            results.push({ path: virtualPath });
          }
        } else {
          // Match against file content
          try {
            const content = readFileSync(filePath, "utf-8");
            const lines = content.split("\n");
            const matches: { line: number; content: string }[] = [];

            lines.forEach((line, index) => {
              if (regex.test(line)) {
                matches.push({
                  line: index + 1,
                  content: line.trim().slice(0, 200),
                });
              }
              regex.lastIndex = 0;
            });

            if (matches.length > 0) {
              results.push({
                path: virtualPath,
                matches: matches.slice(0, 10),
              });
            }
          } catch {
            // Skip files that can't be read
          }
        }

        if (results.length >= 100) break;
      }

      if (results.length >= 100) break;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              query,
              type,
              resultCount: results.length,
              results,
            },
            null,
            2
          ),
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
