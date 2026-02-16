import { describe, it, expect } from "vitest";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { resolveUrlToPath, resolvePathOrUrl } from "../utils/resolve-url.js";
import { readFile } from "../tools/read.js";
import { createFile } from "../tools/create.js";
import { getFrontmatter } from "../tools/frontmatter.js";
import { getFileMetadata } from "../tools/metadata.js";

const config = createTestConfig();

describe("resolveUrlToPath", () => {
  it("resolves a basic obsidian URL to path", () => {
    const path = resolveUrlToPath("obsidian://open?vault=vault&file=index", config);
    expect(path).toBe("/vault/index.md");
  });

  it("preserves existing extension", () => {
    const path = resolveUrlToPath("obsidian://open?vault=vault&file=attachments/image.png", config);
    expect(path).toBe("/vault/attachments/image.png");
  });

  it("handles nested file paths", () => {
    const path = resolveUrlToPath("obsidian://open?vault=vault&file=notes/daily/2024-01-01", config);
    expect(path).toBe("/vault/notes/daily/2024-01-01.md");
  });

  it("matches vault name case-insensitively", () => {
    const path = resolveUrlToPath("obsidian://open?vault=VAULT&file=index", config);
    expect(path).toBe("/vault/index.md");
  });

  it("throws on invalid protocol", () => {
    expect(() => resolveUrlToPath("https://example.com", config)).toThrow("Invalid URL scheme");
  });

  it("throws on unsupported action", () => {
    expect(() => resolveUrlToPath("obsidian://new?vault=vault&file=test", config)).toThrow(
      "Unsupported action"
    );
  });

  it("throws on missing vault param", () => {
    expect(() => resolveUrlToPath("obsidian://open?file=test", config)).toThrow(
      "Missing required 'vault'"
    );
  });

  it("throws on missing file param", () => {
    expect(() => resolveUrlToPath("obsidian://open?vault=vault", config)).toThrow(
      "Missing required 'file'"
    );
  });

  it("throws on unknown vault", () => {
    expect(() => resolveUrlToPath("obsidian://open?vault=unknown&file=test", config)).toThrow(
      "Unknown vault"
    );
  });

  it("handles URL-encoded spaces", () => {
    const path = resolveUrlToPath("obsidian://open?vault=vault&file=my%20notes/test%20file", config);
    expect(path).toBe("/vault/my notes/test file.md");
  });
});

describe("resolvePathOrUrl", () => {
  it("returns path when path is provided", () => {
    expect(resolvePathOrUrl("/vault/index.md", undefined, config)).toBe("/vault/index.md");
  });

  it("resolves url when only url is provided", () => {
    expect(resolvePathOrUrl(undefined, "obsidian://open?vault=vault&file=index", config)).toBe(
      "/vault/index.md"
    );
  });

  it("path takes precedence over url", () => {
    expect(
      resolvePathOrUrl("/vault/todo.md", "obsidian://open?vault=vault&file=index", config)
    ).toBe("/vault/todo.md");
  });

  it("throws when neither is provided", () => {
    expect(() => resolvePathOrUrl(undefined, undefined, config)).toThrow(
      "Either 'path' or 'url' is required"
    );
  });
});

describe("tools accept url param", () => {
  it("read_file works with obsidian URL", async () => {
    const result = await readFile(
      resolvePathOrUrl(undefined, "obsidian://open?vault=vault&file=index", config),
      config
    );
    const data = getTestResult(result) as { path: string; content: string };

    expect(data.path).toBe("/vault/index.md");
    expect(data.content).toContain("# Welcome");
  });

  it("get_frontmatter works with obsidian URL", async () => {
    const result = await getFrontmatter(
      resolvePathOrUrl(undefined, "obsidian://open?vault=vault&file=todo", config),
      config
    );
    const data = getTestResult(result) as { frontmatter: { title: string } };

    expect(data.frontmatter.title).toBe("Todo List");
  });

  it("get_file_metadata works with obsidian URL", async () => {
    const result = await getFileMetadata(
      resolvePathOrUrl(undefined, "obsidian://open?vault=vault&file=index", config),
      config
    );
    const data = getTestResult(result) as { exists: boolean; hasFrontmatter: boolean };

    expect(data.exists).toBe(true);
    expect(data.hasFrontmatter).toBe(true);
  });

  it("create_file works with obsidian URL", async () => {
    const path = resolvePathOrUrl(
      undefined,
      "obsidian://open?vault=vault&file=url-created-file",
      config
    );
    const result = await createFile(path, "Created via URL", config);
    const data = getTestResult(result) as { success: boolean };
    expect(data.success).toBe(true);

    // Verify file was created at resolved path
    const readResult = await readFile("/vault/url-created-file.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toBe("Created via URL");
  });
});
