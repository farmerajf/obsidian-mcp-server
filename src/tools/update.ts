import { existsSync, readFileSync, writeFileSync } from "fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";

export async function updateFile(
  path: string,
  content: string,
  expectedEtag: string | undefined,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    // Check if file exists
    if (!existsSync(resolved.fullPath)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: File does not exist at ${path}. Use create_file to create new files.`,
          },
        ],
        isError: true,
      };
    }

    // If expectedEtag is provided, check for conflicts
    if (expectedEtag) {
      const currentContent = readFileSync(resolved.fullPath, "utf-8");
      const currentEtag = generateEtag(currentContent);

      if (currentEtag !== expectedEtag) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "Conflict detected",
                  message:
                    "The file has been modified since you last read it. Please read the file again to get the latest content and etag.",
                  currentEtag,
                  expectedEtag,
                  currentContent,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }

    // Write the file
    writeFileSync(resolved.fullPath, content, "utf-8");
    const newEtag = generateEtag(content);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              path,
              etag: newEtag,
              message: "File updated successfully",
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
