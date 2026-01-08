import { describe, it, expect } from "vitest";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { searchByTag, listAllTags } from "../tools/tags.js";
import { createFile } from "../tools/create.js";

const config = createTestConfig();

describe("searchByTag", () => {
  it("searches by single tag", async () => {
    const result = await searchByTag(["daily"], config, "any");
    const data = getTestResult(result) as { results: { path: string; matchedTags: string[] }[] };

    expect(data.results.length).toBeGreaterThan(0);
    // Daily notes should be found
    expect(data.results.some((r) => r.path.includes("2024-01-01"))).toBe(true);
  });

  it("searches by multiple tags with any match", async () => {
    const result = await searchByTag(["home", "daily"], config, "any");
    const data = getTestResult(result) as { results: { matchedTags: string[] }[] };

    // Should match files with either tag
    expect(data.results.length).toBeGreaterThan(0);
  });

  it("searches by multiple tags with all match", async () => {
    await createFile(
      "/vault/multi-tag.md",
      `---
title: Multi Tag
tags: [one, two]
---

Content`,
      config
    );

    const result = await searchByTag(["one", "two"], config, "all");
    const data = getTestResult(result) as { results: { matchedTags: string[] }[] };

    expect(data.results.length).toBeGreaterThan(0);
    // Each result should have both tags
    for (const r of data.results) {
      const hasOne = r.matchedTags.some((t) => t.toLowerCase() === "one");
      const hasTwo = r.matchedTags.some((t) => t.toLowerCase() === "two");
      expect(hasOne && hasTwo).toBe(true);
    }
  });

  it("searches frontmatter tags only", async () => {
    const result = await searchByTag(["tasks"], config, "any", undefined, "frontmatter");
    const data = getTestResult(result) as { results: { tagLocations: { location: string }[] }[] };

    // All matched tags should be from frontmatter
    for (const r of data.results) {
      for (const loc of r.tagLocations) {
        expect(loc.location).toBe("frontmatter");
      }
    }
  });

  it("searches inline tags only", async () => {
    const result = await searchByTag(["urgent"], config, "any", undefined, "body");
    const data = getTestResult(result) as { results: { tagLocations: { location: string }[] }[] };

    expect(data.results.length).toBeGreaterThan(0);
    // All matched tags should be from body
    for (const r of data.results) {
      for (const loc of r.tagLocations) {
        expect(loc.location).toBe("body");
      }
    }
  });

  it("includes tag locations with line numbers", async () => {
    const result = await searchByTag(["urgent"], config, "any", undefined, "body");
    const data = getTestResult(result) as {
      results: { tagLocations: { tag: string; location: string; line?: number }[] }[];
    };

    for (const r of data.results) {
      for (const loc of r.tagLocations) {
        if (loc.location === "body") {
          expect(loc.line).toBeGreaterThan(0);
        }
      }
    }
  });

  it("handles tags with # prefix", async () => {
    const result = await searchByTag(["#daily"], config, "any");
    const data = getTestResult(result) as { results: unknown[] };

    // Should still find files (# is stripped)
    expect(data.results.length).toBeGreaterThan(0);
  });

  it("returns empty results for non-existent tag", async () => {
    const result = await searchByTag(["nonexistent-tag-xyz"], config, "any");
    const data = getTestResult(result) as { results: unknown[]; totalMatches: number };

    expect(data.totalMatches).toBe(0);
    expect(data.results.length).toBe(0);
  });

  it("returns full path when searching subdirectory", async () => {
    // Create a file in a subdirectory with a specific tag
    await createFile(
      "/vault/notes/projects/tag-path-test.md",
      `---
tags: [unique-test-tag]
---

Content`,
      config
    );

    const result = await searchByTag(["unique-test-tag"], config, "any", "/vault/notes/projects");
    const data = getTestResult(result) as { results: { path: string }[] };

    expect(data.results.length).toBeGreaterThan(0);
    // Critical: path should include the full subdirectory
    const found = data.results.find((r) => r.path.includes("tag-path-test"));
    expect(found).toBeDefined();
    expect(found!.path).toBe("/vault/notes/projects/tag-path-test.md");
  });
});

describe("listAllTags", () => {
  it("lists all tags with counts", async () => {
    const result = await listAllTags(config);
    const data = getTestResult(result) as { tags: { tag: string; count: number }[]; totalTags: number };

    expect(data.totalTags).toBeGreaterThan(0);
    expect(data.tags.length).toBeGreaterThan(0);

    // Each tag should have a count
    for (const t of data.tags) {
      expect(t.count).toBeGreaterThan(0);
    }
  });

  it("sorts tags by count", async () => {
    const result = await listAllTags(config);
    const data = getTestResult(result) as { tags: { count: number }[] };

    for (let i = 1; i < data.tags.length; i++) {
      expect(data.tags[i].count).toBeLessThanOrEqual(data.tags[i - 1].count);
    }
  });

  it("filters by minimum count", async () => {
    const result = await listAllTags(config, undefined, 2);
    const data = getTestResult(result) as { tags: { count: number }[] };

    for (const t of data.tags) {
      expect(t.count).toBeGreaterThanOrEqual(2);
    }
  });

  it("includes both frontmatter and inline tags", async () => {
    const result = await listAllTags(config);
    const data = getTestResult(result) as { tags: { tag: string }[] };

    // Should find frontmatter tags (like 'daily', 'tasks')
    const tagNames = data.tags.map((t) => t.tag.toLowerCase());
    expect(tagNames).toContain("daily");
    expect(tagNames).toContain("tasks");

    // Should find inline tags (like 'urgent')
    expect(tagNames).toContain("urgent");
  });

  it("limits to specific directory", async () => {
    const result = await listAllTags(config, "/vault/notes/daily");
    const data = getTestResult(result) as { tags: { tag: string }[] };

    // Should find tags from daily notes
    const tagNames = data.tags.map((t) => t.tag.toLowerCase());
    expect(tagNames).toContain("daily");
  });
});
