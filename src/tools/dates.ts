import { readFileSync, statSync } from "fs";
import { basename } from "path";
import { glob } from "glob";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath, toVirtualPath, getAllVaults } from "../utils/paths.js";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

type DateCondition =
  | { relative: string }
  | { after: string }
  | { before: string }
  | { between: [string, string] }
  | { equals: string };

export async function searchByDate(
  dateField: string,
  condition: DateCondition,
  config: Config,
  path?: string,
  sortBy: "date" | "name" = "date",
  sortOrder: "asc" | "desc" = "desc",
  maxResults: number = 50
): Promise<CallToolResult> {
  try {
    const results: Array<{
      path: string;
      title: string | null;
      date: string;
    }> = [];

    // Calculate date range from condition
    const { startDate, endDate } = parseDateCondition(condition);

    // Determine search vaults
    let searchVaults: Array<{ name: string; basePath: string }>;
    if (path) {
      const resolved = resolvePath(path, config);
      searchVaults = [{ name: resolved.vaultName, basePath: resolved.fullPath }];
    } else {
      searchVaults = getAllVaults(config);
    }

    for (const vault of searchVaults) {
      const files = await glob("**/*.md", {
        cwd: vault.basePath,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
      });

      for (const filePath of files) {
        let fileDate: Date | null = null;

        if (dateField === "created" || dateField === "modified") {
          // Use file system dates
          const stats = statSync(filePath);
          fileDate = dateField === "created" ? stats.birthtime : stats.mtime;
        } else {
          // Look in frontmatter
          const content = readFileSync(filePath, "utf-8");
          const fmMatch = content.match(FRONTMATTER_REGEX);
          if (fmMatch) {
            const dateMatch = fmMatch[1].match(
              new RegExp(`${dateField}:\\s*["']?([^"'\\n]+)["']?`)
            );
            if (dateMatch) {
              const parsed = new Date(dateMatch[1].trim());
              if (!isNaN(parsed.getTime())) {
                fileDate = parsed;
              }
            }
          }
        }

        if (!fileDate) continue;

        // Check if date is in range
        const dateMs = fileDate.getTime();
        const inRange =
          (startDate === null || dateMs >= startDate.getTime()) &&
          (endDate === null || dateMs <= endDate.getTime());

        if (inRange) {
          // Get title
          let title: string | null = null;
          const content = readFileSync(filePath, "utf-8");
          const fmMatch = content.match(FRONTMATTER_REGEX);
          if (fmMatch) {
            const titleMatch = fmMatch[1].match(/title:\s*["']?([^"'\n]+)["']?/);
            if (titleMatch) {
              title = titleMatch[1].trim();
            }
          }
          if (!title) {
            title = basename(filePath, ".md");
          }

          const virtualPath = toVirtualPath(filePath, vault.basePath, vault.name);
          results.push({
            path: virtualPath,
            title,
            date: fileDate.toISOString(),
          });
        }
      }
    }

    // Sort results
    if (sortBy === "date") {
      results.sort((a, b) => {
        const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
        return sortOrder === "asc" ? diff : -diff;
      });
    } else {
      results.sort((a, b) => {
        const cmp = (a.title || "").localeCompare(b.title || "");
        return sortOrder === "asc" ? cmp : -cmp;
      });
    }

    // Limit results
    const limitedResults = results.slice(0, maxResults);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              dateField,
              condition,
              sortBy,
              sortOrder,
              results: limitedResults,
              totalMatches: results.length,
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

function parseDateCondition(condition: DateCondition): {
  startDate: Date | null;
  endDate: Date | null;
} {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if ("relative" in condition) {
    switch (condition.relative) {
      case "today":
        return {
          startDate: today,
          endDate: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1),
        };

      case "yesterday": {
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        return {
          startDate: yesterday,
          endDate: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000 - 1),
        };
      }

      case "this_week": {
        const dayOfWeek = today.getDay();
        const startOfWeek = new Date(today.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
        return {
          startDate: startOfWeek,
          endDate: now,
        };
      }

      case "last_7_days":
        return {
          startDate: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
          endDate: now,
        };

      case "this_month": {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return {
          startDate: startOfMonth,
          endDate: now,
        };
      }

      case "last_30_days":
        return {
          startDate: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
          endDate: now,
        };

      case "this_year": {
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        return {
          startDate: startOfYear,
          endDate: now,
        };
      }

      default:
        return { startDate: null, endDate: null };
    }
  }

  if ("after" in condition) {
    return {
      startDate: new Date(condition.after),
      endDate: null,
    };
  }

  if ("before" in condition) {
    return {
      startDate: null,
      endDate: new Date(condition.before),
    };
  }

  if ("between" in condition) {
    return {
      startDate: new Date(condition.between[0]),
      endDate: new Date(condition.between[1]),
    };
  }

  if ("equals" in condition) {
    const date = new Date(condition.equals);
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);
    return {
      startDate: startOfDay,
      endDate: endOfDay,
    };
  }

  return { startDate: null, endDate: null };
}
