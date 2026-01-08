import { describe, it, expect } from "vitest";
import "./helpers/setup.js";
import { createTestConfig, getTestResult, TEST_VAULT_PATH } from "./helpers/setup.js";
import { listDirectory } from "../tools/list.js";
import { readFile } from "../tools/read.js";
import { createFile } from "../tools/create.js";
import { updateFile } from "../tools/update.js";
import { deleteFile } from "../tools/delete.js";
import { searchFiles } from "../tools/search.js";

const config = createTestConfig();

describe("listDirectory", () => {
  it("lists root directory as vaults", async () => {
    const result = await listDirectory("/", config);
    const data = getTestResult(result) as { name: string; type: string }[];

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].name).toBe("vault");
    expect(data[0].type).toBe("directory");
  });

  it("lists vault root contents", async () => {
    const result = await listDirectory("/vault", config);
    const data = getTestResult(result) as { name: string; type: string }[];

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);

    const names = data.map((item) => item.name);
    expect(names).toContain("index.md");
    expect(names).toContain("notes");
    expect(names).toContain(".obsidian");
  });

  it("lists subdirectory contents", async () => {
    const result = await listDirectory("/vault/notes/daily", config);
    const data = getTestResult(result) as { name: string; type: string }[];

    expect(Array.isArray(data)).toBe(true);
    const names = data.map((item) => item.name);
    expect(names).toContain("2024-01-01.md");
    expect(names).toContain("2024-01-02.md");
  });

  it("returns error for non-existent vault", async () => {
    const result = await listDirectory("/nonexistent", config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid vault name");
  });
});

