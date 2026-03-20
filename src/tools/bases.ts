import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname, basename, extname } from "path";
import yaml from "js-yaml";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { getAllVaults, toVirtualPath } from "../utils/paths.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";

// --- Helpers ---

interface BaseConfig {
  filters?: unknown;
  formulas?: Record<string, string>;
  properties?: Record<string, { displayName?: string }>;
  views?: BaseView[];
}

interface BaseView {
  type?: string;
  name?: string;
  filters?: unknown;
  order?: string[];
  sort?: Array<{ property: string; direction?: string }>;
  groupBy?: { property: string; direction?: string };
  limit?: number;
  [key: string]: unknown;
}

/**
 * Extract the folder path from a base's filters.
 * Recursively walks the filter tree looking for file.inFolder("...").
 */
function extractFolder(filters: unknown): string | null {
  if (!filters) return null;

  if (typeof filters === "string") {
    const match = filters.match(/file\.inFolder\(["']([^"']+)["']\)/);
    return match ? match[1] : null;
  }

  if (Array.isArray(filters)) {
    for (const item of filters) {
      const result = extractFolder(item);
      if (result) return result;
    }
    return null;
  }

  if (typeof filters === "object" && filters !== null) {
    for (const value of Object.values(filters)) {
      const result = extractFolder(value);
      if (result) return result;
    }
    return null;
  }

  return null;
}

/**
 * Parse a .base file's YAML content.
 */
function parseBaseFile(content: string): BaseConfig {
  const parsed = yaml.load(content);
  if (!parsed || typeof parsed !== "object") return {};
  return parsed as BaseConfig;
}

/**
 * Get all .md files in a folder (non-recursive for now, matching Bases behavior).
 */
function getItemFiles(folderPath: string): string[] {
  if (!existsSync(folderPath)) return [];

  try {
    return readdirSync(folderPath)
      .filter(f => f.endsWith(".md"))
      .map(f => join(folderPath, f))
      .filter(f => statSync(f).isFile());
  } catch {
    return [];
  }
}

/**
 * Extract frontmatter from a markdown file.
 */
function extractFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  try {
    const parsed = yaml.load(match[1]);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Infer the type of a value for property introspection.
 */
function inferType(value: unknown): string {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "list";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return "datetime";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
    return "text";
  }
  if (typeof value === "object") return "object";
  return "text";
}

/**
 * Find all .base files across all vaults.
 */
function findAllBaseFiles(config: Config): Array<{
  virtualPath: string;
  fullPath: string;
  vaultName: string;
  basePath: string;
}> {
  const results: Array<{
    virtualPath: string;
    fullPath: string;
    vaultName: string;
    basePath: string;
  }> = [];

  for (const vault of getAllVaults(config)) {
    const walk = (dir: string): void => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            // Skip hidden directories
            if (!entry.name.startsWith(".")) {
              walk(fullPath);
            }
          } else if (entry.name.endsWith(".base")) {
            results.push({
              virtualPath: toVirtualPath(fullPath, vault.basePath, vault.name),
              fullPath,
              vaultName: vault.name,
              basePath: vault.basePath,
            });
          }
        }
      } catch {
        // Skip unreadable directories
      }
    };

    walk(vault.basePath);
  }

  return results;
}

// --- Tool implementations ---

