import { describe, it, expect } from "vitest";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { getFrontmatter, updateFrontmatter } from "../tools/frontmatter.js";
import { readFile } from "../tools/read.js";
import { createFile } from "../tools/create.js";

const config = createTestConfig();

describe("getFrontmatter", () => {
  it("extracts frontmatter from file", async () => {
    const result = await getFrontmatter("/vault/index.md", config);
    const data = getTestResult(result) as {
      hasFrontmatter: boolean;
      frontmatter: { title: string; tags: string[] };
      raw: string;
    };

    expect(data.hasFrontmatter).toBe(true);
    expect(data.frontmatter.title).toBe("Home");
    expect(data.frontmatter.tags).toContain("home");
    expect(data.frontmatter.tags).toContain("index");
    expect(data.raw).toContain("title: Home");
  });

  it("returns hasFrontmatter: false for file without frontmatter", async () => {
    const result = await getFrontmatter("/vault/plain.md", config);
    const data = getTestResult(result) as { hasFrontmatter: boolean; frontmatter: unknown };

    expect(data.hasFrontmatter).toBe(false);
    expect(data.frontmatter).toBeNull();
  });

  it("parses various YAML types", async () => {
    await createFile(
      "/vault/yaml-types.md",
      `---
string: hello
number: 42
boolean: true
date: 2024-01-01
array: [a, b, c]
---

Content`,
      config
    );

    const result = await getFrontmatter("/vault/yaml-types.md", config);
    const data = getTestResult(result) as {
      frontmatter: {
        string: string;
        number: number;
        boolean: boolean;
        date: string;
        array: string[];
      };
    };

    expect(data.frontmatter.string).toBe("hello");
    expect(data.frontmatter.number).toBe(42);
    expect(data.frontmatter.boolean).toBe(true);
    expect(data.frontmatter.date).toBe("2024-01-01");
    expect(data.frontmatter.array).toEqual(["a", "b", "c"]);
  });

  it("returns error for non-existent file", async () => {
    const result = await getFrontmatter("/vault/nonexistent.md", config);
    expect(result.isError).toBe(true);
  });
});

