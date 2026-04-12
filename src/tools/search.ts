import { readFileSync, statSync, createReadStream } from "fs";
import { createInterface } from "readline";
import { basename, extname } from "path";
import { glob } from "glob";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath, toVirtualPath, getAllVaults } from "../utils/paths.js";
import { VAULT_IGNORE_PATTERNS, TEXT_EXTENSIONS } from "../utils/constants.js";

/** Files larger than this use streaming reads instead of loading into memory */
const STREAMING_SEARCH_THRESHOLD = 512 * 1024; // 512 KB

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
    let searchVaults: Array<{ name: string; basePath: string; searchPath: string }>;

    if (path) {
      const resolved = resolvePath(path, config);
      searchVaults = [
        { name: resolved.vaultName, basePath: resolved.basePath, searchPath: resolved.fullPath },
      ];
    } else {
      // Search all configured vaults
      searchVaults = getAllVaults(config).map(v => ({ ...v, searchPath: v.basePath }));
    }

    for (const vault of searchVaults) {
      // Find all files in the vault, excluding system directories
      const files = await glob("**/*", {
        cwd: vault.searchPath,
        nodir: true,
        absolute: true,
        ignore: VAULT_IGNORE_PATTERNS,
      });

      for (const filePath of files) {
        const fileName = basename(filePath);
        const virtualPath = toVirtualPath(filePath, vault.basePath, vault.name);

        if (type === "filename") {
          // Match against filename
          if (regex.test(fileName)) {
            results.push({ path: virtualPath });
          }
          regex.lastIndex = 0;
        } else {
          // Content search: only scan text files
          const ext = extname(filePath).toLowerCase();
          if (!TEXT_EXTENSIONS.has(ext)) continue;

          // Check file size to decide read strategy
          let isLargeFile = false;
          try {
            const stats = statSync(filePath);
            isLargeFile = stats.size > STREAMING_SEARCH_THRESHOLD;
          } catch {
            continue;
          }

          // Match against file content
          try {
            const matches = isLargeFile
              ? await searchStreaming(filePath, regex)
              : searchFullContent(filePath, regex);

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

/** Search full file content (small files) */
function searchFullContent(
  filePath: string,
  regex: RegExp
): { line: number; content: string }[] {
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

  return matches;
}

/** Stream-search a large file line-by-line without loading it all into memory */
function searchStreaming(
  filePath: string,
  regex: RegExp
): Promise<{ line: number; content: string }[]> {
  return new Promise((resolve, reject) => {
    const matches: { line: number; content: string }[] = [];
    let lineNumber = 0;
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => {
      lineNumber++;
      if (regex.test(line)) {
        matches.push({
          line: lineNumber,
          content: line.trim().slice(0, 200),
        });
      }
      regex.lastIndex = 0;
    });
    rl.on("close", () => resolve(matches));
    rl.on("error", reject);
  });
}
