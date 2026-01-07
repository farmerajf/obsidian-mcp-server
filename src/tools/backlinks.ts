import { existsSync, readFileSync } from "fs";
import { basename, extname } from "path";
import { glob } from "glob";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath, toVirtualPath, getAllBasePaths } from "../utils/paths.js";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

export async function getBacklinks(
  path: string,
  config: Config,
  includeContext: boolean = false,
  contextLines: number = 1
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);
    const targetName = basename(resolved.fullPath, extname(resolved.fullPath));
    const targetPath = path.replace(/^\//, "").replace(/\.md$/, "");

    const backlinks: Array<{
      sourcePath: string;
      sourceTitle: string | null;
      matches: Array<{
        line: number;
        linkText: string;
        context?: string;
      }>;
    }> = [];

    let totalCount = 0;

    // Search all markdown files for links to this file
    for (const basePath of getAllBasePaths(config)) {
      const files = await glob("**/*.md", {
        cwd: basePath,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
      });

      for (const filePath of files) {
        // Skip self
        if (filePath === resolved.fullPath) continue;

        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        // Get title from frontmatter or filename
        let sourceTitle: string | null = null;
        const fmMatch = content.match(FRONTMATTER_REGEX);
        if (fmMatch) {
          const titleMatch = fmMatch[1].match(/title:\s*["']?([^"'\n]+)["']?/);
          if (titleMatch) {
            sourceTitle = titleMatch[1].trim();
          }
        }
        if (!sourceTitle) {
          sourceTitle = basename(filePath, ".md");
        }

        const matches: Array<{
          line: number;
          linkText: string;
          context?: string;
        }> = [];

        // Find all wikilinks to this file
        const linkPatterns = [
          // Full path match
          new RegExp(`\\[\\[${escapeRegex(targetPath)}(#[^\\]|]*)?(\\|[^\\]]*)?\\]\\]`, "gi"),
          // Name only match
          new RegExp(`\\[\\[${escapeRegex(targetName)}(#[^\\]|]*)?(\\|[^\\]]*)?\\]\\]`, "gi"),
        ];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];

          for (const pattern of linkPatterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(line)) !== null) {
              const matchInfo: {
                line: number;
                linkText: string;
                context?: string;
              } = {
                line: lineNum + 1,
                linkText: match[0],
              };

              if (includeContext) {
                const startLine = Math.max(0, lineNum - contextLines);
                const endLine = Math.min(lines.length, lineNum + contextLines + 1);
                matchInfo.context = lines.slice(startLine, endLine).join("\n");
              }

              matches.push(matchInfo);
              totalCount++;
            }
          }
        }

        if (matches.length > 0) {
          const virtualPath = toVirtualPath(filePath, basePath);
          backlinks.push({
            sourcePath: virtualPath,
            sourceTitle,
            matches,
          });
        }
      }
    }

    // Sort by number of matches (most links first)
    backlinks.sort((a, b) => b.matches.length - a.matches.length);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              targetPath: path,
              backlinks,
              totalCount,
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
