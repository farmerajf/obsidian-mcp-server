import { readFileSync } from "fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";

const MAX_LINES = 500;

export async function readFile(
  path: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);
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
