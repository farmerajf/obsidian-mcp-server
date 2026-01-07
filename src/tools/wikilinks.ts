import { existsSync, readFileSync } from "fs";
import { basename, extname } from "path";
import { glob } from "glob";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath, toVirtualPath, getAllBasePaths } from "../utils/paths.js";

interface ResolvedLink {
  targetPath: string | null;
  targetExists: boolean;
  heading: string | null;
  blockRef: string | null;
  displayText: string | null;
}

export async function resolveWikilink(
  link: string,
  config: Config,
  sourcePath?: string
): Promise<CallToolResult> {
  try {
    const result = await resolveLink(link, config);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              link,
              resolved: result.targetPath !== null,
              ...result,
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

export async function extractWikilinks(
  path: string,
  config: Config,
  resolve: boolean = true,
  includeEmbeds: boolean = true
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: File does not exist: ${path}` }],
        isError: true,
      };
    }

    const content = readFileSync(resolved.fullPath, "utf-8");
    const lines = content.split("\n");

    // Match wikilinks: [[...]] and ![[...]]
    const linkRegex = includeEmbeds
      ? /(!?\[\[([^\]]+)\]\])/g
      : /(?<!!)\[\[([^\]]+)\]\]/g;

    const links: Array<{
      raw: string;
      line: number;
      column: number;
      isEmbed: boolean;
      resolved?: ResolvedLink;
    }> = [];

    let unresolvedCount = 0;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      let match;

      while ((match = linkRegex.exec(line)) !== null) {
        const raw = match[0];
        const isEmbed = raw.startsWith("!");
        const linkContent = includeEmbeds ? match[2] : match[1];

        const linkInfo: {
          raw: string;
          line: number;
          column: number;
          isEmbed: boolean;
          resolved?: ResolvedLink;
        } = {
          raw,
          line: lineNum + 1,
          column: match.index + 1,
          isEmbed,
        };

        if (resolve) {
          const resolvedLink = await resolveLink(linkContent, config);
          linkInfo.resolved = resolvedLink;
          if (!resolvedLink.targetExists) {
            unresolvedCount++;
          }
        }

        links.push(linkInfo);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path,
              links,
              unresolvedCount,
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

async function resolveLink(link: string, config: Config): Promise<ResolvedLink> {
  // Strip [[ and ]] if present
  let cleanLink = link.replace(/^\[\[/, "").replace(/\]\]$/, "");

  // Strip leading ! for embeds
  if (cleanLink.startsWith("!")) {
    cleanLink = cleanLink.slice(1);
  }

  // Extract display text (after |)
  let displayText: string | null = null;
  const pipeIdx = cleanLink.indexOf("|");
  if (pipeIdx !== -1) {
    displayText = cleanLink.slice(pipeIdx + 1);
    cleanLink = cleanLink.slice(0, pipeIdx);
  }

  // Extract heading (after #)
  let heading: string | null = null;
  const hashIdx = cleanLink.indexOf("#");
  if (hashIdx !== -1) {
    const afterHash = cleanLink.slice(hashIdx + 1);
    // Check if it's a block reference (^)
    if (afterHash.startsWith("^")) {
      // This is handled below
    } else {
      heading = afterHash;
    }
    cleanLink = cleanLink.slice(0, hashIdx);
  }

  // Extract block reference (after ^)
  let blockRef: string | null = null;
  const caretIdx = cleanLink.indexOf("^");
  if (caretIdx !== -1) {
    blockRef = cleanLink.slice(caretIdx + 1);
    cleanLink = cleanLink.slice(0, caretIdx);
  }

  // Also check if block ref is in the heading part
  if (heading && heading.includes("^")) {
    const parts = heading.split("^");
    heading = parts[0] || null;
    blockRef = parts[1] || null;
  }

  // Now resolve the link path
  const linkName = cleanLink.trim();

  // Search for the file
  for (const basePath of getAllBasePaths(config)) {
    // Try exact path match first
    const exactPath = linkName.endsWith(".md") ? linkName : `${linkName}.md`;
    const fullExactPath = `${basePath}/${exactPath}`;
    if (existsSync(fullExactPath)) {
      return {
        targetPath: toVirtualPath(fullExactPath, basePath),
        targetExists: true,
        heading,
        blockRef,
        displayText,
      };
    }

    // Search by filename anywhere in vault
    const files = await glob("**/*.md", {
      cwd: basePath,
      absolute: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    for (const filePath of files) {
      const fileName = basename(filePath, ".md");
      if (fileName.toLowerCase() === linkName.toLowerCase()) {
        return {
          targetPath: toVirtualPath(filePath, basePath),
          targetExists: true,
          heading,
          blockRef,
          displayText,
        };
      }
    }

    // Also check for non-markdown files (images, pdfs, etc.)
    if (!linkName.endsWith(".md")) {
      const allFiles = await glob("**/*", {
        cwd: basePath,
        absolute: true,
        nodir: true,
        ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
      });

      for (const filePath of allFiles) {
        const fileName = basename(filePath);
        if (fileName.toLowerCase() === linkName.toLowerCase()) {
          return {
            targetPath: toVirtualPath(filePath, basePath),
            targetExists: true,
            heading: null,
            blockRef: null,
            displayText,
          };
        }
      }
    }
  }

  return {
    targetPath: null,
    targetExists: false,
    heading,
    blockRef,
    displayText,
  };
}
