import { existsSync, unlinkSync, statSync, mkdirSync, renameSync, readdirSync, rmdirSync } from "fs";
import { dirname, basename, join } from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath, getAllVaults } from "../utils/paths.js";

const TRASH_FOLDER = ".trash";

export async function deleteFile(
  path: string,
  config: Config,
  permanent: boolean = false
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    // Check if file exists
    if (!existsSync(resolved.fullPath)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: File does not exist at ${path}`,
          },
        ],
        isError: true,
      };
    }

    // Ensure it's a file, not a directory
    const stats = statSync(resolved.fullPath);
    if (stats.isDirectory()) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${path} is a directory. Use delete_directory instead.`,
          },
        ],
        isError: true,
      };
    }

    // Protect .obsidian folder
    if (path.includes(".obsidian")) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Cannot delete files in .obsidian directory`,
          },
        ],
        isError: true,
      };
    }

    if (permanent) {
      // Permanent delete
      unlinkSync(resolved.fullPath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                path,
                permanent: true,
                message: "File permanently deleted",
              },
              null,
              2
            ),
          },
        ],
      };
    } else {
      // Soft delete - move to .trash
      const trashPath = join(resolved.basePath, TRASH_FOLDER);
      if (!existsSync(trashPath)) {
        mkdirSync(trashPath, { recursive: true });
      }

      // Generate unique trash filename
      const fileName = basename(resolved.fullPath);
      const timestamp = Date.now();
      const trashedName = `${fileName}.${timestamp}`;
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
                permanent: false,
                trashedTo: `/${resolved.vaultName}/${TRASH_FOLDER}/${trashedName}`,
                message: "File moved to trash",
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

export async function listTrash(config: Config): Promise<CallToolResult> {
  try {
    const items: Array<{
      path: string;
      originalName: string;
      trashedAt: string;
      size: number;
      vault: string;
    }> = [];

    let totalSize = 0;

    for (const vault of getAllVaults(config)) {
      const trashPath = join(vault.basePath, TRASH_FOLDER);
      if (!existsSync(trashPath)) continue;

      const entries = readdirSync(trashPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const fullPath = join(trashPath, entry.name);
          const stats = statSync(fullPath);

          // Parse timestamp from filename
          const match = entry.name.match(/\.(\d+)$/);
          const timestamp = match ? parseInt(match[1]) : stats.mtime.getTime();

          // Original name is everything before the timestamp
          const originalName = entry.name.replace(/\.\d+$/, "");

          items.push({
            path: `/${vault.name}/${TRASH_FOLDER}/${entry.name}`,
            originalName,
            trashedAt: new Date(timestamp).toISOString(),
            size: stats.size,
            vault: vault.name,
          });

          totalSize += stats.size;
        }
      }
    }

    // Sort by trashed date, newest first
    items.sort((a, b) => new Date(b.trashedAt).getTime() - new Date(a.trashedAt).getTime());

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              items,
              totalItems: items.length,
              totalSize,
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

export async function restoreFromTrash(
  trashPath: string,
  config: Config,
  restoreTo?: string,
  overwrite: boolean = false
): Promise<CallToolResult> {
  try {
    // Parse trash path to get vault and filename
    // Format: /{vaultName}/.trash/{filename}
    const resolved = resolvePath(trashPath, config);
    const trashedName = basename(trashPath);

    const sourceFullPath = join(resolved.basePath, TRASH_FOLDER, trashedName);
    if (!existsSync(sourceFullPath)) {
      return {
        content: [{ type: "text", text: `Error: File not found in trash: ${trashPath}` }],
        isError: true,
      };
    }

    // Determine restore path
    let destPath: string;
    let destVaultName: string;
    if (restoreTo) {
      const destResolved = resolvePath(restoreTo, config);
      destPath = destResolved.fullPath;
      destVaultName = destResolved.vaultName;
    } else {
      // Restore to vault root with original name
      const originalName = trashedName.replace(/\.\d+$/, "");
      destPath = join(resolved.basePath, originalName);
      destVaultName = resolved.vaultName;
    }

    // Check if destination exists
    if (existsSync(destPath) && !overwrite) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Destination already exists: ${restoreTo || basename(destPath)}. Set overwrite to true to replace.`,
          },
        ],
        isError: true,
      };
    }

    // Create parent directory if needed
    const destDir = dirname(destPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // Move file from trash
    renameSync(sourceFullPath, destPath);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              restoredFrom: trashPath,
              restoredTo: restoreTo || `/${destVaultName}/${basename(destPath)}`,
              message: "File restored from trash",
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

export async function emptyTrash(
  config: Config,
  confirm: boolean,
  olderThanDays?: number
): Promise<CallToolResult> {
  if (!confirm) {
    return {
      content: [{ type: "text", text: `Error: Must set confirm to true to empty trash` }],
      isError: true,
    };
  }

  try {
    let deletedCount = 0;
    let deletedSize = 0;
    const cutoffTime = olderThanDays ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000 : 0;

    for (const vault of getAllVaults(config)) {
      const trashPath = join(vault.basePath, TRASH_FOLDER);
      if (!existsSync(trashPath)) continue;

      const entries = readdirSync(trashPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(trashPath, entry.name);
        const stats = statSync(fullPath);

        // Check age if olderThanDays specified
        if (olderThanDays) {
          const match = entry.name.match(/\.(\d+)$/);
          const timestamp = match ? parseInt(match[1]) : stats.mtime.getTime();
          if (timestamp > cutoffTime) continue;
        }

        if (entry.isFile()) {
          deletedSize += stats.size;
          unlinkSync(fullPath);
          deletedCount++;
        } else if (entry.isDirectory()) {
          // Recursively delete directory
          deleteDirectoryRecursive(fullPath);
          deletedCount++;
        }
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              deletedCount,
              deletedSize,
              olderThanDays: olderThanDays || "all",
              message: `Permanently deleted ${deletedCount} items from trash`,
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

function deleteDirectoryRecursive(dirPath: string): void {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      deleteDirectoryRecursive(fullPath);
    } else {
      unlinkSync(fullPath);
    }
  }
  rmdirSync(dirPath);
}
