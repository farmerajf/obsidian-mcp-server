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
    const errors: string[] = [];
    // Track cumulative line offset so that line-number patches in a batch
    // reference the original file's line numbers rather than the shifted ones.
    let lineOffset = 0;

    for (const patch of patches) {
      const lines = content.split("\n");

      switch (patch.type) {
        case "replace_lines": {
          if (!patch.startLine || !patch.endLine || patch.content === undefined) {
            errors.push("replace_lines: missing required fields (startLine, endLine, content)");
            continue;
          }
          const start = patch.startLine - 1 + lineOffset;
          const end = patch.endLine + lineOffset;
          const deleteCount = end - start;
          const newLines = patch.content.split("\n");
          lines.splice(start, deleteCount, ...newLines);
          lineOffset += newLines.length - deleteCount;
          linesAffected += Math.max(deleteCount, newLines.length);
          content = lines.join("\n");
          patchesApplied++;
          break;
        }

        case "insert_after": {
          if (patch.content === undefined) {
            errors.push("insert_after: missing required field (content)");
            continue;
          }

          let insertIndex: number;

          if (patch.search !== undefined) {
            // String-based: find line containing the search text (literal match)
            const lineIdx = lines.findIndex(line => line.includes(patch.search!));
            if (lineIdx === -1) {
              errors.push(`insert_after: search string not found: "${patch.search}"`);
              continue;
            }
            insertIndex = lineIdx + 1;
          } else if (patch.line !== undefined && patch.line !== 0) {
            insertIndex = patch.line + lineOffset;
          } else {
            errors.push("insert_after: must provide either 'search' or 'line' parameter");
            continue;
          }

          const newLines = patch.content.split("\n");
          lines.splice(insertIndex, 0, ...newLines);
          lineOffset += newLines.length;
          linesAffected += newLines.length;
          content = lines.join("\n");
          patchesApplied++;
          break;
        }

        case "delete_lines": {
          if (!patch.startLine || !patch.endLine) {
            errors.push("delete_lines: missing required fields (startLine, endLine)");
            continue;
          }
          const start = patch.startLine - 1 + lineOffset;
          const end = patch.endLine + lineOffset;
          const deleteCount = end - start;
          const deleted = lines.splice(start, deleteCount);
          lineOffset -= deleted.length;
          linesAffected += deleted.length;
          content = lines.join("\n");
          patchesApplied++;
          break;
        }

        case "replace_first": {
          if (!patch.search || patch.replace === undefined) {
            errors.push("replace_first: missing required fields (search, replace)");
            continue;
          }
          const index = content.indexOf(patch.search);
          if (index !== -1) {
            content = content.slice(0, index) + patch.replace + content.slice(index + patch.search.length);
            linesAffected++;
            patchesApplied++;
          } else {
            errors.push(`replace_first: search string not found: "${patch.search}"`);
          }
          break;
        }

        case "replace_all": {
          if (!patch.search || patch.replace === undefined) {
            errors.push("replace_all: missing required fields (search, replace)");
            continue;
          }
          const regex = new RegExp(escapeRegex(patch.search), "g");
          const matches = content.match(regex);
          if (matches) {
            content = content.replace(regex, patch.replace);
            linesAffected += matches.length;
            patchesApplied++;
          } else {
            errors.push(`replace_all: search string not found: "${patch.search}"`);
          }
          break;
        }

        case "replace_regex": {
          if (!patch.pattern || patch.replace === undefined) {
            errors.push("replace_regex: missing required fields (pattern, replace)");
            continue;
          }
          const regex = new RegExp(patch.pattern, patch.flags || "g");
          const matches = content.match(regex);
          if (matches) {
            content = content.replace(regex, patch.replace);
            linesAffected += matches.length;
            patchesApplied++;
          } else {
            errors.push(`replace_regex: pattern not matched: "${patch.pattern}"`);
          }
          break;
        }
      }
    }

    // If no patches were applied, return error
    if (patchesApplied === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                path,
                patchesApplied: 0,
                errors,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    // Write the patched content
    writeFileSync(resolved.fullPath, content, "utf-8");
    const newEtag = generateEtag(content);

    const result: Record<string, unknown> = {
      success: true,
      path,
      patchesApplied,
      linesAffected,
      etag: newEtag,
    };

    if (errors.length > 0) {
      result.errors = errors;
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
