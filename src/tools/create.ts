import { existsSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";

export async function createFile(
  path: string,
  content: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    // Check if file already exists
    if (existsSync(resolved.fullPath)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: File already exists at ${path}. Use update_file to modify existing files.`,
          },
        ],
        isError: true,
      };
    }

    // Create parent directories if they don't exist
    const dir = dirname(resolved.fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write the file
    writeFileSync(resolved.fullPath, content, "utf-8");
    const etag = generateEtag(content);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              path,
              etag,
              message: "File created successfully",
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