describe("updateFrontmatter", () => {
  it("updates existing frontmatter fields", async () => {
    await createFile(
      "/vault/update-fm.md",
      `---
title: Old Title
status: draft
---

Content`,
      config
    );

    const result = await updateFrontmatter(
      "/vault/update-fm.md",
      { title: "New Title", status: "published" },
      config
    );
    const data = getTestResult(result) as { success: boolean; frontmatter: { title: string; status: string } };

    expect(data.success).toBe(true);
    expect(data.frontmatter.title).toBe("New Title");
    expect(data.frontmatter.status).toBe("published");

    // Verify file content
    const readResult = await readFile("/vault/update-fm.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toContain("title: New Title");
  });

  it("adds new frontmatter fields", async () => {
    await createFile(
      "/vault/add-fm.md",
      `---
title: Test
---

Content`,
      config
    );

    const result = await updateFrontmatter(
      "/vault/add-fm.md",
      { author: "Test Author", category: "notes" },
      config
    );
    const data = getTestResult(result) as {
      success: boolean;
      frontmatter: { title: string; author: string; category: string };
    };

    expect(data.success).toBe(true);
    expect(data.frontmatter.author).toBe("Test Author");
    expect(data.frontmatter.category).toBe("notes");
    // Original field should still exist
    expect(data.frontmatter.title).toBe("Test");
  });

  it("removes specified keys", async () => {
    await createFile(
      "/vault/remove-fm.md",
      `---
title: Test
toRemove: value
keep: me
---

Content`,
      config
    );

    const result = await updateFrontmatter("/vault/remove-fm.md", {}, config, ["toRemove"]);
    const data = getTestResult(result) as { success: boolean; frontmatter: Record<string, unknown> };

    expect(data.success).toBe(true);
    expect(data.frontmatter.toRemove).toBeUndefined();
    expect(data.frontmatter.keep).toBe("me");
  });

  it("creates frontmatter on file without it", async () => {
    await createFile("/vault/no-fm.md", "Just content\nNo frontmatter", config);

    const result = await updateFrontmatter("/vault/no-fm.md", { title: "Added Title" }, config);
    const data = getTestResult(result) as { success: boolean; frontmatter: { title: string } };

    expect(data.success).toBe(true);
    expect(data.frontmatter.title).toBe("Added Title");

    const readResult = await readFile("/vault/no-fm.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toMatch(/^---\n/);
    expect(readData.content).toContain("Just content");
  });

  it("detects ETag conflict", async () => {
    await createFile(
      "/vault/etag-fm.md",
      `---
title: Test
---

Content`,
      config
    );

    const result = await updateFrontmatter(
      "/vault/etag-fm.md",
      { title: "New Title" },
      config,
      undefined,
      "wrong-etag"
    );

    expect(result.isError).toBe(true);
    const data = getTestResult(result) as { error: string };
    expect(data.error).toBe("Conflict detected");
  });

  it("returns error for non-existent file", async () => {
    const result = await updateFrontmatter("/vault/nonexistent.md", { title: "Test" }, config);
    expect(result.isError).toBe(true);
  });

  it("serializes values with special characters", async () => {
    await createFile("/vault/special-fm.md", "---\ntitle: Test\n---\n\nContent", config);

    const result = await updateFrontmatter(
      "/vault/special-fm.md",
      { description: "has: colon", note: "has # hash", multi: "line\nbreak" },
      config
    );
    const data = getTestResult(result) as { success: boolean };
    expect(data.success).toBe(true);

    const readResult = await readFile("/vault/special-fm.md", config);
    const readData = getTestResult(readResult) as { content: string };
    // Values with special chars should be quoted
    expect(readData.content).toContain('"has: colon"');
    expect(readData.content).toContain('"has # hash"');
  });

  it("serializes empty arrays", async () => {
    await createFile("/vault/empty-arr-fm.md", "---\ntitle: Test\n---\n\nContent", config);

    const result = await updateFrontmatter(
      "/vault/empty-arr-fm.md",
      { tags: [] },
      config
    );
    const data = getTestResult(result) as { success: boolean };
    expect(data.success).toBe(true);

    const readResult = await readFile("/vault/empty-arr-fm.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toContain("tags: []");
  });

  it("serializes nested objects", async () => {
    await createFile("/vault/nested-fm.md", "---\ntitle: Test\n---\n\nContent", config);

    const result = await updateFrontmatter(
      "/vault/nested-fm.md",
      { metadata: { author: "Alice", year: 2024 } },
      config
    );
    const data = getTestResult(result) as { success: boolean; frontmatter: Record<string, unknown> };
    expect(data.success).toBe(true);
    expect(data.frontmatter.metadata).toEqual({ author: "Alice", year: 2024 });
  });

  it("serializes arrays with object items", async () => {
    await createFile("/vault/arr-obj-fm.md", "---\ntitle: Test\n---\n\nContent", config);

    const result = await updateFrontmatter(
      "/vault/arr-obj-fm.md",
      { items: [{ name: "a" }, { name: "b" }] },
      config
    );
    const data = getTestResult(result) as { success: boolean };
    expect(data.success).toBe(true);
  });

  it("serializes null and boolean values", async () => {
    await createFile("/vault/types-fm.md", "---\ntitle: Test\n---\n\nContent", config);

    const result = await updateFrontmatter(
      "/vault/types-fm.md",
      { draft: true, published: false, deprecated: null },
      config
    );
    const data = getTestResult(result) as { success: boolean; frontmatter: Record<string, unknown> };
    expect(data.success).toBe(true);
    expect(data.frontmatter.draft).toBe(true);
    expect(data.frontmatter.published).toBe(false);
    expect(data.frontmatter.deprecated).toBeNull();
  });
});

describe("parseYaml edge cases", () => {
  it("parses multiline YAML list (- items)", async () => {
    await createFile(
      "/vault/multiline-yaml.md",
      `---
title: Test
tags:
  - alpha
  - beta
  - gamma
---

Content`,
      config
    );

    const result = await getFrontmatter("/vault/multiline-yaml.md", config);
    const data = getTestResult(result) as { frontmatter: { tags: string[] } };
    expect(data.frontmatter.tags).toEqual(["alpha", "beta", "gamma"]);
  });

  it("parses quoted values", async () => {
    await createFile(
      "/vault/quoted-yaml.md",
      `---
title: "Hello World"
author: 'Jane Doe'
---

Content`,
      config
    );

    const result = await getFrontmatter("/vault/quoted-yaml.md", config);
    const data = getTestResult(result) as { frontmatter: { title: string; author: string } };
    expect(data.frontmatter.title).toBe("Hello World");
    expect(data.frontmatter.author).toBe("Jane Doe");
  });

  it("parses null and tilde values", async () => {
    await createFile(
      "/vault/null-yaml.md",
      `---
empty: null
also_empty: ~
---

Content`,
      config
    );

    const result = await getFrontmatter("/vault/null-yaml.md", config);
    const data = getTestResult(result) as { frontmatter: Record<string, unknown> };
    expect(data.frontmatter.empty).toBeNull();
    expect(data.frontmatter.also_empty).toBeNull();
  });
});
