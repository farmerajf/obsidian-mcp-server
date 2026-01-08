import { describe, it, expect } from "vitest";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import {
  createDirectory,
  renameDirectory,
  deleteDirectory,
  getDirectoryInfo,
} from "../tools/directory.js";
import { listDirectory } from "../tools/list.js";
import { createFile } from "../tools/create.js";

const config = createTestConfig();

describe("createDirectory", () => {
  it("creates a new directory", async () => {
    const result = await createDirectory("/vault/new-dir", config);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    // Verify directory exists
    const listResult = await listDirectory("/vault", config);
    const listData = getTestResult(listResult) as { name: string }[];
    expect(listData.some((item) => item.name === "new-dir")).toBe(true);
  });

  it("creates nested directories", async () => {
    const result = await createDirectory("/vault/deep/nested/path", config);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    // Verify nested path exists
    const listResult = await listDirectory("/vault/deep/nested", config);
    const listData = getTestResult(listResult) as { name: string }[];
    expect(listData.some((item) => item.name === "path")).toBe(true);
  });

  it("returns error if path already exists", async () => {
    const result = await createDirectory("/vault/notes", config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("already exists");
  });
});

describe("renameDirectory", () => {
  it("renames a directory", async () => {
    await createDirectory("/vault/to-rename", config);

    const result = await renameDirectory("/vault/to-rename", "renamed-dir", config);
    const data = getTestResult(result) as { success: boolean; newPath: string };

    expect(data.success).toBe(true);
    expect(data.newPath).toBe("/vault/renamed-dir");

    // Old path should not exist
    const oldList = await listDirectory("/vault/to-rename", config);
    expect(oldList.isError).toBe(true);

    // New path should exist
    const newList = await listDirectory("/vault", config);
    const newListData = getTestResult(newList) as { name: string }[];
    expect(newListData.some((item) => item.name === "renamed-dir")).toBe(true);
  });

  it("returns error for non-existent directory", async () => {
    const result = await renameDirectory("/vault/nonexistent-dir", "new-name", config);
    expect(result.isError).toBe(true);
  });

  it("protects .obsidian directory", async () => {
    const result = await renameDirectory("/vault/.obsidian", "obsidian-backup", config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Cannot rename");
  });
});

describe("deleteDirectory", () => {
  it("deletes empty directory", async () => {
    await createDirectory("/vault/empty-dir", config);

    const result = await deleteDirectory("/vault/empty-dir", config, false, false);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    // Directory should not exist
    const listResult = await listDirectory("/vault/empty-dir", config);
    expect(listResult.isError).toBe(true);
  });

  it("requires recursive flag for non-empty directory", async () => {
    await createDirectory("/vault/non-empty", config);
    await createFile("/vault/non-empty/file.md", "Content", config);

    const result = await deleteDirectory("/vault/non-empty", config, false, false);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not empty");
  });

  it("requires confirm for recursive delete", async () => {
    await createDirectory("/vault/to-delete", config);
    await createFile("/vault/to-delete/file.md", "Content", config);

    const result = await deleteDirectory("/vault/to-delete", config, true, false);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("confirm");
  });

  it("deletes non-empty directory with recursive and confirm", async () => {
    await createDirectory("/vault/recursive-delete", config);
    await createFile("/vault/recursive-delete/file1.md", "Content 1", config);
    await createFile("/vault/recursive-delete/file2.md", "Content 2", config);

    const result = await deleteDirectory("/vault/recursive-delete", config, true, true);
    const data = getTestResult(result) as { success: boolean; trashedTo: string };

    expect(data.success).toBe(true);
    expect(data.trashedTo).toContain(".trash");
  });

  it("protects .obsidian directory", async () => {
    const result = await deleteDirectory("/vault/.obsidian", config, true, true);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Cannot delete");
  });
});

describe("getDirectoryInfo", () => {
  it("returns directory information", async () => {
    const result = await getDirectoryInfo("/vault/notes", config);
    const data = getTestResult(result) as {
      path: string;
      fileCount: number;
      directoryCount: number;
      children: { name: string; type: string }[];
    };

    expect(data.path).toBe("/vault/notes");
    expect(data.directoryCount).toBeGreaterThan(0);
    expect(data.children.length).toBeGreaterThan(0);
    expect(data.children.some((c) => c.name === "daily" && c.type === "directory")).toBe(true);
    expect(data.children.some((c) => c.name === "projects" && c.type === "directory")).toBe(true);
  });

  it("returns error for non-existent directory", async () => {
    const result = await getDirectoryInfo("/vault/nonexistent", config);
    expect(result.isError).toBe(true);
  });

  it("returns error for file path", async () => {
    const result = await getDirectoryInfo("/vault/index.md", config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not a directory");
  });
});
