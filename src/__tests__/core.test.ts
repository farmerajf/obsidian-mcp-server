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
  it("lists root directory contents", async () => {
    const result = await listDirectory("/", config);
    const data = getTestResult(result) as { name: string; type: string }[];

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);

    const names = data.map((item) => item.name);
    expect(names).toContain("index.md");
    expect(names).toContain("notes");
    expect(names).toContain(".obsidian");
  });

  it("lists subdirectory contents", async () => {
    const result = await listDirectory("/notes/daily", config);
    const data = getTestResult(result) as { name: string; type: string }[];

    expect(Array.isArray(data)).toBe(true);
    const names = data.map((item) => item.name);
    expect(names).toContain("2024-01-01.md");
    expect(names).toContain("2024-01-02.md");
  });

  it("returns error for non-existent directory", async () => {
    const result = await listDirectory("/nonexistent", config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error");
  });
});

describe("readFile", () => {
  it("reads file content and returns ETag", async () => {
    const result = await readFile("/index.md", config);
    const data = getTestResult(result) as { path: string; content: string; etag: string };

    expect(data.path).toBe("/index.md");
    expect(data.content).toContain("# Welcome");
    expect(data.content).toContain("[[todo]]");
    expect(data.etag).toBeDefined();
    expect(typeof data.etag).toBe("string");
  });

  it("returns error for non-existent file", async () => {
    const result = await readFile("/nonexistent.md", config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error");
  });

  it("reads file with frontmatter", async () => {
    const result = await readFile("/todo.md", config);
    const data = getTestResult(result) as { content: string };

    expect(data.content).toContain("---");
    expect(data.content).toContain("title: Todo List");
    expect(data.content).toContain("tags: [tasks, todo]");
  });
});

describe("createFile", () => {
  it("creates a new file", async () => {
    const result = await createFile("/newfile.md", "# New File\n\nContent here.", config);
    const data = getTestResult(result) as { success: boolean; etag: string };

    expect(data.success).toBe(true);
    expect(data.etag).toBeDefined();

    // Verify file was created
    const readResult = await readFile("/newfile.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("# New File\n\nContent here.");
  });

  it("creates file in nested directory", async () => {
    const result = await createFile("/notes/new-folder/nested.md", "Nested content", config);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    // Verify file was created
    const readResult = await readFile("/notes/new-folder/nested.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("Nested content");
  });

  it("returns error when file already exists", async () => {
    const result = await createFile("/index.md", "New content", config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("already exists");
  });
});

describe("updateFile", () => {
  it("updates an existing file", async () => {
    // First read to get current content
    const readResult = await readFile("/plain.md", config);
    const readData = getTestResult(readResult) as { etag: string };

    // Update the file
    const result = await updateFile("/plain.md", "# Updated Content\n\nNew text.", undefined, config);
    const data = getTestResult(result) as { success: boolean; etag: string };

    expect(data.success).toBe(true);
    expect(data.etag).not.toBe(readData.etag);

    // Verify content changed
    const verifyResult = await readFile("/plain.md", config);
    const verifyData = getTestResult(verifyResult) as { content: string };
    expect(verifyData.content).toBe("# Updated Content\n\nNew text.");
  });

  it("updates file with correct ETag", async () => {
    const readResult = await readFile("/plain.md", config);
    const readData = getTestResult(readResult) as { etag: string };

    const result = await updateFile("/plain.md", "Updated with ETag", readData.etag, config);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);
  });

  it("returns conflict error with wrong ETag", async () => {
    const result = await updateFile("/plain.md", "Content", "wrong-etag", config);
    expect(result.isError).toBe(true);

    const data = getTestResult(result) as { error: string };
    expect(data.error).toBe("Conflict detected");
  });

  it("returns error for non-existent file", async () => {
    const result = await updateFile("/nonexistent.md", "Content", undefined, config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not exist");
  });
});

describe("deleteFile", () => {
  it("soft deletes file to trash", async () => {
    // Create a file to delete
    await createFile("/to-delete.md", "Delete me", config);

    const result = await deleteFile("/to-delete.md", config, false);
    const data = getTestResult(result) as { success: boolean; permanent: boolean; trashedTo: string };

    expect(data.success).toBe(true);
    expect(data.permanent).toBe(false);
    expect(data.trashedTo).toContain(".trash");

    // Original file should not exist
    const readResult = await readFile("/to-delete.md", config);
    expect(readResult.isError).toBe(true);
  });

  it("permanently deletes file", async () => {
    await createFile("/perm-delete.md", "Delete permanently", config);

    const result = await deleteFile("/perm-delete.md", config, true);
    const data = getTestResult(result) as { success: boolean; permanent: boolean };

    expect(data.success).toBe(true);
    expect(data.permanent).toBe(true);

    // File should not exist
    const readResult = await readFile("/perm-delete.md", config);
    expect(readResult.isError).toBe(true);
  });

  it("returns error for non-existent file", async () => {
    const result = await deleteFile("/nonexistent.md", config, false);
    expect(result.isError).toBe(true);
  });

  it("protects .obsidian directory", async () => {
    const result = await deleteFile("/.obsidian/config.json", config, true);
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
    expect(paths).toContain("/index.md");
  });

  it("searches by filename", async () => {
    const result = await searchFiles("todo", undefined, "filename", config);
    const data = getTestResult(result) as { results: { path: string }[] };

    expect(data.results.length).toBeGreaterThan(0);
    const paths = data.results.map((r) => r.path);
    expect(paths).toContain("/todo.md");
  });

  it("searches within subdirectory", async () => {
    const result = await searchFiles("Daily Note", "/notes/daily", "content", config);
    const data = getTestResult(result) as { results: { path: string }[] };

    expect(data.results.length).toBeGreaterThan(0);
    // Results contain files from the daily directory
    const paths = data.results.map((r) => r.path);
    expect(paths.some((p) => p.includes("2024-01-01") || p.includes("2024-01-02"))).toBe(true);
  });

  it("returns empty results for no matches", async () => {
    const result = await searchFiles("xyznonexistentxyz", undefined, "content", config);
    const data = getTestResult(result) as { results: unknown[] };

    expect(data.results.length).toBe(0);
  });
});
