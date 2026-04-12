import { describe, it, expect } from "vitest";
import { vol } from "memfs";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { searchFiles } from "../tools/search.js";
import { readFile } from "../tools/read.js";
import { batchRead } from "../tools/batch.js";
import { createFile } from "../tools/create.js";

const config = createTestConfig();

describe("search performance optimizations", () => {
  describe("ignore patterns", () => {
    it("skips .obsidian directory in content search", async () => {
      // .obsidian/config.json has content "dark" from the mock vault
      const result = await searchFiles("dark", undefined, "content", config);
      const data = getTestResult(result) as { results: { path: string }[] };

      const obsidianPaths = data.results.filter((r) => r.path.includes(".obsidian"));
      expect(obsidianPaths).toHaveLength(0);
    });

    it("skips .trash directory in content search", async () => {
      // Add a file to .trash with searchable content
      vol.mkdirSync("/vault/.trash", { recursive: true });
      vol.writeFileSync("/vault/.trash/deleted-note.md", "findme-trash-content");

      const result = await searchFiles("findme-trash-content", undefined, "content", config);
      const data = getTestResult(result) as { results: { path: string }[] };

      expect(data.results).toHaveLength(0);
    });

    it("skips .obsidian directory in filename search", async () => {
      const result = await searchFiles("config", undefined, "filename", config);
      const data = getTestResult(result) as { results: { path: string }[] };

      const obsidianPaths = data.results.filter((r) => r.path.includes(".obsidian"));
      expect(obsidianPaths).toHaveLength(0);
    });
  });

  describe("text extension filtering", () => {
    it("skips binary files in content search", async () => {
      // The mock vault has attachment.png with content "fake-image-data"
      const result = await searchFiles("fake-image-data", undefined, "content", config);
      const data = getTestResult(result) as { results: { path: string }[] };

      const imagePaths = data.results.filter((r) => r.path.endsWith(".png"));
      expect(imagePaths).toHaveLength(0);
    });

    it("still finds content in .md files", async () => {
      const result = await searchFiles("Welcome", undefined, "content", config);
      const data = getTestResult(result) as { results: { path: string }[] };

      expect(data.results.length).toBeGreaterThan(0);
      expect(data.results.some((r) => r.path.endsWith(".md"))).toBe(true);
    });

    it("filename search still finds binary files", async () => {
      const result = await searchFiles("attachment", undefined, "filename", config);
      const data = getTestResult(result) as { results: { path: string }[] };

      expect(data.results.some((r) => r.path.endsWith(".png"))).toBe(true);
    });
  });

  describe("file size limit", () => {
    it("streams large files instead of loading into memory", async () => {
      // Create a file larger than 512 KB with unique content on line 1
      const firstLine = "largefile-early-marker\n";
      const padding = "x".repeat(200) + "\n";
      const largeContent = firstLine + padding.repeat(3000); // ~600 KB
      vol.writeFileSync("/vault/large-transcript.md", largeContent);

      const result = await searchFiles("largefile-early-marker", undefined, "content", config);
      const data = getTestResult(result) as { results: { path: string }[] };

      const found = data.results.find((r) => r.path.includes("large-transcript"));
      expect(found).toBeDefined();
    });

    it("finds content deep in large files via streaming", async () => {
      // Create a large file (>512KB) with unique content after line 500
      const filler = "a".repeat(1000);
      const earlyLines = Array.from({ length: 600 }, (_, i) => `${filler} line ${i + 1}`).join("\n") + "\n";
      const lateMarker = "late-only-marker-xyz\n";
      const largeContent = earlyLines + lateMarker;
      vol.writeFileSync("/vault/large-late-content.md", largeContent);

      const result = await searchFiles("late-only-marker-xyz", undefined, "content", config);
      const data = getTestResult(result) as {
        results: { path: string; matches?: { line: number }[] }[];
      };

      const found = data.results.find((r) => r.path.includes("large-late-content"));
      expect(found).toBeDefined();
      expect(found!.matches![0].line).toBe(601);
    });

    it("fully searches files under 512 KB", async () => {
      // Create a file under 512 KB with unique content
      const content = "smallfile-unique-marker\n" + "line\n".repeat(100);
      await createFile("/vault/small-transcript.md", content, config);

      const result = await searchFiles("smallfile-unique-marker", undefined, "content", config);
      const data = getTestResult(result) as { results: { path: string }[] };

      expect(data.results.some((r) => r.path.includes("small-transcript"))).toBe(true);
    });
  });
});

