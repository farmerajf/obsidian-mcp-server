import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, appendFileSync, statSync } from "fs";
import { dirname } from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag, generateEtagStream } from "../utils/etag.js";
import { getMediaType, getMimeType, MAX_MEDIA_SIZE } from "../utils/media.js";
import { readFirstLines } from "../utils/streaming.js";
import { MAX_LINES, STREAMING_THRESHOLD } from "../utils/constants.js";

interface ReadResult {
  path: string;
  success: boolean;
  content?: string;
  etag?: string;
  error?: string;
  metadata?: { size: number; modified: string };
  mediaType?: string;
  mimeType?: string;
  truncated?: boolean;
  linesReturned?: number;
  totalLines?: number;
}

export async function batchRead(
  paths: string[],
  config: Config,
  includeMetadata: boolean = false,
  failFast: boolean = false
): Promise<CallToolResult> {
  // Process files concurrently (unless failFast, which requires sequential)
  if (failFast) {
    return batchReadSequential(paths, config, includeMetadata, failFast);
  }

  const resultPromises = paths.map((path) =>
    readSingleFile(path, config, includeMetadata)
  );
  const fileResults = await Promise.all(resultPromises);

  let successCount = 0;
  let failureCount = 0;
  for (const r of fileResults) {
    if (r.success) successCount++;
    else failureCount++;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            results: fileResults,
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

async function batchReadSequential(
  paths: string[],
  config: Config,
  includeMetadata: boolean,
  failFast: boolean
): Promise<CallToolResult> {
  const results: ReadResult[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const path of paths) {
    const result = await readSingleFile(path, config, includeMetadata);

    if (!result.success && failFast) {
      return {
        content: [{ type: "text", text: `Error: ${result.error ?? "Unknown error"}: ${path}` }],
        isError: true,
      };
    }

    results.push(result);
    if (result.success) successCount++;
    else failureCount++;
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

async function readSingleFile(
  path: string,
  config: Config,
  includeMetadata: boolean
): Promise<ReadResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return { path, success: false, error: "File not found" };
    }

    const fileMediaType = getMediaType(resolved.fullPath);

    if (fileMediaType === "image" || fileMediaType === "audio") {
      const stats = statSync(resolved.fullPath);
      if (stats.size > MAX_MEDIA_SIZE) {
        return {
          path,
          success: false,
          mediaType: fileMediaType,
          mimeType: getMimeType(resolved.fullPath) ?? undefined,
          error: `File too large (${(stats.size / (1024 * 1024)).toFixed(1)} MB). Use read_file individually for files up to 10 MB.`,
        };
      }
      const buffer = readFileSync(resolved.fullPath);
      const etag = generateEtag(buffer);
      const result: ReadResult = {
        path,
        success: true,
        content: buffer.toString("base64"),
        etag,
        mediaType: fileMediaType,
        mimeType: getMimeType(resolved.fullPath) ?? undefined,
      };
      if (includeMetadata) {
        result.metadata = { size: stats.size, modified: stats.mtime.toISOString() };
      }
      return result;
    }

    if (fileMediaType === "pdf") {
      const stats = statSync(resolved.fullPath);
      if (stats.size > MAX_MEDIA_SIZE) {
        return {
          path,
          success: false,
          mediaType: fileMediaType,
          mimeType: getMimeType(resolved.fullPath) ?? undefined,
          error: `File too large (${(stats.size / (1024 * 1024)).toFixed(1)} MB). Maximum supported size is 10 MB.`,
        };
      }
      const buffer = readFileSync(resolved.fullPath);
      const etag = generateEtag(buffer);
      const result: ReadResult = {
        path,
        success: true,
        content: buffer.toString("base64"),
        etag,
        mediaType: fileMediaType,
        mimeType: getMimeType(resolved.fullPath) ?? undefined,
      };
      if (includeMetadata) {
        result.metadata = { size: stats.size, modified: stats.mtime.toISOString() };
      }
      return result;
    }

    if (fileMediaType === "video") {
      const stats = statSync(resolved.fullPath);
      const result: ReadResult = {
        path,
        success: true,
        mediaType: fileMediaType,
        mimeType: getMimeType(resolved.fullPath) ?? undefined,
      };
      if (includeMetadata) {
        result.metadata = { size: stats.size, modified: stats.mtime.toISOString() };
      }
      return result;
    }

    // Text file — use streaming for large files
    const stats = statSync(resolved.fullPath);

    if (stats.size > STREAMING_THRESHOLD) {
      const [{ lines: firstLines, totalLines }, etag] = await Promise.all([
        readFirstLines(resolved.fullPath, MAX_LINES),
        generateEtagStream(resolved.fullPath),
      ]);

      const result: ReadResult = { path, success: true, etag };

      if (totalLines > MAX_LINES) {
        result.content = firstLines.join("\n");
        result.truncated = true;
        result.linesReturned = MAX_LINES;
        result.totalLines = totalLines;
      } else {
        result.content = firstLines.join("\n");
      }

      if (includeMetadata) {
        result.metadata = { size: stats.size, modified: stats.mtime.toISOString() };
      }
      return result;
    }

    // Small text file: read all at once (fast path)
    const fullContent = readFileSync(resolved.fullPath, "utf-8");
    const etag = generateEtag(fullContent);

    const lines = fullContent.split("\n");
    const totalLines = lines.length;

    const result: ReadResult = { path, success: true, etag };

    if (totalLines > MAX_LINES) {
      result.content = lines.slice(0, MAX_LINES).join("\n");
      result.truncated = true;
      result.linesReturned = MAX_LINES;
      result.totalLines = totalLines;
    } else {
      result.content = fullContent;
    }

    if (includeMetadata) {
      result.metadata = { size: stats.size, modified: stats.mtime.toISOString() };
    }
    return result;
  } catch (error) {
    return {
      path,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
