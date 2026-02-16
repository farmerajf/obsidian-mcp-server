import { describe, it, expect } from "vitest";
import { vol } from "memfs";
import { obsidianUrlToPath, pathToObsidianUrl } from "../tools/obsidian-url.js";
import type { Config } from "../config.js";
import "../__tests__/helpers/setup.js";

function createMultiVaultConfig(): Config {
  return {
    transport: "sse",
    port: 3000,
    apiKey: "test-api-key",
    paths: {
      personal: "/personal-vault",
      work: "/work-vault",
    },
  };
}

function getResult(result: { content: { type: string; text: string }[] }): unknown {
  const text = result.content[0]?.text;
  if (!text) return null;
  if (text.startsWith("Error:")) return { error: text };
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

describe("obsidianUrlToPath", () => {
  const config = createMultiVaultConfig();

  it("converts a valid Obsidian URL to a virtual path", async () => {
    const result = await obsidianUrlToPath(
      "obsidian://open?vault=personal&file=notes/todo",
      config
    );
    const data = getResult(result) as { path: string; obsidianUrl: string };

    expect(data.path).toBe("/personal/notes/todo.md");
    expect(data.obsidianUrl).toBe("obsidian://open?vault=personal&file=notes/todo");
  });

  it("appends .md when file has no extension", async () => {
    const result = await obsidianUrlToPath(
      "obsidian://open?vault=personal&file=index",
      config
    );
    const data = getResult(result) as { path: string };

    expect(data.path).toBe("/personal/index.md");
  });

  it("keeps non-.md extensions as-is", async () => {
    const result = await obsidianUrlToPath(
      "obsidian://open?vault=personal&file=attachments/image.png",
      config
    );
    const data = getResult(result) as { path: string };

    expect(data.path).toBe("/personal/attachments/image.png");
  });

  it("handles URL-encoded characters", async () => {
    const result = await obsidianUrlToPath(
      "obsidian://open?vault=personal&file=Base%20items%2FMy%20Note",
      config
    );
    const data = getResult(result) as { path: string };

    expect(data.path).toBe("/personal/Base items/My Note.md");
  });

  it("matches vault name case-insensitively", async () => {
    const result = await obsidianUrlToPath(
      "obsidian://open?vault=Personal&file=notes/todo",
      config
    );
    const data = getResult(result) as { path: string };

    expect(data.path).toBe("/personal/notes/todo.md");
  });

  it("returns error for unknown vault", async () => {
    const result = await obsidianUrlToPath(
      "obsidian://open?vault=unknown&file=test",
      config
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown vault");
  });

  it("returns error for non-open action", async () => {
    const result = await obsidianUrlToPath(
      "obsidian://search?vault=personal&query=test",
      config
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unsupported action: "search"');
  });

  it("returns error for non-obsidian URL", async () => {
    const result = await obsidianUrlToPath(
      "https://example.com?vault=personal&file=test",
      config
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid URL scheme");
  });

  it("returns error for missing vault parameter", async () => {
    const result = await obsidianUrlToPath(
      "obsidian://open?file=test",
      config
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Missing required 'vault' parameter");
  });

  it("returns error for missing file parameter", async () => {
    const result = await obsidianUrlToPath(
      "obsidian://open?vault=personal",
      config
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Missing required 'file' parameter");
  });
});

describe("pathToObsidianUrl", () => {
  const config = createMultiVaultConfig();

  beforeEach(() => {
    vol.fromJSON({
      "/personal-vault/notes/todo.md": "content",
      "/personal-vault/attachments/image.png": "image",
      "/personal-vault/Base items/My Note.md": "content",
      "/work-vault/projects/roadmap.md": "content",
    });
  });

  it("converts a virtual path to an Obsidian URL", async () => {
    const result = await pathToObsidianUrl("/personal/notes/todo.md", config);
    const data = getResult(result) as { obsidianUrl: string; path: string };

    expect(data.obsidianUrl).toBe("obsidian://open?vault=personal&file=notes%2Ftodo");
    expect(data.path).toBe("/personal/notes/todo.md");
  });

  it("strips .md extension from URL", async () => {
    const result = await pathToObsidianUrl("/work/projects/roadmap.md", config);
    const data = getResult(result) as { obsidianUrl: string };

    expect(data.obsidianUrl).toBe("obsidian://open?vault=work&file=projects%2Froadmap");
  });

  it("keeps non-.md extensions in URL", async () => {
    const result = await pathToObsidianUrl("/personal/attachments/image.png", config);
    const data = getResult(result) as { obsidianUrl: string };

    expect(data.obsidianUrl).toBe(
      "obsidian://open?vault=personal&file=attachments%2Fimage.png"
    );
  });

  it("encodes spaces in file path", async () => {
    const result = await pathToObsidianUrl("/personal/Base items/My Note.md", config);
    const data = getResult(result) as { obsidianUrl: string };

    expect(data.obsidianUrl).toBe(
      "obsidian://open?vault=personal&file=Base%20items%2FMy%20Note"
    );
  });

  it("returns error for vault root path", async () => {
    const result = await pathToObsidianUrl("/personal", config);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("vault root path");
  });

  it("returns error for invalid vault", async () => {
    const result = await pathToObsidianUrl("/nonexistent/file.md", config);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid vault name");
  });
});

describe("round-trip", () => {
  const config = createMultiVaultConfig();

  beforeEach(() => {
    vol.fromJSON({
      "/personal-vault/notes/daily/2024-01-01.md": "content",
      "/personal-vault/Base items/My Note.md": "content",
    });
  });

  it("path → URL → path preserves the path", async () => {
    const originalPath = "/personal/notes/daily/2024-01-01.md";

    const urlResult = await pathToObsidianUrl(originalPath, config);
    const { obsidianUrl } = getResult(urlResult) as { obsidianUrl: string };

    const pathResult = await obsidianUrlToPath(obsidianUrl, config);
    const { path } = getResult(pathResult) as { path: string };

    expect(path).toBe(originalPath);
  });

  it("round-trips paths with spaces", async () => {
    const originalPath = "/personal/Base items/My Note.md";

    const urlResult = await pathToObsidianUrl(originalPath, config);
    const { obsidianUrl } = getResult(urlResult) as { obsidianUrl: string };

    const pathResult = await obsidianUrlToPath(obsidianUrl, config);
    const { path } = getResult(pathResult) as { path: string };

    expect(path).toBe(originalPath);
  });
});
