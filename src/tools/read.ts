import { existsSync, readFileSync, statSync } from "fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";
import { getMediaType, getMimeType, MAX_MEDIA_SIZE } from "../utils/media.js";
import { hasICloudStub } from "../utils/icloud.js";

const MAX_LINES = 500;

export async function readFile(
  path: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      if (hasICloudStub(resolved.fullPath)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: File exists in iCloud but has not been downloaded to this Mac yet. Open the file in Obsidian or Finder to trigger the download, then try again. Path: ${path}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `Error: File does not exist at ${path}` }],
        isError: true,
      };
    }

    const mediaType = getMediaType(resolved.fullPath);

    if (mediaType === "image" || mediaType === "audio") {
      const stats = statSync(resolved.fullPath);
      if (stats.size > MAX_MEDIA_SIZE) {
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${mediaType === "image" ? "Image" : "Audio"} file too large (${sizeMB} MB). Maximum supported size is 10 MB.`,
            },
          ],
          isError: true,
        };
      }

      const buffer = readFileSync(resolved.fullPath);
      const etag = generateEtag(buffer);
      const mimeType = getMimeType(resolved.fullPath)!;
      const base64 = buffer.toString("base64");

      return {
        content: [
          { type: mediaType, data: base64, mimeType },
          {
            type: "text",
            text: JSON.stringify({ path, mimeType, size: stats.size, etag }, null, 2),
          },
        ],
      };
    }

    if (mediaType === "video" || mediaType === "pdf") {
      const label = mediaType === "video" ? "Video" : "PDF";
      return {
        content: [
          {
            type: "text",
            text: `Error: ${label} files cannot be returned through MCP. Use get_file_metadata for file info.`,
          },
        ],
        isError: true,
      };
    }

    // Text file — existing behavior
    const fullContent = readFileSync(resolved.fullPath, "utf-8");
    const etag = generateEtag(fullContent);

    const lines = fullContent.split("\n");
    const totalLines = lines.length;

    if (totalLines > MAX_LINES) {
      const truncatedContent = lines.slice(0, MAX_LINES).join("\n");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                path,
                content: truncatedContent,
                etag,
                truncated: true,
                linesReturned: MAX_LINES,
                totalLines,
                message: `File truncated at ${MAX_LINES} lines (${totalLines} total). Use get_sections to see file structure, or read_section to read specific sections.`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path,
              content: fullContent,
              etag,
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
