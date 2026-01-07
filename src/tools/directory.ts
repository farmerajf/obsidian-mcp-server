import {
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  statSync,
  rmdirSync,
  unlinkSync,
} from "fs";
import { join, dirname, basename } from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath, toVirtualPath } from "../utils/paths.js";

const TRASH_FOLDER = ".trash";

export async function createDirectory(
  path: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: Path already exists: ${path}` }],
        isError: true,
      };
    }

    mkdirSync(resolved.fullPath, { recursive: true });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              path,
              message: "Directory created",
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

export async function renameDirectory(
  path: string,
  newName: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: Directory does not exist: ${path}` }],
        isError: true,
      };
    }

    const stats = statSync(resolved.fullPath);
    if (!stats.isDirectory()) {
      return {
        content: [{ type: "text", text: `Error: ${path} is not a directory` }],
        isError: true,
      };
    }

    // Protect .obsidian
    if (path.includes(".obsidian")) {
      return {
        content: [{ type: "text", text: `Error: Cannot rename .obsidian directory` }],
        isError: true,
      };
    }

    const parentDir = dirname(resolved.fullPath);
    const newPath = join(parentDir, newName);

    if (existsSync(newPath)) {
      return {
        content: [{ type: "text", text: `Error: Destination already exists: ${newName}` }],
        isError: true,
      };
    }

    renameSync(resolved.fullPath, newPath);

    const newVirtualPath = toVirtualPath(newPath, resolved.basePath);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              oldPath: path,
              newPath: newVirtualPath,
              message: "Directory renamed",
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

export async function deleteDirectory(
  path: string,
  config: Config,
  recursive: boolean = false,
  confirm: boolean = false
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: Directory does not exist: ${path}` }],
        isError: true,
      };
    }

    const stats = statSync(resolved.fullPath);
    if (!stats.isDirectory()) {
      return {
        content: [{ type: "text", text: `Error: ${path} is not a directory` }],
        isError: true,
      };
    }

    // Protect .obsidian
    if (path.includes(".obsidian") || basename(resolved.fullPath) === ".obsidian") {
      return {
        content: [{ type: "text", text: `Error: Cannot delete .obsidian directory` }],
        isError: true,
      };
    }

    // Check if directory is empty
    const entries = readdirSync(resolved.fullPath);
    const isEmpty = entries.length === 0;

    if (!isEmpty && !recursive) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Directory is not empty. Set recursive to true to delete contents.`,
          },
        ],
        isError: true,
      };
    }

    if (recursive && !confirm) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Recursive delete requires confirm to be true. This will delete ${entries.length} items.`,
          },
        ],
        isError: true,
      };
    }

    if (recursive) {
      // Move directory to trash instead of permanent delete
      const trashPath = join(resolved.basePath, TRASH_FOLDER);
      if (!existsSync(trashPath)) {
        mkdirSync(trashPath, { recursive: true });
      }

      const dirName = basename(resolved.fullPath);
      const timestamp = Date.now();
      const trashedName = `${dirName}.${timestamp}`;
      const trashedFullPath = join(trashPath, trashedName);

      renameSync(resolved.fullPath, trashedFullPath);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                path,
                trashedTo: `/${TRASH_FOLDER}/${trashedName}`,
                itemsDeleted: entries.length,
                message: "Directory moved to trash",
              },
              null,
              2
            ),
          },
        ],
      };
    } else {
      // Empty directory - just delete
      rmdirSync(resolved.fullPath);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                path,
                message: "Empty directory deleted",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}

export async function getDirectoryInfo(
  path: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: Directory does not exist: ${path}` }],
        isError: true,
      };
    }

    const stats = statSync(resolved.fullPath);
    if (!stats.isDirectory()) {
      return {
        content: [{ type: "text", text: `Error: ${path} is not a directory` }],
        isError: true,
      };
    }

    const entries = readdirSync(resolved.fullPath, { withFileTypes: true });
    let fileCount = 0;
    let directoryCount = 0;
    let totalSize = 0;

    const children: Array<{ name: string; type: "file" | "directory" }> = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        directoryCount++;
        children.push({ name: entry.name, type: "directory" });
      } else {
        fileCount++;
        const entryPath = join(resolved.fullPath, entry.name);
        const entryStats = statSync(entryPath);
        totalSize += entryStats.size;
        children.push({ name: entry.name, type: "file" });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path,
              name: basename(resolved.fullPath),
              fileCount,
              directoryCount,
              totalSize,
              created: stats.birthtime.toISOString(),
              modified: stats.mtime.toISOString(),
              children,
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
