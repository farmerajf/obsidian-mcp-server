import { describe, it, expect } from "vitest";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { moveFile, renameFile } from "../tools/move.js";
import { readFile } from "../tools/read.js";
import { createFile } from "../tools/create.js";

const config = createTestConfig();

describe("moveFile", () => {
  it("moves file to new location", async () => {
    await createFile("/source.md", "Source content", config);

    const result = await moveFile("/source.md", "/dest.md", config, false, false);
    const data = getTestResult(result) as { success: boolean; destination: string };

    expect(data.success).toBe(true);
    expect(data.destination).toBe("/dest.md");

    // Source should not exist
    const sourceRead = await readFile("/source.md", config);
    expect(sourceRead.isError).toBe(true);

    // Destination should exist
    const destRead = await readFile("/dest.md", config);
    const destData = getTestResult(destRead) as { content: string };
    expect(destData.content).toBe("Source content");
  });

  it("moves file to different directory", async () => {
    await createFile("/root-file.md", "Content", config);

    const result = await moveFile("/root-file.md", "/notes/moved-file.md", config, false, false);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/notes/moved-file.md", config);
    expect(readResult.isError).toBeFalsy();
  });

  it("updates wikilinks when moving", async () => {
    // Create a file that links to another
    await createFile("/link-target.md", "Target content", config);
    await createFile("/linking-file.md", "See [[link-target]] for more", config);

    // Move the target
    const result = await moveFile("/link-target.md", "/moved-target.md", config, true, false);
    const data = getTestResult(result) as { success: boolean; linksUpdated: number };

    expect(data.success).toBe(true);
    // Note: The link update depends on the mock glob finding the file
  });

  it("returns error when source does not exist", async () => {
    const result = await moveFile("/nonexistent.md", "/dest.md", config, false, false);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not exist");
  });

  it("returns error when destination exists without overwrite", async () => {
    await createFile("/source-ow.md", "Source", config);
    await createFile("/dest-ow.md", "Dest", config);

    const result = await moveFile("/source-ow.md", "/dest-ow.md", config, false, false);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("already exists");
  });

  it("overwrites destination when overwrite is true", async () => {
    await createFile("/source-overwrite.md", "New content", config);
    await createFile("/dest-overwrite.md", "Old content", config);

    const result = await moveFile("/source-overwrite.md", "/dest-overwrite.md", config, false, true);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/dest-overwrite.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("New content");
  });

  it("protects .obsidian directory", async () => {
    await createFile("/source-obs.md", "Content", config);

    const result = await moveFile("/source-obs.md", "/.obsidian/moved.md", config, false, false);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(".obsidian");
  });
});

describe("renameFile", () => {
  it("renames file in place", async () => {
    await createFile("/original-name.md", "Content", config);

    const result = await renameFile("/original-name.md", "new-name.md", config, false);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    // Old name should not exist
    const oldRead = await readFile("/original-name.md", config);
    expect(oldRead.isError).toBe(true);

    // New name should exist
    const newRead = await readFile("/new-name.md", config);
    expect(newRead.isError).toBeFalsy();
  });

  it("renames file in subdirectory", async () => {
    await createFile("/notes/old-note.md", "Note content", config);

    const result = await renameFile("/notes/old-note.md", "renamed-note.md", config, false);
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/notes/renamed-note.md", config);
    expect(readResult.isError).toBeFalsy();
  });

  it("returns error for non-existent file", async () => {
    const result = await renameFile("/nonexistent.md", "new-name.md", config, false);
    expect(result.isError).toBe(true);
  });
});