export async function listBases(config: Config): Promise<CallToolResult> {
  try {
    const baseFiles = findAllBaseFiles(config);
    const bases: Array<Record<string, unknown>> = [];

    for (const bf of baseFiles) {
      const content = readFileSync(bf.fullPath, "utf-8");
      const parsed = parseBaseFile(content);
      const folder = extractFolder(parsed.filters);

      let itemCount = 0;
      if (folder) {
        const folderFullPath = join(bf.basePath, folder);
        itemCount = getItemFiles(folderFullPath).length;
      }

      const viewNames = (parsed.views || []).map(v => v.name || "Untitled");
      const properties = parsed.properties
        ? Object.entries(parsed.properties).map(([key, val]) => ({
            key,
            displayName: val?.displayName || key,
          }))
        : [];

      bases.push({
        path: bf.virtualPath,
        name: basename(bf.fullPath, ".base"),
        vault: bf.vaultName,
        folder: folder || null,
        itemCount,
        views: viewNames,
        properties,
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ bases, count: bases.length }, null, 2),
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

export async function queryBase(
  path: string,
  config: Config,
  viewName?: string
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: Base file does not exist at ${path}` }],
        isError: true,
      };
    }

    const content = readFileSync(resolved.fullPath, "utf-8");
    const parsed = parseBaseFile(content);
    const folder = extractFolder(parsed.filters);

    if (!folder) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "Could not determine data folder from base filters",
                path,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const folderFullPath = join(resolved.basePath, folder);
    const itemFiles = getItemFiles(folderFullPath);

    // Collect items
    const items: Array<Record<string, unknown>> = [];
    for (const filePath of itemFiles) {
      const fileContent = readFileSync(filePath, "utf-8");
      const frontmatter = extractFrontmatter(fileContent);
      const fileName = basename(filePath, ".md");
      const virtualPath = toVirtualPath(filePath, resolved.basePath, resolved.vaultName);

      items.push({
        path: virtualPath,
        name: fileName,
        ...frontmatter,
      });
    }

    // Determine which view to use for sorting/ordering
    let activeView: BaseView | undefined;
    if (viewName && parsed.views) {
      activeView = parsed.views.find(
        v => v.name?.toLowerCase() === viewName.toLowerCase()
      );
    }
    if (!activeView && parsed.views?.length) {
      activeView = parsed.views[0];
    }

    // Apply sorting if view defines it
    if (activeView?.sort?.length) {
      items.sort((a, b) => {
        for (const rule of activeView!.sort!) {
          const prop = rule.property === "file.name" ? "name" : rule.property;
          const aVal = a[prop];
          const bVal = b[prop];

          if (aVal === bVal) continue;
          if (aVal === undefined || aVal === null) return 1;
          if (bVal === undefined || bVal === null) return -1;

          const cmp = String(aVal).localeCompare(String(bVal));
          if (cmp !== 0) {
            return rule.direction === "DESC" ? -cmp : cmp;
          }
        }
        return 0;
      });
    }

    // Determine columns from view order
    const columns = activeView?.order || null;

    // Property display names
    const displayNames: Record<string, string> = {};
    if (parsed.properties) {
      for (const [key, val] of Object.entries(parsed.properties)) {
        if (val?.displayName) {
          // Normalize: "note.Status" → "Status", "file.name" stays
          const cleanKey = key.startsWith("note.") ? key.slice(5) : key;
          displayNames[cleanKey] = val.displayName;
        }
      }
    }

    const result: Record<string, unknown> = {
      base: basename(resolved.fullPath, ".base"),
      path,
      folder: `/${resolved.vaultName}/${folder}`,
      itemCount: items.length,
      items,
    };

    if (activeView) {
      result.view = activeView.name || "Untitled";
    }
    if (columns) {
      result.columns = columns;
    }
    if (Object.keys(displayNames).length > 0) {
      result.displayNames = displayNames;
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

export async function createBaseItem(
  basePath: string,
  itemName: string,
  properties: Record<string, unknown>,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(basePath, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: Base file does not exist at ${basePath}` }],
        isError: true,
      };
    }

    const content = readFileSync(resolved.fullPath, "utf-8");
    const parsed = parseBaseFile(content);
    const folder = extractFolder(parsed.filters);

    if (!folder) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "Could not determine data folder from base filters",
                path: basePath,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const folderFullPath = join(resolved.basePath, folder);

    // Create folder if it doesn't exist
    if (!existsSync(folderFullPath)) {
      mkdirSync(folderFullPath, { recursive: true });
    }

    const fileName = itemName.endsWith(".md") ? itemName : `${itemName}.md`;
    const filePath = join(folderFullPath, fileName);

    if (existsSync(filePath)) {
      const virtualPath = toVirtualPath(filePath, resolved.basePath, resolved.vaultName);
      return {
        content: [
          {
            type: "text",
            text: `Error: Item already exists at ${virtualPath}`,
          },
        ],
        isError: true,
      };
    }

    // Build frontmatter
    let fileContent = "";
    if (Object.keys(properties).length > 0) {
      fileContent = "---\n" + yaml.dump(properties, { lineWidth: -1 }).trimEnd() + "\n---\n";
    }

    writeFileSync(filePath, fileContent, "utf-8");
    const etag = generateEtag(fileContent);
    const virtualPath = toVirtualPath(filePath, resolved.basePath, resolved.vaultName);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              path: virtualPath,
              base: basename(resolved.fullPath, ".base"),
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

export async function getBaseSchema(
  path: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: Base file does not exist at ${path}` }],
        isError: true,
      };
    }

    const content = readFileSync(resolved.fullPath, "utf-8");
    const parsed = parseBaseFile(content);
    const folder = extractFolder(parsed.filters);

    if (!folder) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "Could not determine data folder from base filters",
                path,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const folderFullPath = join(resolved.basePath, folder);
    const itemFiles = getItemFiles(folderFullPath);

    // Analyze all items to infer property schema
    const propertyStats: Record<
      string,
      { types: Set<string>; examples: unknown[]; count: number }
    > = {};

    for (const filePath of itemFiles) {
      const fileContent = readFileSync(filePath, "utf-8");
      const frontmatter = extractFrontmatter(fileContent);

      for (const [key, value] of Object.entries(frontmatter)) {
        if (!propertyStats[key]) {
          propertyStats[key] = { types: new Set(), examples: [], count: 0 };
        }
        const stat = propertyStats[key];
        stat.types.add(inferType(value));
        stat.count++;
        if (stat.examples.length < 3 && value !== null && value !== undefined) {
          stat.examples.push(value);
        }
      }
    }

    // Build schema
    const schema: Array<Record<string, unknown>> = [];
    for (const [key, stat] of Object.entries(propertyStats)) {
      const types = Array.from(stat.types).filter(t => t !== "unknown");
      const entry: Record<string, unknown> = {
        property: key,
        type: types.length === 1 ? types[0] : types.length > 0 ? types : "unknown",
        usedIn: `${stat.count}/${itemFiles.length} items`,
        examples: stat.examples,
      };

      // Add display name if configured
      const displayKey = `note.${key}`;
      if (parsed.properties?.[key]?.displayName) {
        entry.displayName = parsed.properties[key].displayName;
      } else if (parsed.properties?.[displayKey]?.displayName) {
        entry.displayName = parsed.properties[displayKey].displayName;
      }

      schema.push(entry);
    }

    // Determine columns from views
    const viewColumns: Record<string, string[]> = {};
    if (parsed.views) {
      for (const view of parsed.views) {
        if (view.name && view.order) {
          viewColumns[view.name] = view.order;
        }
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              base: basename(resolved.fullPath, ".base"),
              path,
              folder: `/${resolved.vaultName}/${folder}`,
              itemCount: itemFiles.length,
              properties: schema,
              viewColumns,
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
