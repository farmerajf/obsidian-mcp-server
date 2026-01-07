import { statSync } from "fs";
import { basename, extname } from "path";
import { glob } from "glob";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath, toVirtualPath, getAllBasePaths } from "../utils/paths.js";

export async function fuzzySearch(
  query: string,
  config: Config,
  path?: string,
  maxResults: number = 20,
  threshold: number = 0.4,
  includeDirectories: boolean = false
): Promise<CallToolResult> {
  try {
    const results: Array<{
      path: string;
      filename: string;
      score: number;
      highlights: Array<{ start: number; end: number }>;
    }> = [];

    // Determine search paths
    let searchPaths: string[];
    if (path) {
      const resolved = resolvePath(path, config);
      searchPaths = [resolved.fullPath];
    } else {
      searchPaths = getAllBasePaths(config);
    }

    const queryLower = query.toLowerCase();

    for (const basePath of searchPaths) {
      const pattern = includeDirectories ? "**/*" : "**/*.*";
      const files = await glob(pattern, {
        cwd: basePath,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
      });

      for (const filePath of files) {
        const filename = basename(filePath);
        const nameWithoutExt = basename(filePath, extname(filePath));

        // Calculate fuzzy match score
        const { score, highlights } = fuzzyMatch(queryLower, nameWithoutExt.toLowerCase());

        if (score >= threshold) {
          const virtualPath = toVirtualPath(filePath, basePath);
          results.push({
            path: virtualPath,
            filename,
            score,
            highlights,
          });
        }
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Limit results
    const limitedResults = results.slice(0, maxResults);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              query,
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

// Simple fuzzy matching algorithm
function fuzzyMatch(
  query: string,
  target: string
): { score: number; highlights: Array<{ start: number; end: number }> } {
  const highlights: Array<{ start: number; end: number }> = [];

  if (query.length === 0) {
    return { score: 0, highlights };
  }

  if (target.length === 0) {
    return { score: 0, highlights };
  }

  // Exact match
  if (target === query) {
    return {
      score: 1,
      highlights: [{ start: 0, end: target.length }],
    };
  }

  // Contains match
  const containsIdx = target.indexOf(query);
  if (containsIdx !== -1) {
    return {
      score: 0.9 - containsIdx * 0.01,
      highlights: [{ start: containsIdx, end: containsIdx + query.length }],
    };
  }

  // Fuzzy character-by-character match
  let queryIdx = 0;
  let consecutiveMatches = 0;
  let totalMatches = 0;
  let currentHighlight: { start: number; end: number } | null = null;

  for (let targetIdx = 0; targetIdx < target.length && queryIdx < query.length; targetIdx++) {
    if (target[targetIdx] === query[queryIdx]) {
      totalMatches++;

      if (currentHighlight && currentHighlight.end === targetIdx) {
        currentHighlight.end = targetIdx + 1;
        consecutiveMatches++;
      } else {
        if (currentHighlight) {
          highlights.push(currentHighlight);
        }
        currentHighlight = { start: targetIdx, end: targetIdx + 1 };
        consecutiveMatches = 1;
      }

      queryIdx++;
    }
  }

  if (currentHighlight) {
    highlights.push(currentHighlight);
  }

  // Calculate score based on:
  // - Percentage of query matched
  // - Position of matches (earlier is better)
  // - Consecutive matches (bonus)
  const queryMatched = queryIdx / query.length;
  const positionBonus = highlights.length > 0 ? (1 - highlights[0].start / target.length) * 0.1 : 0;
  const consecutiveBonus = consecutiveMatches > 1 ? Math.min(consecutiveMatches * 0.05, 0.2) : 0;

  const score = Math.min(queryMatched * 0.8 + positionBonus + consecutiveBonus, 1);

  return { score, highlights };
}
