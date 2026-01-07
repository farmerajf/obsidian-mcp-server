import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync } from "fs";
import { dirname } from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";

export async function appendFile(
  path: string,
  content: string,
  config: Config,
  options: {
    createIfMissing?: boolean;
    ensureNewline?: boolean;
    separator?: string;
  } = {}
): Promise<CallToolResult> {
  const { createIfMissing = false, ensureNewline = true, separator } = options;

  try {
    const resolved = resolvePath(path, config);
    let created = false;

    // Check if file exists
    if (!existsSync(resolved.fullPath)) {
      if (!createIfMissing) {
        return {
          content: [
            {
              type: "text",
              text: `Error: File does not exist at ${path}. Set createIfMissing to true to create it.`,
            },
          ],
          isError: true,
        };
      }

      // Create parent directories if needed
      const dir = dirname(resolved.fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Create file with content
      writeFileSync(resolved.fullPath, content, "utf-8");
      created = true;
    } else {
      // File exists, append to it
      let finalContent = content;

      if (ensureNewline) {
        // Check if file ends with newline
        const stats = statSync(resolved.fullPath);
        if (stats.size > 0) {
          const fd = readFileSync(resolved.fullPath);
          const lastChar = fd[fd.length - 1];
          if (lastChar !== 10) {
            // 10 = newline
            finalContent = "\n" + finalContent;
          }
        }
      }

      if (separator) {
        finalContent = separator + finalContent;
      }

      appendFileSync(resolved.fullPath, finalContent, "utf-8");
    }

    // Get new file stats
    const newContent = readFileSync(resolved.fullPath, "utf-8");
    const etag = generateEtag(newContent);
    const newSize = Buffer.byteLength(newContent, "utf-8");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              path,
              created,
              bytesAppended: Buffer.byteLength(content, "utf-8"),
              newSize,
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

export async function prependFile(
  path: string,
  content: string,
  config: Config,
  options: {
    afterFrontmatter?: boolean;
    createIfMissing?: boolean;
    ensureNewline?: boolean;
  } = {}
): Promise<CallToolResult> {
  const { afterFrontmatter = true, createIfMissing = false, ensureNewline = true } = options;

  try {
    const resolved = resolvePath(path, config);
    let created = false;

    // Check if file exists
    if (!existsSync(resolved.fullPath)) {
      if (!createIfMissing) {
        return {
          content: [
            {
              type: "text",
              text: `Error: File does not exist at ${path}. Set createIfMissing to true to create it.`,
            },
          ],
          isError: true,
        };
      }

      // Create parent directories if needed
      const dir = dirname(resolved.fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Create file with content
      writeFileSync(resolved.fullPath, content, "utf-8");
      created = true;
    } else {
      // File exists, prepend to it
      const existingContent = readFileSync(resolved.fullPath, "utf-8");
      let insertAt = 0;

      if (afterFrontmatter) {
        // Find end of frontmatter if present
        const frontmatterMatch = existingContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
        if (frontmatterMatch) {
          insertAt = frontmatterMatch[0].length;
        }
      }

      let finalContent = content;
      if (ensureNewline && !finalContent.endsWith("\n")) {
        finalContent += "\n";
      }

      const newContent =
        existingContent.slice(0, insertAt) + finalContent + existingContent.slice(insertAt);

      writeFileSync(resolved.fullPath, newContent, "utf-8");
    }

    // Get new file stats
    const newContent = readFileSync(resolved.fullPath, "utf-8");
    const etag = generateEtag(newContent);
    const newSize = Buffer.byteLength(newContent, "utf-8");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              path,
              created,
              bytesPrepended: Buffer.byteLength(content, "utf-8"),
              newSize,
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
