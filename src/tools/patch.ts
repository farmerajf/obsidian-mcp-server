import { existsSync, readFileSync, writeFileSync } from "fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";

interface PatchOperation {
  type:
    | "replace_lines"
    | "insert_after"
    | "delete_lines"
    | "replace_first"
    | "replace_all"
    | "replace_regex";
  startLine?: number;
  endLine?: number;
  line?: number;
  content?: string;
  search?: string;
  replace?: string;
  pattern?: string;
  flags?: string;
}

export async function patchFile(
  path: string,
  patches: PatchOperation[],
  config: Config,
  expectedEtag?: string
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: File does not exist at ${path}` }],
        isError: true,
      };
    }

    let content = readFileSync(resolved.fullPath, "utf-8");
    const currentEtag = generateEtag(content);

    // Check for conflicts
    if (expectedEtag && currentEtag !== expectedEtag) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "Conflict detected",
                message: "File has been modified since last read",
                currentEtag,
                expectedEtag,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    let patchesApplied = 0;
    let linesAffected = 0;

    for (const patch of patches) {
      const lines = content.split("\n");

      switch (patch.type) {
        case "replace_lines": {
          if (!patch.startLine || !patch.endLine || patch.content === undefined) {
            continue;
          }
          const start = patch.startLine - 1; // Convert to 0-indexed
          const end = patch.endLine;
          const newLines = patch.content.split("\n");
          lines.splice(start, end - start, ...newLines);
          linesAffected += end - start;
          content = lines.join("\n");
          patchesApplied++;
          break;
        }

        case "insert_after": {
          if (!patch.line || patch.content === undefined) {
            continue;
          }
          const insertIndex = patch.line; // Insert after this line (0-indexed would be line-1, but we want after)
          const newLines = patch.content.split("\n");
          lines.splice(insertIndex, 0, ...newLines);
          linesAffected += newLines.length;
          content = lines.join("\n");
          patchesApplied++;
          break;
        }

        case "delete_lines": {
          if (!patch.startLine || !patch.endLine) {
            continue;
          }
          const start = patch.startLine - 1;
          const end = patch.endLine;
          const deleted = lines.splice(start, end - start);
          linesAffected += deleted.length;
          content = lines.join("\n");
          patchesApplied++;
          break;
        }

        case "replace_first": {
          if (!patch.search || patch.replace === undefined) {
            continue;
          }
          const index = content.indexOf(patch.search);
          if (index !== -1) {
            content = content.slice(0, index) + patch.replace + content.slice(index + patch.search.length);
            linesAffected++;
            patchesApplied++;
          }
          break;
        }

        case "replace_all": {
          if (!patch.search || patch.replace === undefined) {
            continue;
          }
          const regex = new RegExp(escapeRegex(patch.search), "g");
          const matches = content.match(regex);
          if (matches) {
            content = content.replace(regex, patch.replace);
            linesAffected += matches.length;
            patchesApplied++;
          }
          break;
        }

        case "replace_regex": {
          if (!patch.pattern || patch.replace === undefined) {
            continue;
          }
          const regex = new RegExp(patch.pattern, patch.flags || "g");
          const matches = content.match(regex);
          if (matches) {
            content = content.replace(regex, patch.replace);
            linesAffected += matches.length;
            patchesApplied++;
          }
          break;
        }
      }
    }

    // Write the patched content
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
              patchesApplied,
              linesAffected,
              etag: newEtag,
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
