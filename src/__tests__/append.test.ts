import { describe, it, expect } from "vitest";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { appendFile, prependFile } from "../tools/append.js";
import { readFile } from "../tools/read.js";
import { createFile } from "../tools/create.js";

const config = createTestConfig();

describe("appendFile", () => {
  it("appends content to existing file", async () => {
    await createFile("/test-append.md", "Initial content", config);

    const result = await appendFile("/test-append.md", "Appended text", config, {});
    const data = getTestResult(result) as { success: boolean; bytesAppended: number };

    expect(data.success).toBe(true);
    expect(data.bytesAppended).toBe(13); // "Appended text".length

    const readResult = await readFile("/test-append.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toContain("Initial content");
    expect(readData.content).toContain("Appended text");
  });

  it("ensures newline before appending", async () => {
    await createFile("/no-newline.md", "No trailing newline", config);

    await appendFile("/no-newline.md", "Next line", config, { ensureNewline: true });

    const readResult = await readFile("/no-newline.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("No trailing newline\nNext line");
  });

  it("appends with custom separator", async () => {
    await createFile("/separator.md", "Line 1\n", config);

    await appendFile("/separator.md", "Line 2", config, { separator: "\n---\n" });

    const readResult = await readFile("/separator.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toContain("---");
  });

  it("creates file if missing with createIfMissing", async () => {
    const result = await appendFile("/new-from-append.md", "Created content", config, {
      createIfMissing: true,
    });
    const data = getTestResult(result) as { success: boolean; created: boolean };

    expect(data.success).toBe(true);
    expect(data.created).toBe(true);

    const readResult = await readFile("/new-from-append.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("Created content");
  });

  it("returns error for non-existent file without createIfMissing", async () => {
    const result = await appendFile("/nonexistent.md", "Content", config, {
      createIfMissing: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not exist");
  });
});

describe("prependFile", () => {
  it("prepends content to existing file", async () => {
    await createFile("/test-prepend.md", "Original content", config);

    const result = await prependFile("/test-prepend.md", "Prepended text\n", config, {
      afterFrontmatter: false,
    });
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/test-prepend.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("Prepended text\nOriginal content");
  });

  it("prepends after frontmatter", async () => {
    const result = await prependFile("/index.md", "New first paragraph", config, {
      afterFrontmatter: true,
    });
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/index.md", config);
    const readData = getTestResult(readResult) as { content: string };

    // Should still start with frontmatter
    expect(readData.content).toMatch(/^---\n/);
    // New content should appear after frontmatter
    expect(readData.content).toContain("---\nNew first paragraph");
  });

  it("creates file if missing with createIfMissing", async () => {
    const result = await prependFile("/new-from-prepend.md", "Created content", config, {
      createIfMissing: true,
    });
    const data = getTestResult(result) as { success: boolean; created: boolean };

    expect(data.success).toBe(true);
    expect(data.created).toBe(true);
  });

  it("returns error for non-existent file without createIfMissing", async () => {
    const result = await prependFile("/nonexistent.md", "Content", config, {
      createIfMissing: false,
    });
    expect(result.isError).toBe(true);
  });
});
