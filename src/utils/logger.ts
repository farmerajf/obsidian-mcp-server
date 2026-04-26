import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Patches server.tool() so every registered tool handler is automatically
 * wrapped with request/response logging. Call this once before registerTools().
 */
export function wrapWithToolLogging(server: McpServer): void {
  const originalTool = server.tool.bind(server);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool = function (...args: any[]) {
    const name = args[0] as string;

    // The callback is always the last argument
    const lastIdx = args.length - 1;
    const originalCb = args[lastIdx];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args[lastIdx] = async function (parsedArgs: any, extra: any) {
      const start = Date.now();
      const sessionId = extra?.sessionId
        ? extra.sessionId.slice(0, 8)
        : "local";
      const argsSummary = summarizeArgs(name, parsedArgs);

      console.log(`[tool] ${sessionId} → ${name}${argsSummary}`);

      try {
        const result = await originalCb(parsedArgs, extra);
        const duration = Date.now() - start;
        const status = result?.isError ? "FAILED" : "ok";
        const resultSummary = summarizeResult(name, result);

        console.log(
          `[tool] ${sessionId} ← ${name} ${status} (${duration}ms)${resultSummary}`
        );
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[tool] ${sessionId} ← ${name} ERROR (${duration}ms): ${message}`
        );
        throw error;
      }
    };

    return (originalTool as Function).apply(server, args);
  };
}

/** Summarize tool arguments for logging — omit large content fields */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizeArgs(toolName: string, args: Record<string, any>): string {
  if (!args || Object.keys(args).length === 0) return "";

  const parts: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;

    // Skip default/boolean values that don't add info
    if (typeof value === "boolean" && !value) continue;

    // Truncate large string values (file content, base64, etc.)
    if (typeof value === "string") {
      if (
        key === "content" ||
        key === "expectedEtag" ||
        key === "blob"
      ) {
        parts.push(`${key}=(${value.length} chars)`);
      } else if (value.length > 100) {
        parts.push(`${key}="${value.slice(0, 80)}…"`);
      } else {
        parts.push(`${key}="${value}"`);
      }
    } else if (Array.isArray(value)) {
      if (key === "paths") {
        parts.push(`paths=[${value.map(truncatePath).join(", ")}]`);
      } else if (key === "operations") {
        parts.push(`operations=(${value.length} ops)`);
      } else if (key === "patches") {
        parts.push(`patches=(${value.length} patches)`);
      } else if (key === "tags") {
        parts.push(`tags=[${value.join(", ")}]`);
      } else {
        parts.push(`${key}=(${value.length} items)`);
      }
    } else if (typeof value === "object") {
      // For objects like condition in search_by_date
      parts.push(`${key}=${JSON.stringify(value)}`);
    } else {
      parts.push(`${key}=${value}`);
    }
  }

  return parts.length > 0 ? ` ${parts.join(", ")}` : "";
}

/** Summarize tool result for logging — just counts and key info */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizeResult(toolName: string, result: any): string {
  if (!result?.content?.[0]?.text) return "";

  try {
    const text = result.content[0].text;

    // Error results already show in the status
    if (result.isError) {
      const msg = text.length > 120 ? text.slice(0, 120) + "…" : text;
      return ` — ${msg}`;
    }

    // For binary content (images, audio, PDFs) just note the type
    if (result.content[0].type === "image") return " — image";
    if (result.content[0].type === "audio") return " — audio";
    if (result.content[0].type === "resource") return " — resource";

    // Try to parse JSON results for structured summaries
    const data = JSON.parse(text);

    // Tools that return arrays at top level (list_directory)
    if (Array.isArray(data)) {
      return ` — ${data.length} items`;
    }

    // Tools with results arrays (search, batch, tags, etc.)
    if (data.results && Array.isArray(data.results)) {
      const extra: string[] = [`${data.results.length} results`];
      if (data.successCount !== undefined)
        extra[0] = `${data.successCount} ok, ${data.failureCount} failed`;
      if (data.truncated) extra.push("truncated");
      return ` — ${extra.join(", ")}`;
    }

    // Tools with resultCount (search)
    if (data.resultCount !== undefined) {
      return ` — ${data.resultCount} results`;
    }

    // read_file / read_section
    if (data.path && data.content !== undefined) {
      const info: string[] = [];
      if (data.truncated) info.push(`truncated ${data.linesReturned}/${data.totalLines} lines`);
      if (data.etag) info.push(`etag=${data.etag.slice(0, 8)}`);
      return info.length > 0 ? ` — ${info.join(", ")}` : "";
    }

    // Frontmatter
    if (data.frontmatter) {
      const keys = Object.keys(data.frontmatter);
      return ` — ${keys.length} fields`;
    }

    // Sections
    if (data.sections) {
      return ` — ${data.sections.length} sections`;
    }

    // Tags
    if (data.tags) {
      const count = Array.isArray(data.tags)
        ? data.tags.length
        : Object.keys(data.tags).length;
      return ` — ${count} tags`;
    }

    // Generic success with etag
    if (data.etag) {
      return ` — etag=${data.etag.slice(0, 8)}`;
    }

    return "";
  } catch {
    return "";
  }
}

function truncatePath(p: string): string {
  if (p.length <= 40) return p;
  return "…" + p.slice(-35);
}
