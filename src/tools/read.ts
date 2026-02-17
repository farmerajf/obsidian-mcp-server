import { readFileSync } from "fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";

export async function readFile(
  path: string,
  config: Config,
  maxLines: number = 500
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);
    const fullContent = readFileSync(resolved.fullPath, "utf-8");
    const etag = generateEtag(fullContent);

    const lines = fullContent.split("\n");
    const totalLines = lines.length;

    if (maxLines > 0 && totalLines > maxLines) {
      const truncatedContent = lines.slice(0, maxLines).join("\n");

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
                linesReturned: maxLines,
                totalLines,
                message: `File truncated at ${maxLines} lines (${totalLines} total). Use get_sections to see file structure, read_section to read specific sections, or read_file with maxLines: 0 for the full file.`,
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