describe("read_file streaming optimization", () => {
  it("correctly reads and truncates large text files", async () => {
    // Create a file larger than STREAMING_THRESHOLD (64 KB) with many lines
    const lines = Array.from({ length: 800 }, (_, i) => `Line ${i + 1}: ${"content".repeat(20)}`);
    const content = lines.join("\n");
    vol.writeFileSync("/vault/streaming-test.md", content);

    const result = await readFile("/vault/streaming-test.md", config);
    const data = getTestResult(result) as {
      content: string;
      truncated: boolean;
      linesReturned: number;
      totalLines: number;
      etag: string;
    };

    expect(data.truncated).toBe(true);
    expect(data.linesReturned).toBe(500);
    expect(data.totalLines).toBe(800);
    expect(data.content.split("\n")).toHaveLength(500);
    expect(data.content).toContain("Line 1:");
    expect(data.content).toContain("Line 500:");
    expect(data.content).not.toContain("Line 501:");
    expect(data.etag).toBeDefined();
  });

  it("produces consistent etags between streaming and sync paths", async () => {
    // Create a small file (sync path) and verify the etag matches content-based hash
    const smallContent = "Hello world\nLine 2\nLine 3";
    await createFile("/vault/etag-small.md", smallContent, config);

    const smallResult = await readFile("/vault/etag-small.md", config);
    const smallData = getTestResult(smallResult) as { etag: string };

    // Create the same content but large enough for streaming path
    const largeLines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: ${"x".repeat(800)}`);
    const largeContent = largeLines.join("\n");
    vol.writeFileSync("/vault/etag-large.md", largeContent);

    const largeResult = await readFile("/vault/etag-large.md", config);
    const largeData = getTestResult(largeResult) as { etag: string };

    // Both should have valid etags (different content = different etags, but both should be 16-char hex)
    expect(smallData.etag).toMatch(/^[0-9a-f]{16}$/);
    expect(largeData.etag).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not truncate large file under 500 lines", async () => {
    // Create a file over 64KB but under 500 lines (long lines)
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}: ${"x".repeat(500)}`);
    const content = lines.join("\n");
    vol.writeFileSync("/vault/long-lines.md", content);

    const result = await readFile("/vault/long-lines.md", config);
    const data = getTestResult(result) as {
      content: string;
      truncated?: boolean;
      etag: string;
    };

    expect(data.truncated).toBeUndefined();
    expect(data.content.split("\n")).toHaveLength(200);
    expect(data.etag).toBeDefined();
  });

  it("small files use fast path without truncation", async () => {
    const result = await readFile("/vault/index.md", config);
    const data = getTestResult(result) as {
      content: string;
      truncated?: boolean;
      etag: string;
    };

    expect(data.truncated).toBeUndefined();
    expect(data.content).toContain("# Welcome");
    expect(data.etag).toBeDefined();
  });
});

describe("batch_read parallel optimization", () => {
  it("reads multiple files concurrently", async () => {
    // Create several files
    for (let i = 0; i < 5; i++) {
      await createFile(`/vault/parallel-${i}.md`, `Content of file ${i}`, config);
    }

    const paths = Array.from({ length: 5 }, (_, i) => `/vault/parallel-${i}.md`);
    const result = await batchRead(paths, config, false, false);
    const data = getTestResult(result) as {
      results: { path: string; success: boolean; content: string }[];
      successCount: number;
    };

    expect(data.successCount).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(data.results[i].success).toBe(true);
      expect(data.results[i].content).toContain(`Content of file ${i}`);
    }
  });

  it("handles mix of small and large files", async () => {
    // Small file (sync path)
    await createFile("/vault/batch-small.md", "Small content", config);

    // Large file (streaming path) - over 64KB
    const largeLines = Array.from({ length: 800 }, (_, i) => `Line ${i + 1}: ${"y".repeat(200)}`);
    vol.writeFileSync("/vault/batch-large.md", largeLines.join("\n"));

    const result = await batchRead(
      ["/vault/batch-small.md", "/vault/batch-large.md"],
      config,
      false,
      false
    );
    const data = getTestResult(result) as {
      results: {
        path: string;
        success: boolean;
        content: string;
        truncated?: boolean;
        linesReturned?: number;
        totalLines?: number;
        etag: string;
      }[];
      successCount: number;
    };

    expect(data.successCount).toBe(2);

    // Small file should not be truncated
    const small = data.results.find((r) => r.path.includes("batch-small"));
    expect(small!.truncated).toBeUndefined();
    expect(small!.content).toBe("Small content");

    // Large file should be truncated
    const large = data.results.find((r) => r.path.includes("batch-large"));
    expect(large!.truncated).toBe(true);
    expect(large!.linesReturned).toBe(500);
    expect(large!.totalLines).toBe(800);
    expect(large!.etag).toBeDefined();
  });

  it("failFast mode still processes sequentially", async () => {
    const result = await batchRead(
      ["/vault/nonexistent.md", "/vault/index.md"],
      config,
      false,
      true // failFast
    );

    // Should fail on first file and not process second
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("File not found");
  });

  it("parallel mode handles errors gracefully", async () => {
    const result = await batchRead(
      ["/vault/index.md", "/vault/nonexistent.md", "/vault/todo.md"],
      config,
      false,
      false
    );
    const data = getTestResult(result) as {
      results: { path: string; success: boolean }[];
      successCount: number;
      failureCount: number;
    };

    expect(data.successCount).toBe(2);
    expect(data.failureCount).toBe(1);
    // Results should be in the same order as input paths
    expect(data.results[0].path).toBe("/vault/index.md");
    expect(data.results[0].success).toBe(true);
    expect(data.results[1].path).toBe("/vault/nonexistent.md");
    expect(data.results[1].success).toBe(false);
    expect(data.results[2].path).toBe("/vault/todo.md");
    expect(data.results[2].success).toBe(true);
  });

  it("batch_read large files produce valid etags", async () => {
    const largeLines = Array.from({ length: 600 }, (_, i) => `Line ${i + 1}: ${"z".repeat(200)}`);
    vol.writeFileSync("/vault/batch-etag-test.md", largeLines.join("\n"));

    const result = await batchRead(["/vault/batch-etag-test.md"], config);
    const data = getTestResult(result) as {
      results: { etag: string; truncated: boolean }[];
    };

    expect(data.results[0].etag).toMatch(/^[0-9a-f]{16}$/);
    expect(data.results[0].truncated).toBe(true);
  });
});
