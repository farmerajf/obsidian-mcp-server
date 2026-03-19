import { describe, it, expect } from "vitest";
import { vol } from "memfs";
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

  // === Bug fix: insert_after with search parameter ===

  it("inserts after line matching search string", async () => {
    await createFile(
      "/vault/search-insert.md",
      "- Apples\n- Bananas\n- Cherries",
      config
    );

    const result = await patchFile(
      "/vault/search-insert.md",
      [{ type: "insert_after", search: "- Bananas", content: "- Blueberries" }],
      config
    );
    const data = getTestResult(result) as { success: boolean; patchesApplied: number };

    expect(data.success).toBe(true);
    expect(data.patchesApplied).toBe(1);

    const readResult = await readFile("/vault/search-insert.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("- Apples\n- Bananas\n- Blueberries\n- Cherries");
  });

  it("inserts after line matching search string with special characters", async () => {
    await createFile(
      "/vault/special-chars.md",
      "# Title\n\n- Item [link](url)\n- Other item",
      config
    );

    const result = await patchFile(
      "/vault/special-chars.md",
      [{ type: "insert_after", search: "- Item [link](url)", content: "- New item" }],
      config
    );
    const data = getTestResult(result) as { success: boolean; patchesApplied: number };

    expect(data.success).toBe(true);
    expect(data.patchesApplied).toBe(1);

    const readResult = await readFile("/vault/special-chars.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("# Title\n\n- Item [link](url)\n- New item\n- Other item");
  });

  // === Bug fix: silent failure on no match ===

  it("returns error when insert_after search string not found", async () => {
    await createFile("/vault/no-match.md", "Line 1\nLine 2", config);

    const result = await patchFile(
      "/vault/no-match.md",
      [{ type: "insert_after", search: "nonexistent text", content: "New line" }],
      config
    );
    const data = getTestResult(result) as { success: boolean; errors: string[] };

    expect(result.isError).toBe(true);
    expect(data.success).toBe(false);
    expect(data.errors).toContain('insert_after: search string not found: "nonexistent text"');
  });

  it("returns error when replace_first search string not found", async () => {
    await createFile("/vault/no-match-rf.md", "Line 1\nLine 2", config);

    const result = await patchFile(
      "/vault/no-match-rf.md",
      [{ type: "replace_first", search: "nonexistent", replace: "new" }],
      config
    );
    const data = getTestResult(result) as { success: boolean; errors: string[] };

    expect(result.isError).toBe(true);
    expect(data.success).toBe(false);
    expect(data.errors).toContain('replace_first: search string not found: "nonexistent"');
  });

  // === Bug fix: replace_lines batch drift ===

  it("applies multiple replace_lines patches without line drift", async () => {
    await createFile(
      "/vault/batch-drift.md",
      "H1\nA\nB\nH2\nC\nD\nH3\nE\nF",
      config
    );

    // Replace lines 2-3 (A,B), 5-6 (C,D), 8-9 (E,F) using original line numbers
    const result = await patchFile(
      "/vault/batch-drift.md",
      [
        { type: "replace_lines", startLine: 2, endLine: 3, content: "A1\nA2\nA3" },
        { type: "replace_lines", startLine: 5, endLine: 6, content: "C1" },
        { type: "replace_lines", startLine: 8, endLine: 9, content: "E1\nE2" },
      ],
      config
    );
    const data = getTestResult(result) as { success: boolean; patchesApplied: number };

    expect(data.success).toBe(true);
    expect(data.patchesApplied).toBe(3);

    const readResult = await readFile("/vault/batch-drift.md", config);
    const readData = getTestResult(readResult) as { content: string };
    // Patch 1: lines 2-3 (A,B) → A1,A2,A3 (net +1 line)
    // Patch 2: lines 5-6 (C,D) → C1 (net -1 line, but offset from patch 1 adjusts)
    // Patch 3: lines 8-9 (E,F) → E1,E2 (net 0)
    expect(readData.content).toBe("H1\nA1\nA2\nA3\nH2\nC1\nH3\nE1\nE2");
  });

  // === Bug fix: replace_lines with longer replacement ===

  it("replaces single line with longer content without duplication", async () => {
    await createFile(
      "/vault/longer-replace.md",
      "Line 1\nLine 2\nLine 3\nLine 4\nLine 5",
      config
    );

    const result = await patchFile(
      "/vault/longer-replace.md",
      [{ type: "replace_lines", startLine: 3, endLine: 3, content: "New A\nNew B\nNew C\nNew D" }],
      config
    );
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);

    const readResult = await readFile("/vault/longer-replace.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("Line 1\nLine 2\nNew A\nNew B\nNew C\nNew D\nLine 4\nLine 5");
  });

  it("reports partial success with errors when some patches fail", async () => {
    await createFile("/vault/partial.md", "AAA\nBBB\nCCC", config);

    const result = await patchFile(
      "/vault/partial.md",
      [
        { type: "replace_first", search: "AAA", replace: "XXX" },
        { type: "replace_first", search: "nonexistent", replace: "YYY" },
      ],
      config
    );
    const data = getTestResult(result) as {
      success: boolean;
      patchesApplied: number;
      errors: string[];
    };

    // Partial success — file is still written with the patches that did apply
    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.patchesApplied).toBe(1);
    expect(data.errors).toHaveLength(1);
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

  // === Bug fix: iCloud stub detection ===

  it("detects iCloud stub and returns pending_download status", async () => {
    // Create an iCloud stub file (macOS naming: .filename.icloud)
    vol.mkdirSync("/vault/notes/icloud-test", { recursive: true });
    vol.writeFileSync("/vault/notes/icloud-test/.meeting.md.icloud", "");

    const result = await getFileMetadata("/vault/notes/icloud-test/meeting.md", config);
    const data = getTestResult(result) as {
      path: string;
      exists: boolean;
      iCloudStatus: string;
      message: string;
    };

    expect(data.exists).toBe(true);
    expect(data.iCloudStatus).toBe("pending_download");
    expect(data.message).toContain("iCloud");
  });
});

// === Bug fix: iCloud stub detection in readFile ===

describe("readFile iCloud detection", () => {
  it("returns iCloud error instead of generic ENOENT", async () => {
    vol.mkdirSync("/vault/icloud-read-test", { recursive: true });
    vol.writeFileSync("/vault/icloud-read-test/.notes.md.icloud", "");

    const result = await readFile("/vault/icloud-read-test/notes.md", config);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text as string;
    expect(text).toContain("iCloud");
    expect(text).toContain("not been downloaded");
  });
});

describe("readFilePartial iCloud detection", () => {
  it("returns iCloud error instead of generic not found", async () => {
    vol.mkdirSync("/vault/icloud-partial-test", { recursive: true });
    vol.writeFileSync("/vault/icloud-partial-test/.data.md.icloud", "");

    const result = await readFilePartial("/vault/icloud-partial-test/data.md", config, {
      mode: "lines",
      start: 1,
    });

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text as string;
    expect(text).toContain("iCloud");
  });
});