describe("readFile", () => {
  it("reads file content and returns ETag", async () => {
    const result = await readFile("/vault/index.md", config);
    const data = getTestResult(result) as { path: string; content: string; etag: string };

    expect(data.path).toBe("/vault/index.md");
    expect(data.content).toContain("# Welcome");
    expect(data.content).toContain("[[todo]]");
    expect(data.etag).toBeDefined();
    expect(typeof data.etag).toBe("string");
  });

  it("returns error for non-existent file", async () => {
    const result = await readFile("/vault/nonexistent.md", config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error");
  });

  it("reads file with frontmatter", async () => {
    const result = await readFile("/vault/todo.md", config);
    const data = getTestResult(result) as { content: string };

    expect(data.content).toContain("---");
    expect(data.content).toContain("title: Todo List");
    expect(data.content).toContain("tags: [tasks, todo]");
  });
});

describe("createFile", () => {
  it("creates a new file", async () => {
    const result = await createFile("/vault/newfile.md", "# New File\n\nContent here.", config);
    const data = getTestResult(result) as { success: boolean; etag: string };

    expect(data.success).toBe(true);
    expect(data.etag).toBeDefined();

    // Verify file was created
    const readResult = await readFile("/vault/newfile.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("# New File\n\nContent here.");
  });

  it("creates file in nested directory", async () => {
    const result = await createFile("/vault/notes/new-folder/nested.md", "Nested content", config);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    // Verify file was created
    const readResult = await readFile("/vault/notes/new-folder/nested.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("Nested content");
  });

  it("returns error when file already exists", async () => {
    const result = await createFile("/vault/index.md", "New content", config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("already exists");
  });
});

describe("updateFile", () => {
  it("updates an existing file", async () => {
    // First read to get current content
    const readResult = await readFile("/vault/plain.md", config);
    const readData = getTestResult(readResult) as { etag: string };

    // Update the file
    const result = await updateFile("/vault/plain.md", "# Updated Content\n\nNew text.", undefined, config);
    const data = getTestResult(result) as { success: boolean; etag: string };

    expect(data.success).toBe(true);
    expect(data.etag).not.toBe(readData.etag);

    // Verify content changed
    const verifyResult = await readFile("/vault/plain.md", config);
    const verifyData = getTestResult(verifyResult) as { content: string };
    expect(verifyData.content).toBe("# Updated Content\n\nNew text.");
  });

  it("updates file with correct ETag", async () => {
    const readResult = await readFile("/vault/plain.md", config);
    const readData = getTestResult(readResult) as { etag: string };

    const result = await updateFile("/vault/plain.md", "Updated with ETag", readData.etag, config);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);
  });

  it("returns conflict error with wrong ETag", async () => {
    const result = await updateFile("/vault/plain.md", "Content", "wrong-etag", config);
    expect(result.isError).toBe(true);

    const data = getTestResult(result) as { error: string };
    expect(data.error).toBe("Conflict detected");
  });

  it("returns error for non-existent file", async () => {
    const result = await updateFile("/vault/nonexistent.md", "Content", undefined, config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not exist");
  });
});

describe("deleteFile", () => {
  it("soft deletes file to trash", async () => {
    // Create a file to delete
    await createFile("/vault/to-delete.md", "Delete me", config);

    const result = await deleteFile("/vault/to-delete.md", config, false);
    const data = getTestResult(result) as { success: boolean; permanent: boolean; trashedTo: string };

    expect(data.success).toBe(true);
    expect(data.permanent).toBe(false);
    expect(data.trashedTo).toContain(".trash");

    // Original file should not exist
    const readResult = await readFile("/vault/to-delete.md", config);
    expect(readResult.isError).toBe(true);
  });

  it("permanently deletes file", async () => {
    await createFile("/vault/perm-delete.md", "Delete permanently", config);

    const result = await deleteFile("/vault/perm-delete.md", config, true);
    const data = getTestResult(result) as { success: boolean; permanent: boolean };

    expect(data.success).toBe(true);
    expect(data.permanent).toBe(true);

    // File should not exist
    const readResult = await readFile("/vault/perm-delete.md", config);
    expect(readResult.isError).toBe(true);
  });

  it("returns error for non-existent file", async () => {
    const result = await deleteFile("/vault/nonexistent.md", config, false);
    expect(result.isError).toBe(true);
  });

  it("protects .obsidian directory", async () => {
    const result = await deleteFile("/vault/.obsidian/config.json", config, true);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Cannot delete");
  });
});

describe("searchFiles", () => {
  it("searches by content", async () => {
    const result = await searchFiles("Welcome", undefined, "content", config);
    const data = getTestResult(result) as { results: { path: string }[] };

    expect(data.results.length).toBeGreaterThan(0);
    const paths = data.results.map((r) => r.path);
    expect(paths).toContain("/vault/index.md");
  });

  it("searches by filename", async () => {
    const result = await searchFiles("todo", undefined, "filename", config);
    const data = getTestResult(result) as { results: { path: string }[] };

    expect(data.results.length).toBeGreaterThan(0);
    const paths = data.results.map((r) => r.path);
    expect(paths).toContain("/vault/todo.md");
  });

  it("searches within subdirectory", async () => {
    const result = await searchFiles("Daily Note", "/vault/notes/daily", "content", config);
    const data = getTestResult(result) as { results: { path: string }[] };

    expect(data.results.length).toBeGreaterThan(0);
    // Results contain files from the daily directory
    const paths = data.results.map((r) => r.path);
    expect(paths.some((p) => p.includes("2024-01-01") || p.includes("2024-01-02"))).toBe(true);
  });

  it("returns full path when searching subdirectory", async () => {
    // Create a file in a subdirectory with unique content
    await createFile(
      "/vault/notes/projects/search-path-test.md",
      "unique-search-content-xyz",
      config
    );

    const result = await searchFiles("unique-search-content-xyz", "/vault/notes/projects", "content", config);
    const data = getTestResult(result) as { results: { path: string }[] };

    expect(data.results.length).toBeGreaterThan(0);
    // Critical: path should include the full subdirectory, not just /vault/search-path-test.md
    const found = data.results.find((r) => r.path.includes("search-path-test"));
    expect(found).toBeDefined();
    expect(found!.path).toBe("/vault/notes/projects/search-path-test.md");
  });

  it("returns empty results for no matches", async () => {
    const result = await searchFiles("xyznonexistentxyz", undefined, "content", config);
    const data = getTestResult(result) as { results: unknown[] };

    expect(data.results.length).toBe(0);
  });
});
