import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";

// Core file operations
import { listDirectory } from "./list.js";
import { readFile } from "./read.js";
import { createFile } from "./create.js";
import { updateFile } from "./update.js";
import { deleteFile, listTrash, restoreFromTrash, emptyTrash } from "./delete.js";
import { searchFiles } from "./search.js";

// Phase 1: Performance & Core
import { appendFile, prependFile } from "./append.js";
import { patchFile } from "./patch.js";
import { readFilePartial, getFileMetadata } from "./metadata.js";
import {
  createDirectory,
  renameDirectory,
  deleteDirectory,
  getDirectoryInfo,
} from "./directory.js";
import { moveFile, renameFile } from "./move.js";

// Phase 2: Obsidian Intelligence
import { getFrontmatter, updateFrontmatter } from "./frontmatter.js";
import { resolveWikilink, extractWikilinks } from "./wikilinks.js";
import { getBacklinks } from "./backlinks.js";

// Phase 3: Search
import { searchByTag, listAllTags } from "./tags.js";
import { fuzzySearch } from "./fuzzy.js";
import { searchByDate } from "./dates.js";

// Phase 4-5: Batch operations
import { batchRead, batchWrite } from "./batch.js";

// Obsidian URLs
import { obsidianUrlToPath, pathToObsidianUrl } from "./obsidian-url.js";

