import { existsSync, readFileSync, writeFileSync } from "fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

export async function getFrontmatter(
  path: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: File does not exist: ${path}` }],
        isError: true,
      };
    }

    const content = readFileSync(resolved.fullPath, "utf-8");
    const etag = generateEtag(content);
    const match = content.match(FRONTMATTER_REGEX);

    if (!match) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                path,
                hasFrontmatter: false,
                frontmatter: null,
                raw: null,
                etag,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const raw = match[1];
    const frontmatter = parseYaml(raw);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path,
              hasFrontmatter: true,
              frontmatter,
              raw,
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

export async function updateFrontmatter(
  path: string,
  updates: Record<string, unknown>,
  config: Config,
  remove?: string[],
  expectedEtag?: string
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: File does not exist: ${path}` }],
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

    const match = content.match(FRONTMATTER_REGEX);
    let currentFm: Record<string, unknown> = {};
    let bodyStart = 0;

    if (match) {
      currentFm = parseYaml(match[1]);
      bodyStart = match[0].length;
    }

    // Apply updates
    const newFm = { ...currentFm, ...updates };

    // Remove specified keys
    if (remove) {
      for (const key of remove) {
        delete newFm[key];
      }
    }

    // Serialize frontmatter
    const newFmYaml = serializeYaml(newFm);
    const body = content.slice(bodyStart);
    const newContent = `---\n${newFmYaml}---\n${body}`;

    writeFileSync(resolved.fullPath, newContent, "utf-8");
    const newEtag = generateEtag(newContent);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              path,
              frontmatter: newFm,
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

// Simple YAML parser for frontmatter (handles common cases)
function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");

  let currentKey = "";
  let currentValue: unknown = null;
  let inArray = false;
  let arrayItems: unknown[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Array item (starts with -)
    if (trimmed.startsWith("- ") && inArray) {
      arrayItems.push(parseValue(trimmed.slice(2).trim()));
      continue;
    }

    // End of array
    if (inArray && !trimmed.startsWith("-") && !line.startsWith(" ")) {
      result[currentKey] = arrayItems;
      inArray = false;
      arrayItems = [];
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const valueStr = trimmed.slice(colonIdx + 1).trim();

      if (valueStr === "" || valueStr === "|" || valueStr === ">") {
        // Multiline or array starting on next line
        currentKey = key;
        continue;
      }

      if (valueStr.startsWith("[") && valueStr.endsWith("]")) {
        // Inline array
        const inner = valueStr.slice(1, -1);
        result[key] = inner
          .split(",")
          .map((s) => parseValue(s.trim()));
      } else {
        result[key] = parseValue(valueStr);
      }
    } else if (currentKey && trimmed.startsWith("-")) {
      // Array item
      inArray = true;
      arrayItems.push(parseValue(trimmed.slice(1).trim()));
    }
  }

  // Handle trailing array
  if (inArray && currentKey) {
    result[currentKey] = arrayItems;
  }

  return result;
}

function parseValue(value: string): unknown {
  // Remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Null
  if (value === "null" || value === "~") return null;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return parseFloat(value);
  }

  // Date (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value; // Keep as string for dates
  }

  return value;
}

// Simple YAML serializer
function serializeYaml(obj: Record<string, unknown>, indent = 0): string {
  const lines: string[] = [];
  const prefix = "  ".repeat(indent);

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      lines.push(`${prefix}${key}: null`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${prefix}${key}: []`);
      } else if (value.every((v) => typeof v === "string" || typeof v === "number")) {
        // Inline array for simple values
        const items = value.map((v) =>
          typeof v === "string" && (v.includes(",") || v.includes(":"))
            ? `"${v}"`
            : String(v)
        );
        lines.push(`${prefix}${key}: [${items.join(", ")}]`);
      } else {
        lines.push(`${prefix}${key}:`);
        for (const item of value) {
          if (typeof item === "object" && item !== null) {
            lines.push(`${prefix}  -`);
            lines.push(serializeYaml(item as Record<string, unknown>, indent + 2));
          } else {
            lines.push(`${prefix}  - ${serializeValue(item)}`);
          }
        }
      }
    } else if (typeof value === "object") {
      lines.push(`${prefix}${key}:`);
      lines.push(serializeYaml(value as Record<string, unknown>, indent + 1));
    } else {
      lines.push(`${prefix}${key}: ${serializeValue(value)}`);
    }
  }

  return lines.join("\n") + "\n";
}

function serializeValue(value: unknown): string {
  if (typeof value === "string") {
    if (value.includes(":") || value.includes("#") || value.includes("\n")) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return "null";
}
