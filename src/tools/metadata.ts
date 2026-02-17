import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from "fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";
import { parseSections } from "../utils/sections.js";

export async function readFilePartial(
  path: string,
  config: Config,
  options: {
    mode: "lines" | "bytes";
    start: number;
    end?: number;
    includeMeta?: boolean;
  }
): Promise<CallToolResult> {
  const { mode, start, end, includeMeta = true } = options;

  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: File does not exist at ${path}` }],
        isError: true,
      };
    }

    const fullContent = readFileSync(resolved.fullPath, "utf-8");
    const stats = statSync(resolved.fullPath);
    let content: string;
    let actualEnd: number;

    if (mode === "lines") {
      const lines = fullContent.split("\n");
      const startIdx = start - 1; // Convert to 0-indexed
      const endIdx = end ? end : lines.length;
      actualEnd = Math.min(endIdx, lines.length);
      content = lines.slice(startIdx, actualEnd).join("\n");
    } else {
      // bytes mode
      const startByte = start;
      const endByte = end !== undefined ? end : stats.size;
      actualEnd = Math.min(endByte, stats.size);
      content = fullContent.slice(startByte, actualEnd);
    }

    const result: Record<string, unknown> = {
      path,
      content,
      mode,
      start,
      end: actualEnd,
      etag: generateEtag(fullContent),
    };

    if (includeMeta) {
      if (mode === "lines") {
        result.totalLines = fullContent.split("\n").length;
      }
      result.totalBytes = stats.size;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
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

export async function getFileMetadata(
  path: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                path,
                exists: false,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const stats = statSync(resolved.fullPath);
    const isFile = stats.isFile();

    const result: Record<string, unknown> = {
      path,
      exists: true,
      type: isFile ? "file" : "directory",
      size: stats.size,
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
    };

    if (isFile) {
      const content = readFileSync(resolved.fullPath, "utf-8");
      result.etag = generateEtag(content);
      result.lineCount = content.split("\n").length;

      // Check for frontmatter
      result.hasFrontmatter = content.startsWith("---\n") || content.startsWith("---\r\n");

      // Quick tag extraction from frontmatter and body
      const tags = new Set<string>();

      // Frontmatter tags
      const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (frontmatterMatch) {
        const fmContent = frontmatterMatch[1];
        const tagsMatch = fmContent.match(/tags:\s*\[([^\]]*)\]/);
        if (tagsMatch) {
          tagsMatch[1].split(",").forEach((t) => tags.add(t.trim().replace(/['"]/g, "")));
        }
        const tagsLineMatch = fmContent.match(/tags:\s*(.+)$/m);
        if (tagsLineMatch && !tagsLineMatch[1].startsWith("[")) {
          tagsLineMatch[1].split(/[,\s]+/).forEach((t) => {
            if (t.trim()) tags.add(t.trim());
          });
        }
      }

      // Inline tags
      const inlineTags = content.match(/#[\w\-\/]+/g);
      if (inlineTags) {
        inlineTags.forEach((t) => tags.add(t.slice(1))); // Remove #
      }

      if (tags.size > 0) {
        result.tags = Array.from(tags);
      }

      // Count wikilinks
      const wikilinks = content.match(/\[\[([^\]]+)\]\]/g);
      result.linkCount = wikilinks ? wikilinks.length : 0;

      // Section count and large file hint
      const parsed = parseSections(content);
      result.sectionCount = parsed.sections.length;
      result.largeFile = (result.lineCount as number) > 200;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
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
