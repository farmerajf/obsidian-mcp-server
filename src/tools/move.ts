import { existsSync, renameSync, readFileSync, writeFileSync, statSync, copyFileSync, unlinkSync } from "fs";
import { dirname, basename, extname } from "path";
import { glob } from "glob";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath, toVirtualPath, getAllVaults } from "../utils/paths.js";

export async function moveFile(
  source: string,
  destination: string,
  config: Config,
  updateLinks: boolean = true,
  overwrite: boolean = false
): Promise<CallToolResult> {
  try {
    const sourceResolved = resolvePath(source, config);
    const destResolved = resolvePath(destination, config);

    if (!existsSync(sourceResolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: Source does not exist: ${source}` }],
        isError: true,
      };
    }

    // Protect .obsidian
    if (source.includes(".obsidian") || destination.includes(".obsidian")) {
      return {
        content: [{ type: "text", text: `Error: Cannot move files in/to .obsidian directory` }],
        isError: true,
      };
    }

    if (existsSync(destResolved.fullPath) && !overwrite) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Destination already exists: ${destination}. Set overwrite to true to replace.`,
          },
        ],
        isError: true,
      };
    }

    const stats = statSync(sourceResolved.fullPath);
    const isDirectory = stats.isDirectory();

    // Get old name for link updating
    const oldName = basename(sourceResolved.fullPath, extname(sourceResolved.fullPath));
    const newName = basename(destResolved.fullPath, extname(destResolved.fullPath));

    // Check if cross-vault move
    const isCrossVault = sourceResolved.vaultName !== destResolved.vaultName;

    // Perform the move
    if (isCrossVault) {
      // Cross-vault: copy then delete
      copyFileSync(sourceResolved.fullPath, destResolved.fullPath);
      unlinkSync(sourceResolved.fullPath);
    } else {
      // Same vault: simple rename
      renameSync(sourceResolved.fullPath, destResolved.fullPath);
    }

    let linksUpdated = 0;
    const filesUpdated: string[] = [];

    // Update wikilinks in other files
    if (updateLinks && !isDirectory) {
      const result = await updateWikilinks(
        oldName,
        source,
        newName,
        destination,
        config
      );
      linksUpdated = result.linksUpdated;
      filesUpdated.push(...result.filesUpdated);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              source,
              destination,
              type: isDirectory ? "directory" : "file",
              linksUpdated,
              filesUpdated: filesUpdated.length > 0 ? filesUpdated : undefined,
              message: `${isDirectory ? "Directory" : "File"} moved successfully`,
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

export async function renameFile(
  path: string,
  newName: string,
  config: Config,
  updateLinks: boolean = true
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (!existsSync(resolved.fullPath)) {
      return {
        content: [{ type: "text", text: `Error: File does not exist: ${path}` }],
        isError: true,
      };
    }

    // Construct new path in same directory
    const parentDir = dirname(path);
    const newPath = parentDir === "/" ? `/${newName}` : `${parentDir}/${newName}`;

    return moveFile(path, newPath, config, updateLinks, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}

async function updateWikilinks(
  oldName: string,
  oldPath: string,
  newName: string,
  newPath: string,
  config: Config
): Promise<{ linksUpdated: number; filesUpdated: string[] }> {
  let linksUpdated = 0;
  const filesUpdated: string[] = [];

  // Clean paths for matching (remove vault prefix and .md extension)
  const oldPathClean = oldPath.replace(/^\/[^/]+\//, "").replace(/\.md$/, "");
  const newPathClean = newPath.replace(/^\/[^/]+\//, "").replace(/\.md$/, "");

  // Find all markdown files
  for (const vault of getAllVaults(config)) {
    const files = await glob("**/*.md", {
      cwd: vault.basePath,
      absolute: true,
      ignore: ["**/node_modules/**", "**/.obsidian/**", "**/.trash/**"],
    });

    for (const filePath of files) {
      let content = readFileSync(filePath, "utf-8");
      let modified = false;

      // Match various wikilink formats:
      // [[Name]], [[Name|alias]], [[Name#heading]], [[path/Name]], [[path/Name|alias]]
      const patterns = [
        // Full path match
        new RegExp(`\\[\\[${escapeRegex(oldPathClean)}(\\|[^\\]]*)?\\]\\]`, "g"),
        new RegExp(`\\[\\[${escapeRegex(oldPathClean)}(#[^\\]|]*)(\\|[^\\]]*)?\\]\\]`, "g"),
        // Just name match (Obsidian often resolves by name only)
        new RegExp(`\\[\\[${escapeRegex(oldName)}(\\|[^\\]]*)?\\]\\]`, "g"),
        new RegExp(`\\[\\[${escapeRegex(oldName)}(#[^\\]|]*)(\\|[^\\]]*)?\\]\\]`, "g"),
      ];

      for (const pattern of patterns) {
        const matches = content.match(pattern);
        if (matches) {
          content = content.replace(pattern, (match) => {
            // Preserve alias and heading if present
            const aliasMatch = match.match(/\|([^\]]*)\]\]/);
            const headingMatch = match.match(/#([^|\]]*)/);

            let newLink = `[[${newPathClean}`;
            if (headingMatch) {
              newLink += `#${headingMatch[1]}`;
            }
            if (aliasMatch) {
              newLink += `|${aliasMatch[1]}`;
            }
            newLink += "]]";

            return newLink;
          });
          linksUpdated += matches.length;
          modified = true;
        }
      }

      if (modified) {
        writeFileSync(filePath, content, "utf-8");
        const virtualPath = toVirtualPath(filePath, vault.basePath, vault.name);
        filesUpdated.push(virtualPath);
      }
    }
  }

  return { linksUpdated, filesUpdated };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
