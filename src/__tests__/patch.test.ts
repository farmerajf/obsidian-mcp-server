import { describe, it, expect } from "vitest";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { patchFile } from "../tools/patch.js";
import { readFilePartial, getFileMetadata } from "../tools/metadata.js";
import { readFile } from "../tools/read.js";
import { createFile } from "../tools/create.js";

const config = createTestConfig();

describe("patchFile", () => {
  it("replaces lines", async () => {
    await createFile("/vault/patch-test.md", "Line 1\nLine 2\nLine 3\nLine 4", config);

    const result = await patchFile(
      "/vault/patch-test.md",
      [{ type: "replace_lines", startLine: 2, endLine: 3, content: "New Line 2\nNew Line 3" }],
      config
    );
    const data = getTestResult(result) as { success: boolean; patchesApplied: number };

    expect(data.success).toBe(true);
    expect(data.patchesApplied).toBe(1);

    const readResult = await readFile("/vault/patch-test.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("Line 1\nNew Line 2\nNew Line 3\nLine 4");
  });

  it("inserts after line", async () => {
    await createFile("/vault/insert-test.md", "Line 1\nLine 2", config);

    const result = await patchFile(
      "/vault/insert-test.md",
      [{ type: "insert_after", line: 1, content: "Inserted line" }],
      config
    );
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/vault/insert-test.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("Line 1\nInserted line\nLine 2");
  });

  it("deletes lines", async () => {
    await createFile("/vault/delete-lines.md", "Line 1\nLine 2\nLine 3", config);

    const result = await patchFile(
      "/vault/delete-lines.md",
      [{ type: "delete_lines", startLine: 2, endLine: 2 }],
      config
    );
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/vault/delete-lines.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("Line 1\nLine 3");
  });

  it("replaces first occurrence", async () => {
    await createFile("/vault/replace-first.md", "foo bar foo baz", config);

    const result = await patchFile(
      "/vault/replace-first.md",
      [{ type: "replace_first", search: "foo", replace: "qux" }],
      config
    );
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/vault/replace-first.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("qux bar foo baz");
  });

  it("replaces all occurrences", async () => {
    await createFile("/vault/replace-all.md", "foo bar foo baz", config);

    const result = await patchFile(
      "/vault/replace-all.md",
      [{ type: "replace_all", search: "foo", replace: "qux" }],
      config
    );
    const data = getTestResult(result) as { success: boolean; linesAffected: number };

    expect(data.success).toBe(true);
    expect(data.linesAffected).toBe(2); // Two replacements

    const readResult = await readFile("/vault/replace-all.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("qux bar qux baz");
  });

  it("replaces with regex", async () => {
    await createFile("/vault/regex-test.md", "date: 2024-01-01\ndate: 2024-02-15", config);

    const result = await patchFile(
      "/vault/regex-test.md",
      [{ type: "replace_regex", pattern: "\\d{4}-\\d{2}-\\d{2}", replace: "REDACTED", flags: "g" }],
      config
    );
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/vault/regex-test.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("date: REDACTED\ndate: REDACTED");
  });

  it("detects ETag conflict", async () => {
    await createFile("/vault/etag-patch.md", "Content", config);

    const result = await patchFile(
      "/vault/etag-patch.md",
      [{ type: "replace_first", search: "Content", replace: "New" }],
      config,
      "wrong-etag"
    );

    expect(result.isError).toBe(true);
    const data = getTestResult(result) as { error: string };
    expect(data.error).toBe("Conflict detected");
  });

  it("returns error for non-existent file", async () => {
    const result = await patchFile(
      "/vault/nonexistent.md",
      [{ type: "replace_first", search: "a", replace: "b" }],
      config
    );
    expect(result.isError).toBe(true);
  });
});

describe("readFilePartial", () => {
  it("reads lines from file", async () => {
    await createFile("/vault/lines-test.md", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5", config);

    const result = await readFilePartial("/vault/lines-test.md", config, {
      mode: "lines",
      start: 2,
      end: 4,
    });
    const data = getTestResult(result) as { content: string; totalLines: number };

    expect(data.content).toBe("Line 2\nLine 3\nLine 4");
    expect(data.totalLines).toBe(5);
  });

  it("reads bytes from file", async () => {
    await createFile("/vault/bytes-test.md", "Hello World!", config);

    const result = await readFilePartial("/vault/bytes-test.md", config, {
      mode: "bytes",
      start: 0,
      end: 5,
    });
    const data = getTestResult(result) as { content: string };

    expect(data.content).toBe("Hello");
  });

  it("returns error for non-existent file", async () => {
    const result = await readFilePartial("/vault/nonexistent.md", config, {
      mode: "lines",
      start: 1,
    });
    expect(result.isError).toBe(true);
  });
});

describe("getFileMetadata", () => {
  it("returns metadata for existing file", async () => {
    const result = await getFileMetadata("/vault/index.md", config);
    const data = getTestResult(result) as {
      path: string;
      exists: boolean;
      type: string;
      size: number;
      hasFrontmatter: boolean;
      tags: string[];
      linkCount: number;
    };

    expect(data.exists).toBe(true);
    expect(data.type).toBe("file");
    expect(data.size).toBeGreaterThan(0);
    expect(data.hasFrontmatter).toBe(true);
    expect(data.tags).toContain("home");
    expect(data.tags).toContain("index");
    expect(data.linkCount).toBeGreaterThan(0);
  });

  it("returns exists: false for non-existent file", async () => {
    const result = await getFileMetadata("/vault/nonexistent.md", config);
    const data = getTestResult(result) as { path: string; exists: boolean };

    expect(data.exists).toBe(false);
  });

  it("detects inline tags", async () => {
    const result = await getFileMetadata("/vault/todo.md", config);
    const data = getTestResult(result) as { tags: string[] };

    // Should include both frontmatter and inline tags
    expect(data.tags).toContain("tasks");
    expect(data.tags).toContain("urgent");
    expect(data.tags).toContain("done");
    expect(data.tags).toContain("later");
  });
});
