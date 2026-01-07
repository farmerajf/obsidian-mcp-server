import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, appendFileSync } from "fs";
import { dirname } from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";

interface ReadResult {
  path: string;
  success: boolean;
  content?: string;
  etag?: string;
  error?: string;
  metadata?: { size: number; modified: string };
}

export async function batchRead(
  paths: string[],
  config: Config,
  includeMetadata: boolean = false,
  failFast: boolean = false
): Promise<CallToolResult> {
  const results: ReadResult[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const path of paths) {
    try {
      const resolved = resolvePath(path, config);

      if (!existsSync(resolved.fullPath)) {
        if (failFast) {
          return {
            content: [{ type: "text", text: `Error: File not found: ${path}` }],
            isError: true,
          };
        }
        results.push({
          path,
          success: false,
          error: "File not found",
        });
        failureCount++;
        continue;
      }

      const content = readFileSync(resolved.fullPath, "utf-8");
      const etag = generateEtag(content);

      const result: ReadResult = {
        path,
        success: true,
        content,
        etag,
      };

      if (includeMetadata) {
        const stats = require("fs").statSync(resolved.fullPath);
        result.metadata = {
          size: stats.size,
          modified: stats.mtime.toISOString(),
        };
      }

      results.push(result);
      successCount++;
    } catch (error) {
      if (failFast) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error reading ${path}: ${message}` }],
          isError: true,
        };
      }
      results.push({
        path,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      failureCount++;
    }
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            results,
            successCount,
            failureCount,
          },
          null,
          2
        ),
      },
    ],
  };
}

type WriteOperation =
  | { type: "create"; path: string; content: string }
  | { type: "update"; path: string; content: string; expectedEtag?: string }
  | { type: "append"; path: string; content: string }
  | { type: "delete"; path: string };

interface WriteResult {
  path: string;
  success: boolean;
  operation: string;
  etag?: string;
  error?: string;
}

export async function batchWrite(
  operations: WriteOperation[],
  config: Config,
  atomic: boolean = true
): Promise<CallToolResult> {
  const results: WriteResult[] = [];
  let successCount = 0;
  let failureCount = 0;

  // If atomic, validate all operations first
  if (atomic) {
    for (const op of operations) {
      const resolved = resolvePath(op.path, config);

      if (op.type === "create" && existsSync(resolved.fullPath)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Atomic batch failed - file already exists: ${op.path}`,
            },
          ],
          isError: true,
        };
      }

      if (op.type === "update") {
        if (!existsSync(resolved.fullPath)) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Atomic batch failed - file not found for update: ${op.path}`,
              },
            ],
            isError: true,
          };
        }

        if (op.expectedEtag) {
          const content = readFileSync(resolved.fullPath, "utf-8");
          const currentEtag = generateEtag(content);
          if (currentEtag !== op.expectedEtag) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Atomic batch failed - ETag mismatch for: ${op.path}`,
                },
              ],
              isError: true,
            };
          }
        }
      }

      if (op.type === "delete" && !existsSync(resolved.fullPath)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Atomic batch failed - file not found for delete: ${op.path}`,
            },
          ],
          isError: true,
        };
      }
    }
  }

  // Execute operations
  for (const op of operations) {
    try {
      const resolved = resolvePath(op.path, config);

      switch (op.type) {
        case "create": {
          if (existsSync(resolved.fullPath)) {
            if (!atomic) {
              results.push({
                path: op.path,
                success: false,
                operation: "create",
                error: "File already exists",
              });
              failureCount++;
              continue;
            }
          }

          const dir = dirname(resolved.fullPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }

          writeFileSync(resolved.fullPath, op.content, "utf-8");
          const etag = generateEtag(op.content);
          results.push({
            path: op.path,
            success: true,
            operation: "create",
            etag,
          });
          successCount++;
          break;
        }

        case "update": {
          if (!existsSync(resolved.fullPath)) {
            if (!atomic) {
              results.push({
                path: op.path,
                success: false,
                operation: "update",
                error: "File not found",
              });
              failureCount++;
              continue;
            }
          }

          writeFileSync(resolved.fullPath, op.content, "utf-8");
          const etag = generateEtag(op.content);
          results.push({
            path: op.path,
            success: true,
            operation: "update",
            etag,
          });
          successCount++;
          break;
        }

        case "append": {
          if (!existsSync(resolved.fullPath)) {
            // Create new file
            const dir = dirname(resolved.fullPath);
            if (!existsSync(dir)) {
              mkdirSync(dir, { recursive: true });
            }
            writeFileSync(resolved.fullPath, op.content, "utf-8");
          } else {
            appendFileSync(resolved.fullPath, op.content, "utf-8");
          }

          const content = readFileSync(resolved.fullPath, "utf-8");
          const etag = generateEtag(content);
          results.push({
            path: op.path,
            success: true,
            operation: "append",
            etag,
          });
          successCount++;
          break;
        }

        case "delete": {
          if (!existsSync(resolved.fullPath)) {
            if (!atomic) {
              results.push({
                path: op.path,
                success: false,
                operation: "delete",
                error: "File not found",
              });
              failureCount++;
              continue;
            }
          }

          unlinkSync(resolved.fullPath);
          results.push({
            path: op.path,
            success: true,
            operation: "delete",
          });
          successCount++;
          break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        path: op.path,
        success: false,
        operation: op.type,
        error: message,
      });
      failureCount++;

      if (atomic) {
        // In atomic mode, we should have caught this earlier
        // but if we get here, return error
        return {
          content: [
            {
              type: "text",
              text: `Error: Atomic batch failed during ${op.type}: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            results,
            successCount,
            failureCount,
            atomic,
          },
          null,
          2
        ),
      },
    ],
  };
}