export function registerTools(server: McpServer, config: Config): void {
  // ========================================
  // CORE FILE OPERATIONS
  // ========================================

  server.tool(
    "list_directory",
    "List contents of a directory. Use '/' to list root.",
    {
      path: z.string().describe("Directory path (e.g., '/' or '/notes')"),
    },
    async ({ path }) => listDirectory(path, config)
  );

  server.tool(
    "read_file",
    "Read contents of a file. Returns content and ETag for conflict detection.",
    {
      path: z.string().describe("File path (e.g., '/notes/todo.md')"),
    },
    async ({ path }) => readFile(path, config)
  );

  server.tool(
    "create_file",
    "Create a new file. Fails if file already exists.",
    {
      path: z.string().describe("File path"),
      content: z.string().describe("Content to write"),
    },
    async ({ path, content }) => createFile(path, content, config)
  );

  server.tool(
    "update_file",
    "Update an existing file. Use expectedEtag to prevent overwriting concurrent changes.",
    {
      path: z.string().describe("File path"),
      content: z.string().describe("New content"),
      expectedEtag: z.string().optional().describe("Expected ETag for conflict detection"),
    },
    async ({ path, content, expectedEtag }) =>
      updateFile(path, content, expectedEtag, config)
  );

  server.tool(
    "delete_file",
    "Delete a file. By default moves to .trash (soft delete).",
    {
      path: z.string().describe("File path"),
      permanent: z.boolean().default(false).describe("Skip trash and delete permanently"),
    },
    async ({ path, permanent }) => deleteFile(path, config, permanent)
  );

  server.tool(
    "search",
    "Search for files by content or filename",
    {
      query: z.string().describe("Search query (regex supported)"),
      path: z.string().optional().describe("Limit search to directory"),
      type: z.enum(["content", "filename"]).default("content"),
    },
    async ({ query, path, type }) => searchFiles(query, path, type, config)
  );

  // ========================================
  // APPEND & PREPEND
  // ========================================

  server.tool(
    "append_file",
    "Append content to end of file. Great for daily notes and logs.",
    {
      path: z.string().describe("File path"),
      content: z.string().describe("Content to append"),
      createIfMissing: z.boolean().default(false).describe("Create file if doesn't exist"),
      ensureNewline: z.boolean().default(true).describe("Ensure content starts on new line"),
      separator: z.string().optional().describe("Custom separator before content"),
    },
    async ({ path, content, createIfMissing, ensureNewline, separator }) =>
      appendFile(path, content, config, { createIfMissing, ensureNewline, separator })
  );

  server.tool(
    "prepend_file",
    "Insert content at beginning of file (after frontmatter if present).",
    {
      path: z.string().describe("File path"),
      content: z.string().describe("Content to prepend"),
      afterFrontmatter: z.boolean().default(true).describe("Insert after YAML frontmatter"),
      createIfMissing: z.boolean().default(false).describe("Create file if doesn't exist"),
      ensureNewline: z.boolean().default(true).describe("Ensure content ends with newline"),
    },
    async ({ path, content, afterFrontmatter, createIfMissing, ensureNewline }) =>
      prependFile(path, content, config, { afterFrontmatter, createIfMissing, ensureNewline })
  );

  // ========================================
  // PERFORMANCE: PATCH & PARTIAL READ
  // ========================================

  server.tool(
    "patch_file",
    "Apply surgical edits without sending entire file content.",
    {
      path: z.string().describe("File path"),
      patches: z.array(
        z.object({
          type: z.enum([
            "replace_lines",
            "insert_after",
            "delete_lines",
            "replace_first",
            "replace_all",
            "replace_regex",
          ]),
          startLine: z.number().optional(),
          endLine: z.number().optional(),
          line: z.number().optional(),
          content: z.string().optional(),
          search: z.string().optional(),
          replace: z.string().optional(),
          pattern: z.string().optional(),
          flags: z.string().optional(),
        })
      ),
      expectedEtag: z.string().optional(),
    },
    async ({ path, patches, expectedEtag }) => patchFile(path, patches, config, expectedEtag)
  );

  server.tool(
    "read_file_partial",
    "Read only a portion of a file by lines or bytes.",
    {
      path: z.string().describe("File path"),
      mode: z.enum(["lines", "bytes"]),
      start: z.number().describe("Start line (1-indexed) or byte offset"),
      end: z.number().optional().describe("End line or byte offset"),
      includeMeta: z.boolean().default(true).describe("Include total size/lines"),
    },
    async ({ path, mode, start, end, includeMeta }) =>
      readFilePartial(path, config, { mode, start, end, includeMeta })
  );

  server.tool(
    "get_file_metadata",
    "Get file info without reading content: size, dates, tags, link count.",
    {
      path: z.string().describe("File path"),
    },
    async ({ path }) => getFileMetadata(path, config)
  );

  // ========================================
  // TRASH MANAGEMENT
  // ========================================

  server.tool(
    "list_trash",
    "List contents of .trash folder.",
    {},
    async () => listTrash(config)
  );

  server.tool(
    "restore_from_trash",
    "Restore a file from .trash.",
    {
      trashPath: z.string().describe("Path within .trash"),
      restoreTo: z.string().optional().describe("Target path (defaults to original)"),
      overwrite: z.boolean().default(false),
    },
    async ({ trashPath, restoreTo, overwrite }) =>
      restoreFromTrash(trashPath, config, restoreTo, overwrite)
  );

  server.tool(
    "empty_trash",
    "Permanently delete items from .trash.",
    {
      olderThan: z.number().optional().describe("Only items older than N days"),
      confirm: z.boolean().describe("Must be true to proceed"),
    },
    async ({ olderThan, confirm }) => emptyTrash(config, confirm, olderThan)
  );

  // ========================================
  // DIRECTORY MANAGEMENT
  // ========================================

  server.tool(
    "create_directory",
    "Create a new directory (including nested paths).",
    {
      path: z.string().describe("Directory path"),
    },
    async ({ path }) => createDirectory(path, config)
  );

  server.tool(
    "rename_directory",
    "Rename a directory.",
    {
      path: z.string().describe("Current path"),
      newName: z.string().describe("New name (not full path)"),
    },
    async ({ path, newName }) => renameDirectory(path, newName, config)
  );

  server.tool(
    "delete_directory",
    "Delete a directory. Protected: never deletes .obsidian.",
    {
      path: z.string().describe("Directory path"),
      recursive: z.boolean().default(false).describe("Delete contents"),
      confirm: z.boolean().default(false).describe("Required if recursive"),
    },
    async ({ path, recursive, confirm }) => deleteDirectory(path, config, recursive, confirm)
  );

  server.tool(
    "get_directory_info",
    "Get directory info: file count, size, children.",
    {
      path: z.string().describe("Directory path"),
    },
    async ({ path }) => getDirectoryInfo(path, config)
  );

  // ========================================
  // MOVE & RENAME (with link updates)
  // ========================================

  server.tool(
    "move",
    "Move file/directory with automatic wikilink updates.",
    {
      source: z.string().describe("Source path"),
      destination: z.string().describe("Destination path"),
      updateLinks: z.boolean().default(true).describe("Update wikilinks in vault"),
      overwrite: z.boolean().default(false),
    },
    async ({ source, destination, updateLinks, overwrite }) =>
      moveFile(source, destination, config, updateLinks, overwrite)
  );

  server.tool(
    "rename",
    "Rename file in place with automatic wikilink updates.",
    {
      path: z.string().describe("Current path"),
      newName: z.string().describe("New filename"),
      updateLinks: z.boolean().default(true),
    },
    async ({ path, newName, updateLinks }) => renameFile(path, newName, config, updateLinks)
  );

  // ========================================
  // FRONTMATTER
  // ========================================

  server.tool(
    "get_frontmatter",
    "Extract YAML frontmatter as JSON.",
    {
      path: z.string().describe("Markdown file path"),
    },
    async ({ path }) => getFrontmatter(path, config)
  );

  server.tool(
    "update_frontmatter",
    "Update frontmatter fields. Uses merge semantics.",
    {
      path: z.string().describe("Markdown file path"),
      updates: z.record(z.string(), z.unknown()).describe("Key-value pairs to update"),
      remove: z.array(z.string()).optional().describe("Keys to remove"),
      expectedEtag: z.string().optional(),
    },
    async ({ path, updates, remove, expectedEtag }) =>
      updateFrontmatter(path, updates, config, remove, expectedEtag)
  );

  // ========================================
  // WIKILINKS
  // ========================================

  server.tool(
    "resolve_wikilink",
    "Resolve a wikilink to its target file path.",
    {
      link: z.string().describe("Wikilink (with or without [[]])"),
      sourcePath: z.string().optional().describe("File containing the link"),
    },
    async ({ link, sourcePath }) => resolveWikilink(link, config, sourcePath)
  );

  server.tool(
    "extract_wikilinks",
    "Extract all wikilinks from a file.",
    {
      path: z.string().describe("File path"),
      resolve: z.boolean().default(true).describe("Resolve each link"),
      includeEmbeds: z.boolean().default(true).describe("Include ![[embeds]]"),
    },
    async ({ path, resolve, includeEmbeds }) =>
      extractWikilinks(path, config, resolve, includeEmbeds)
  );

  // ========================================
  // BACKLINKS
  // ========================================

  server.tool(
    "get_backlinks",
    "Find all files that link to specified file.",
    {
      path: z.string().describe("Target file path"),
      includeContext: z.boolean().default(false).describe("Include surrounding text"),
      contextLines: z.number().default(1).describe("Lines of context"),
    },
    async ({ path, includeContext, contextLines }) =>
      getBacklinks(path, config, includeContext, contextLines)
  );

  // ========================================
  // TAGS
  // ========================================

  server.tool(
    "search_by_tag",
    "Find files with specified tags.",
    {
      tags: z.array(z.string()).describe("Tags to search (without #)"),
      match: z.enum(["any", "all"]).default("any"),
      path: z.string().optional().describe("Limit to directory"),
      location: z.enum(["frontmatter", "body", "both"]).default("both"),
    },
    async ({ tags, match, path, location }) =>
      searchByTag(tags, config, match, path, location)
  );

  server.tool(
    "list_all_tags",
    "Get all tags in vault with usage counts.",
    {
      path: z.string().optional().describe("Limit to directory"),
      minCount: z.number().default(1).describe("Minimum usage count"),
    },
    async ({ path, minCount }) => listAllTags(config, path, minCount)
  );

  // ========================================
  // FUZZY SEARCH
  // ========================================

  server.tool(
    "fuzzy_search",
    "Fuzzy filename search with typo tolerance.",
    {
      query: z.string().describe("Search query"),
      path: z.string().optional().describe("Limit to directory"),
      maxResults: z.number().default(20),
      threshold: z.number().default(0.4).describe("Match threshold 0-1"),
      includeDirectories: z.boolean().default(false),
    },
    async ({ query, path, maxResults, threshold, includeDirectories }) =>
      fuzzySearch(query, config, path, maxResults, threshold, includeDirectories)
  );

  // ========================================
  // DATE-BASED QUERIES
  // ========================================

  server.tool(
    "search_by_date",
    "Find files by creation/modification date or frontmatter date field.",
    {
      dateField: z.string().describe("'created', 'modified', or frontmatter field name"),
      condition: z.union([
        z.object({ relative: z.string() }),
        z.object({ after: z.string() }),
        z.object({ before: z.string() }),
        z.object({ between: z.tuple([z.string(), z.string()]) }),
        z.object({ equals: z.string() }),
      ]),
      path: z.string().optional(),
      sortBy: z.enum(["date", "name"]).default("date"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
      maxResults: z.number().default(50),
    },
    async ({ dateField, condition, path, sortBy, sortOrder, maxResults }) =>
      searchByDate(dateField, condition, config, path, sortBy, sortOrder, maxResults)
  );

  // ========================================
  // BATCH OPERATIONS
  // ========================================

  server.tool(
    "batch_read",
    "Read multiple files in a single request.",
    {
      paths: z.array(z.string()).describe("Array of file paths"),
      includeMetadata: z.boolean().default(false),
      failFast: z.boolean().default(false).describe("Stop on first error"),
    },
    async ({ paths, includeMetadata, failFast }) =>
      batchRead(paths, config, includeMetadata, failFast)
  );

  server.tool(
    "batch_write",
    "Write/update multiple files atomically.",
    {
      operations: z.array(
        z.union([
          z.object({ type: z.literal("create"), path: z.string(), content: z.string() }),
          z.object({
            type: z.literal("update"),
            path: z.string(),
            content: z.string(),
            expectedEtag: z.string().optional(),
          }),
          z.object({ type: z.literal("append"), path: z.string(), content: z.string() }),
          z.object({ type: z.literal("delete"), path: z.string() }),
        ])
      ),
      atomic: z.boolean().default(true).describe("All-or-nothing"),
    },
    async ({ operations, atomic }) => batchWrite(operations, config, atomic)
  );

  // ========================================
  // OBSIDIAN URLS
  // ========================================

  server.tool(
    "obsidian_url_to_path",
    "Convert an Obsidian URL (obsidian://open?vault=...&file=...) to a vault file path.",
    {
      url: z
        .string()
        .describe(
          "Obsidian URL (e.g., obsidian://open?vault=personal&file=notes/todo)"
        ),
    },
    async ({ url }) => obsidianUrlToPath(url, config)
  );

  server.tool(
    "path_to_obsidian_url",
    "Convert a vault file path to an Obsidian URL for deep-linking.",
    {
      path: z
        .string()
        .describe("File path (e.g., /personal/notes/todo.md)"),
    },
    async ({ path }) => pathToObsidianUrl(path, config)
  );
}
