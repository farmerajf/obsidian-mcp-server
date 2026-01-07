import { existsSync, readFileSync } from "fs";
import { basename } from "path";
import { glob } from "glob";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath, toVirtualPath, getAllBasePaths } from "../utils/paths.js";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

export async function searchByTag(
  tags: string[],
  config: Config,
  match: "any" | "all" = "any",
  path?: string,
  location: "frontmatter" | "body" | "both" = "both"
): Promise<CallToolResult> {
  try {
    const results: Array<{
      path: string;
      title: string | null;
      matchedTags: string[];
      tagLocations: Array<{
        tag: string;
        location: "frontmatter" | "body";
        line?: number;
      }>;
    }> = [];

    // Normalize tags (remove # if present)
    const normalizedTags = tags.map((t) => t.replace(/^#/, "").toLowerCase());

    // Determine search paths
    let searchPaths: string[];
    if (path) {
      const resolved = resolvePath(path, config);
      searchPaths = [resolved.fullPath];
    } else {
      searchPaths = getAllBasePaths(config);
    }

    for (const basePath of searchPaths) {
      const files = await glob("**/*.md", {
        cwd: basePath,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
      });

      for (const filePath of files) {
        const content = readFileSync(filePath, "utf-8");
        const matchedTags: string[] = [];
        const tagLocations: Array<{
          tag: string;
          location: "frontmatter" | "body";
          line?: number;
        }> = [];

        // Extract frontmatter tags
        if (location === "frontmatter" || location === "both") {
          const fmTags = extractFrontmatterTags(content);
          for (const fmTag of fmTags) {
            const normalized = fmTag.toLowerCase();
            for (const searchTag of normalizedTags) {
              // Match exact or nested (project matches project/sub)
              if (normalized === searchTag || normalized.startsWith(searchTag + "/")) {
                if (!matchedTags.includes(fmTag)) {
                  matchedTags.push(fmTag);
                  tagLocations.push({
                    tag: fmTag,
                    location: "frontmatter",
                  });
                }
              }
            }
          }
        }

        // Extract inline tags
        if (location === "body" || location === "both") {
          const lines = content.split("\n");
          // Skip frontmatter
          let startLine = 0;
          if (content.startsWith("---")) {
            const fmMatch = content.match(FRONTMATTER_REGEX);
            if (fmMatch) {
              startLine = fmMatch[0].split("\n").length;
            }
          }

          for (let i = startLine; i < lines.length; i++) {
            const inlineTags = lines[i].match(/#[\w\-\/]+/g);
            if (inlineTags) {
              for (const inlineTag of inlineTags) {
                const tagWithoutHash = inlineTag.slice(1);
                const normalized = tagWithoutHash.toLowerCase();
                for (const searchTag of normalizedTags) {
                  if (normalized === searchTag || normalized.startsWith(searchTag + "/")) {
                    if (!matchedTags.includes(tagWithoutHash)) {
                      matchedTags.push(tagWithoutHash);
                      tagLocations.push({
                        tag: tagWithoutHash,
                        location: "body",
                        line: i + 1,
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // Check if we have enough matches
        const hasEnoughMatches =
          match === "any"
            ? matchedTags.length > 0
            : normalizedTags.every((t) =>
                matchedTags.some(
                  (m) => m.toLowerCase() === t || m.toLowerCase().startsWith(t + "/")
                )
              );

        if (hasEnoughMatches) {
          // Get title
          let title: string | null = null;
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

          const virtualPath = toVirtualPath(filePath, basePath);
          results.push({
            path: virtualPath,
            title,
            matchedTags,
            tagLocations,
          });
        }
      }
    }

    // Sort by number of matched tags
    results.sort((a, b) => b.matchedTags.length - a.matchedTags.length);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              tags,
              match,
              results,
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

export async function listAllTags(
  config: Config,
  path?: string,
  minCount: number = 1
): Promise<CallToolResult> {
  try {
    const tagCounts = new Map<string, number>();

    // Determine search paths
    let searchPaths: string[];
    if (path) {
      const resolved = resolvePath(path, config);
      searchPaths = [resolved.fullPath];
    } else {
      searchPaths = getAllBasePaths(config);
    }

    for (const basePath of searchPaths) {
      const files = await glob("**/*.md", {
        cwd: basePath,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
      });

      for (const filePath of files) {
        const content = readFileSync(filePath, "utf-8");

        // Frontmatter tags
        const fmTags = extractFrontmatterTags(content);
        for (const tag of fmTags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }

        // Inline tags (skip frontmatter)
        let body = content;
        if (content.startsWith("---")) {
          const fmMatch = content.match(FRONTMATTER_REGEX);
          if (fmMatch) {
            body = content.slice(fmMatch[0].length);
          }
        }

        const inlineTags = body.match(/#[\w\-\/]+/g);
        if (inlineTags) {
          for (const tag of inlineTags) {
            const tagWithoutHash = tag.slice(1);
            tagCounts.set(tagWithoutHash, (tagCounts.get(tagWithoutHash) || 0) + 1);
          }
        }
      }
    }

    // Build result with nested tag info
    const tags: Array<{
      tag: string;
      count: number;
      nestedUnder?: string;
    }> = [];

    for (const [tag, count] of tagCounts) {
      if (count >= minCount) {
        const slashIdx = tag.indexOf("/");
        tags.push({
          tag,
          count,
          nestedUnder: slashIdx > 0 ? tag.slice(0, slashIdx) : undefined,
        });
      }
    }

    // Sort by count descending
    tags.sort((a, b) => b.count - a.count);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              tags,
              totalTags: tags.length,
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

function extractFrontmatterTags(content: string): string[] {
  const tags: string[] = [];
  const fmMatch = content.match(FRONTMATTER_REGEX);
  if (!fmMatch) return tags;

  const fm = fmMatch[1];

  // Match tags: [a, b, c]
  const arrayMatch = fm.match(/tags:\s*\[([^\]]*)\]/);
  if (arrayMatch) {
    arrayMatch[1].split(",").forEach((t) => {
      const cleaned = t.trim().replace(/['"]/g, "");
      if (cleaned) tags.push(cleaned);
    });
    return tags;
  }

  // Match tags: a, b, c (single line)
  const lineMatch = fm.match(/tags:\s*([^\n]+)/);
  if (lineMatch && !lineMatch[1].trim().startsWith("[")) {
    lineMatch[1].split(/[,\s]+/).forEach((t) => {
      const cleaned = t.trim().replace(/['"]/g, "");
      if (cleaned) tags.push(cleaned);
    });
    return tags;
  }

  // Match tags: (multiline with -)
  const multiMatch = fm.match(/tags:\s*\n((?:\s*-\s*[^\n]+\n?)+)/);
  if (multiMatch) {
    multiMatch[1].split("\n").forEach((line) => {
      const itemMatch = line.match(/^\s*-\s*["']?([^"'\n]+)["']?/);
      if (itemMatch) {
        tags.push(itemMatch[1].trim());
      }
    });
  }

  return tags;
}
