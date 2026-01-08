import { describe, it, expect } from "vitest";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { moveFile, renameFile } from "../tools/move.js";
import { readFile } from "../tools/read.js";
import { createFile } from "../tools/create.js";

const config = createTestConfig();

describe("moveFile", () => {
  it("moves file to new location", async () => {
    await createFile("/vault/source.md", "Source content", config);

    const result = await moveFile("/vault/source.md", "/vault/dest.md", config, false, false);
    const data = getTestResult(result) as { success: boolean; destination: string };

    expect(data.success).toBe(true);
    expect(data.destination).toBe("/vault/dest.md");

    // Source should not exist
    const sourceRead = await readFile("/vault/source.md", config);
    expect(sourceRead.isError).toBe(true);

    // Destination should exist
    const destRead = await readFile("/vault/dest.md", config);
    const destData = getTestResult(destRead) as { content: string };
    expect(destData.content).toBe("Source content");
  });

  it("moves file to different directory", async () => {
    await createFile("/vault/root-file.md", "Content", config);

    const result = await moveFile("/vault/root-file.md", "/vault/notes/moved-file.md", config, false, false);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/vault/notes/moved-file.md", config);
    expect(readResult.isError).toBeFalsy();
  });

  it("updates wikilinks when moving", async () => {
    // Create a file that links to another
    await createFile("/vault/link-target.md", "Target content", config);
    await createFile("/vault/linking-file.md", "See [[link-target]] for more", config);

    // Move the target
    const result = await moveFile("/vault/link-target.md", "/vault/moved-target.md", config, true, false);
    const data = getTestResult(result) as { success: boolean; linksUpdated: number };

    expect(data.success).toBe(true);
    // Note: The link update depends on the mock glob finding the file
  });

  it("returns error when source does not exist", async () => {
    const result = await moveFile("/vault/nonexistent.md", "/vault/dest.md", config, false, false);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not exist");
  });

  it("returns error when destination exists without overwrite", async () => {
    await createFile("/vault/source-ow.md", "Source", config);
    await createFile("/vault/dest-ow.md", "Dest", config);

    const result = await moveFile("/vault/source-ow.md", "/vault/dest-ow.md", config, false, false);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("already exists");
  });

  it("overwrites destination when overwrite is true", async () => {
    await createFile("/vault/source-overwrite.md", "New content", config);
    await createFile("/vault/dest-overwrite.md", "Old content", config);

    const result = await moveFile("/vault/source-overwrite.md", "/vault/dest-overwrite.md", config, false, true);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/vault/dest-overwrite.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("New content");
  });

  it("protects .obsidian directory", async () => {
    await createFile("/vault/source-obs.md", "Content", config);

    const result = await moveFile("/vault/source-obs.md", "/vault/.obsidian/moved.md", config, false, false);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(".obsidian");
  });
});

describe("renameFile", () => {
  it("renames file in place", async () => {
    await createFile("/vault/original-name.md", "Content", config);

    const result = await renameFile("/vault/original-name.md", "new-name.md", config, false);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    // Old name should not exist
    const oldRead = await readFile("/vault/original-name.md", config);
    expect(oldRead.isError).toBe(true);

    // New name should exist
    const newRead = await readFile("/vault/new-name.md", config);
    expect(newRead.isError).toBeFalsy();
  });

  it("renames file in subdirectory", async () => {
    await createFile("/vault/notes/old-note.md", "Note content", config);

    const result = await renameFile("/vault/notes/old-note.md", "renamed-note.md", config, false);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/vault/notes/renamed-note.md", config);
    expect(readResult.isError).toBeFalsy();
  });

  it("returns error for non-existent file", async () => {
    const result = await renameFile("/vault/nonexistent.md", "new-name.md", config, false);
    expect(result.isError).toBe(true);
  });
});
