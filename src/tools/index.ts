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

// Binary file operations
import { createBinaryFile, attachToNote } from "./binary.js";

// Bases (database views)
import { listBases, queryBase, createBaseItem, getBaseSchema } from "./bases.js";

// Section-aware reading
import { getSections, readSection } from "./sections.js";

// Obsidian URLs
import { obsidianUrlToPath, pathToObsidianUrl } from "./obsidian-url.js";

// URL resolution utility
import { resolvePathOrUrl } from "../utils/resolve-url.js";

const urlParam = z
  .string()
  .optional()
  .describe("Obsidian URL (obsidian://open?vault=...&file=...) — alternative to path");

export function registerTools(server: McpServer, config: Config): void {
  // ========================================
  // CORE FILE OPERATIONS
  // ========================================

  server.tool(
    "list_directory",
    "List contents of a directory. Use '/' to list root.",
    {
      path: z.string().optional().describe("Directory path (e.g., '/' or '/notes')"),
      url: urlParam,
    },
    async ({ path, url }) => listDirectory(resolvePathOrUrl(path, url, config), config)
  );

  server.tool(
    "read_file",
    "Read contents of a file. For text files, returns content and ETag (truncated at 500 lines — use get_sections + read_section for large files). For image files (png, jpg, gif, webp, svg, bmp), returns a viewable image block. For audio files (mp3, wav, ogg, flac, m4a), returns an audio block. For PDF files, returns the document as a readable resource.",
    {
      path: z.string().optional().describe("File path (e.g., '/notes/todo.md')"),
      url: urlParam,
    },
    async ({ path, url }) => readFile(resolvePathOrUrl(path, url, config), config)
  );

  server.tool(
    "create_file",
    "Create a new file. Fails if file already exists. Do not use for Base items — if the target path is inside a Base items/ folder, use create_base_item instead (it resolves the correct folder from the .base file automatically).",
    {
      path: z.string().optional().describe("File path"),
      url: urlParam,
      content: z.string().describe("Content to write"),
    },
    async ({ path, url, content }) => createFile(resolvePathOrUrl(path, url, config), content, config)
  );

  server.tool(
    "update_file",
    "Update an existing file. Use expectedEtag to prevent overwriting concurrent changes.",
    {
      path: z.string().optional().describe("File path"),
      url: urlParam,
      content: z.string().describe("New content"),
      expectedEtag: z.string().optional().describe("Expected ETag for conflict detection"),
    },
    async ({ path, url, content, expectedEtag }) =>
      updateFile(resolvePathOrUrl(path, url, config), content, expectedEtag, config)
  );

  server.tool(
    "delete_file",
    "Delete a file. By default moves to .trash (soft delete).",
    {
      path: z.string().optional().describe("File path"),
      url: urlParam,
      permanent: z.boolean().default(false).describe("Skip trash and delete permanently"),
    },
    async ({ path, url, permanent }) => deleteFile(resolvePathOrUrl(path, url, config), config, permanent)
  );

  server.tool(
    "search",
    "Search for files by content or filename",
    {
      query: z.string().describe("Search query (regex supported)"),
      path: z.string().optional().describe("Limit search to directory"),
      url: urlParam.describe("Obsidian URL to limit search to directory — alternative to path"),
      type: z.enum(["content", "filename"]).default("content"),
    },
    async ({ query, path, url, type }) => searchFiles(query, path || (url ? resolvePathOrUrl(undefined, url, config) : undefined), type, config)
  );

  // ========================================
  // APPEND & PREPEND
  // ========================================

  server.tool(
    "append_file",
    "Append content to end of file. Great for daily notes and logs.",
    {
      path: z.string().optional().describe("File path"),
      url: urlParam,
      content: z.string().describe("Content to append"),
      createIfMissing: z.boolean().default(false).describe("Create file if doesn't exist"),
      ensureNewline: z.boolean().default(true).describe("Ensure content starts on new line"),
      separator: z.string().optional().describe("Custom separator before content"),
    },
    async ({ path, url, content, createIfMissing, ensureNewline, separator }) =>
      appendFile(resolvePathOrUrl(path, url, config), content, config, { createIfMissing, ensureNewline, separator })
  );

  server.tool(
    "prepend_file",
    "Insert content at beginning of file (after frontmatter if present).",
    {
      path: z.string().optional().describe("File path"),
      url: urlParam,
      content: z.string().describe("Content to prepend"),
      afterFrontmatter: z.boolean().default(true).describe("Insert after YAML frontmatter"),
      createIfMissing: z.boolean().default(false).describe("Create file if doesn't exist"),
      ensureNewline: z.boolean().default(true).describe("Ensure content ends with newline"),
    },
    async ({ path, url, content, afterFrontmatter, createIfMissing, ensureNewline }) =>
      prependFile(resolvePathOrUrl(path, url, config), content, config, { afterFrontmatter, createIfMissing, ensureNewline })
  );

  // ========================================
  // PERFORMANCE: PATCH & PARTIAL READ
  // ========================================

  server.tool(
    "patch_file",
    "Apply surgical edits without sending entire file content. For appending content to end of file, prefer append_file. For replacing large sections or rewriting most of a file, prefer update_file. Use patch_file for small, targeted edits where the line number or search string is known. insert_after accepts either a 'line' number or a 'search' string to locate the insertion point. Line-number patches (replace_lines, delete_lines, insert_after with line) use the original file's line numbers even when batching multiple patches.",
    {
      path: z.string().optional().describe("File path"),
      url: urlParam,
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
          expectedContent: z.string().optional().describe("For replace_lines: verify target lines contain this string before replacing. Rejects patch with error on mismatch."),
        })
      ),
      expectedEtag: z.string().optional(),
    },
    async ({ path, url, patches, expectedEtag }) => patchFile(resolvePathOrUrl(path, url, config), patches, config, expectedEtag)
  );

  server.tool(
    "read_file_partial",
    "Read only a portion of a text file by lines or bytes. Not supported for binary media files.",
    {
      path: z.string().optional().describe("File path"),
      url: urlParam,
      mode: z.enum(["lines", "bytes"]),
      start: z.number().describe("Start line (1-indexed) or byte offset"),
      end: z.number().optional().describe("End line or byte offset"),
      includeMeta: z.boolean().default(true).describe("Include total size/lines"),
    },
    async ({ path, url, mode, start, end, includeMeta }) =>
      readFilePartial(resolvePathOrUrl(path, url, config), config, { mode, start, end, includeMeta })
  );

  server.tool(
    "get_file_metadata",
    "Get file info without reading content: size, dates, tags, link count. Works for all file types including images and other media.",
    {
      path: z.string().optional().describe("File path"),
      url: urlParam,
    },
    async ({ path, url }) => getFileMetadata(resolvePathOrUrl(path, url, config), config)
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
      path: z.string().optional().describe("Directory path"),
      url: urlParam,
    },
    async ({ path, url }) => createDirectory(resolvePathOrUrl(path, url, config), config)
  );

  server.tool(
    "rename_directory",
    "Rename a directory.",
    {
      path: z.string().optional().describe("Current path"),
      url: urlParam,
      newName: z.string().describe("New name (not full path)"),
    },
    async ({ path, url, newName }) => renameDirectory(resolvePathOrUrl(path, url, config), newName, config)
  );

  server.tool(
    "delete_directory",
    "Delete a directory. Protected: never deletes .obsidian.",
    {
      path: z.string().optional().describe("Directory path"),
      url: urlParam,
      recursive: z.boolean().default(false).describe("Delete contents"),
      confirm: z.boolean().default(false).describe("Required if recursive"),
    },
    async ({ path, url, recursive, confirm }) => deleteDirectory(resolvePathOrUrl(path, url, config), config, recursive, confirm)
  );

  server.tool(
    "get_directory_info",
    "Get directory info: file count, size, children.",
    {
      path: z.string().optional().describe("Directory path"),
      url: urlParam,
    },
    async ({ path, url }) => getDirectoryInfo(resolvePathOrUrl(path, url, config), config)
  );

  // ========================================
  // MOVE & RENAME (with link updates)
  // ========================================

  server.tool(
    "move",
    "Move file/directory with automatic wikilink updates.",
    {
      source: z.string().optional().describe("Source path"),
      sourceUrl: z.string().optional().describe("Source as Obsidian URL — alternative to source"),
      destination: z.string().optional().describe("Destination path"),
      destinationUrl: z.string().optional().describe("Destination as Obsidian URL — alternative to destination"),
      updateLinks: z.boolean().default(true).describe("Update wikilinks in vault"),
      overwrite: z.boolean().default(false),
    },
    async ({ source, sourceUrl, destination, destinationUrl, updateLinks, overwrite }) =>
      moveFile(
        resolvePathOrUrl(source, sourceUrl, config),
        resolvePathOrUrl(destination, destinationUrl, config),
        config,
        updateLinks,
        overwrite
      )
  );

  server.tool(
    "rename",
    "Rename file in place with automatic wikilink updates.",
    {
      path: z.string().optional().describe("Current path"),
      url: urlParam,
      newName: z.string().describe("New filename"),
      updateLinks: z.boolean().default(true),
    },
    async ({ path, url, newName, updateLinks }) => renameFile(resolvePathOrUrl(path, url, config), newName, config, updateLinks)
  );

  // ========================================
  // FRONTMATTER
  // ========================================

  server.tool(
    "get_frontmatter",
    "Extract YAML frontmatter as JSON.",
    {
      path: z.string().optional().describe("Markdown file path"),
      url: urlParam,
    },
    async ({ path, url }) => getFrontmatter(resolvePathOrUrl(path, url, config), config)
  );

  server.tool(
    "update_frontmatter",
    "Update frontmatter fields. Uses merge semantics.",
    {
      path: z.string().optional().describe("Markdown file path"),
      url: urlParam,
      updates: z.record(z.string(), z.unknown()).describe("Key-value pairs to update"),
      remove: z.array(z.string()).optional().describe("Keys to remove"),
      expectedEtag: z.string().optional(),
    },
    async ({ path, url, updates, remove, expectedEtag }) =>
      updateFrontmatter(resolvePathOrUrl(path, url, config), updates, config, remove, expectedEtag)
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
      path: z.string().optional().describe("File path"),
      url: urlParam,
      resolve: z.boolean().default(true).describe("Resolve each link"),
      includeEmbeds: z.boolean().default(true).describe("Include ![[embeds]]"),
    },
    async ({ path, url, resolve, includeEmbeds }) =>
      extractWikilinks(resolvePathOrUrl(path, url, config), config, resolve, includeEmbeds)
  );

  // ========================================
  // BACKLINKS
  // ========================================

  server.tool(
    "get_backlinks",
    "Find all files that link to specified file.",
    {
      path: z.string().optional().describe("Target file path"),
      url: urlParam,
      includeContext: z.boolean().default(false).describe("Include surrounding text"),
      contextLines: z.number().default(1).describe("Lines of context"),
    },
    async ({ path, url, includeContext, contextLines }) =>
      getBacklinks(resolvePathOrUrl(path, url, config), config, includeContext, contextLines)
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
      url: urlParam.describe("Obsidian URL to limit search to directory — alternative to path"),
      location: z.enum(["frontmatter", "body", "both"]).default("both"),
    },
    async ({ tags, match, path, url, location }) =>
      searchByTag(tags, config, match, path || (url ? resolvePathOrUrl(undefined, url, config) : undefined), location)
  );

  server.tool(
    "list_all_tags",
    "Get all tags in vault with usage counts.",
    {
      path: z.string().optional().describe("Limit to directory"),
      url: urlParam.describe("Obsidian URL to limit search to directory — alternative to path"),
      minCount: z.number().default(1).describe("Minimum usage count"),
    },
    async ({ path, url, minCount }) => listAllTags(config, path || (url ? resolvePathOrUrl(undefined, url, config) : undefined), minCount)
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
      url: urlParam.describe("Obsidian URL to limit search to directory — alternative to path"),
      maxResults: z.number().default(20),
      threshold: z.number().default(0.4).describe("Match threshold 0-1"),
      includeDirectories: z.boolean().default(false),
    },
    async ({ query, path, url, maxResults, threshold, includeDirectories }) =>
      fuzzySearch(query, config, path || (url ? resolvePathOrUrl(undefined, url, config) : undefined), maxResults, threshold, includeDirectories)
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
      url: urlParam.describe("Obsidian URL to limit search to directory — alternative to path"),
      sortBy: z.enum(["date", "name"]).default("date"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
      maxResults: z.number().default(50),
    },
    async ({ dateField, condition, path, url, sortBy, sortOrder, maxResults }) =>
      searchByDate(dateField, condition, config, path || (url ? resolvePathOrUrl(undefined, url, config) : undefined), sortBy, sortOrder, maxResults)
  );

  // ========================================
  // BATCH OPERATIONS
  // ========================================

  server.tool(
    "batch_read",
    "Read multiple files in a single request. Supports text, image, audio, and PDF files — binary files return base64-encoded content with mediaType/mimeType fields.",
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
    'Write/update multiple files atomically. Each operation requires a "type" field: { type: "create", path, content }, { type: "update", path, content, expectedEtag? }, { type: "append", path, content }, or { type: "delete", path }.',
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
  // BINARY FILE OPERATIONS
  // ========================================

  server.tool(
    "create_binary_file",
    "Create a binary file (image, PDF, etc.) from base64-encoded content. Fails if file already exists.",
    {
      path: z.string().optional().describe("Destination file path (e.g., '/vault/Attachments/receipt.pdf')"),
      url: urlParam,
      content: z.string().describe("Base64-encoded file content"),
    },
    async ({ path, url, content }) =>
      createBinaryFile(resolvePathOrUrl(path, url, config), content, config)
  );

  server.tool(
    "attach_to_note",
    "Create a binary file and insert an embed link (![[filename]]) into a note. Places the attachment in the same directory as the note.",
    {
      notePath: z.string().optional().describe("Path of the note to attach to"),
      noteUrl: z.string().optional().describe("Obsidian URL of the note — alternative to notePath"),
      fileName: z.string().describe("Desired filename for the attachment (e.g., 'receipt.pdf')"),
      content: z.string().describe("Base64-encoded file content"),
      position: z
        .string()
        .default("end")
        .describe("Where to insert embed: 'end', 'start', or 'after:Heading Text'"),
    },
    async ({ notePath, noteUrl, fileName, content, position }) =>
      attachToNote(resolvePathOrUrl(notePath, noteUrl, config), fileName, content, config, position)
  );

  // ========================================
  // BASES (DATABASE VIEWS)
  // ========================================

  server.tool(
    "list_bases",
    "List all Obsidian Bases (.base files) across vaults with their filter config, item counts, and view names.",
    {},
    async () => listBases(config)
  );

  server.tool(
    "query_base",
    "Query items in an Obsidian Base. Returns all matching items with their frontmatter properties, sorted according to the view configuration. Use list_bases first to discover available bases.",
    {
      path: z.string().optional().describe("Path to the .base file"),
      url: urlParam,
      view: z.string().optional().describe("View name to use for sorting/filtering (defaults to first view)"),
    },
    async ({ path, url, view }) =>
      queryBase(resolvePathOrUrl(path, url, config), config, view)
  );

  server.tool(
    "create_base_item",
    "Create a new item (markdown file with frontmatter) in an Obsidian Base. Always use this (not create_file) when creating items for an Obsidian Base — it automatically resolves the correct Base items folder from the .base file. Use get_base_schema first to discover expected properties.",
    {
      basePath: z.string().optional().describe("Path to the .base file"),
      baseUrl: z.string().optional().describe("Obsidian URL of the .base file — alternative to basePath"),
      name: z.string().describe("Name for the new item (becomes the filename)"),
      properties: z.record(z.string(), z.unknown()).describe("Frontmatter properties for the item"),
    },
    async ({ basePath, baseUrl, name, properties }) =>
      createBaseItem(resolvePathOrUrl(basePath, baseUrl, config), name, properties, config)
  );

  server.tool(
    "get_base_schema",
    "Inspect an Obsidian Base's property schema. Analyzes existing items to return property names, inferred types, usage frequency, and example values. Helps you create items with correct property formats.",
    {
      path: z.string().optional().describe("Path to the .base file"),
      url: urlParam,
    },
    async ({ path, url }) =>
      getBaseSchema(resolvePathOrUrl(path, url, config), config)
  );

  // ========================================
  // SECTION-AWARE READING
  // ========================================

  server.tool(
    "get_sections",
    "Get the heading structure of a markdown file as a table of contents with line ranges. No body content is returned. Use this to understand file structure before reading specific sections.",
    {
      path: z.string().optional().describe("File path"),
      url: urlParam,
    },
    async ({ path, url }) => getSections(resolvePathOrUrl(path, url, config), config)
  );

  server.tool(
    "read_section",
    "Read the content of a specific section identified by heading text. More efficient than read_file for large files.",
    {
      path: z.string().optional().describe("File path"),
      url: urlParam,
      heading: z.string().describe("Heading text to match including # prefix (e.g., '## Summary'). Use 'frontmatter' to read YAML frontmatter."),
      includeChildren: z.boolean().default(true).describe("Include nested child sections"),
      includeHeading: z.boolean().default(true).describe("Include the heading line itself"),
    },
    async ({ path, url, heading, includeChildren, includeHeading }) =>
      readSection(resolvePathOrUrl(path, url, config), config, { heading, includeChildren, includeHeading })
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
        .optional()
        .describe("File path (e.g., /personal/notes/todo.md)"),
      url: urlParam,
    },
    async ({ path, url }) => pathToObsidianUrl(resolvePathOrUrl(path, url, config), config)
  );
}
