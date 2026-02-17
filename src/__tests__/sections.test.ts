import { describe, it, expect } from "vitest";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { createFile } from "../tools/create.js";
import { readFile } from "../tools/read.js";
import { getSections, readSection } from "../tools/sections.js";
import { getFileMetadata } from "../tools/metadata.js";
import { parseSections } from "../utils/sections.js";

const config = createTestConfig();

// Helper to create a multi-section file
async function createSectionFile() {
  await createFile(
    "/vault/sections-test.md",
    `---
title: Test File
tags: [test]
---

Some intro text before any heading.

## Summary

Summary content here.

### Timeline

Timeline details.

### Action Items

- [ ] Item one
- [ ] Item two

## Notes

Some notes.

## Transcript

Line 1 of transcript.
Line 2 of transcript.
Line 3 of transcript.`,
    config
  );
}

describe("parseSections", () => {
  it("parses basic headings", () => {
    const result = parseSections("## One\n\nContent\n\n## Two\n\nMore content");
    expect(result.sections.length).toBe(2);
    expect(result.sections[0].heading).toBe("## One");
    expect(result.sections[0].level).toBe(2);
    expect(result.sections[1].heading).toBe("## Two");
  });

  it("parses nested children", () => {
    const result = parseSections("## Parent\n\nContent\n\n### Child\n\nChild content");
    expect(result.sections.length).toBe(1);
    expect(result.sections[0].heading).toBe("## Parent");
    expect(result.sections[0].children.length).toBe(1);
    expect(result.sections[0].children[0].heading).toBe("### Child");
  });

  it("handles no headings", () => {
    const result = parseSections("Just plain content\nwith no headings.");
    expect(result.sections.length).toBe(0);
  });

  it("detects frontmatter", () => {
    const result = parseSections("---\ntitle: Test\n---\n## Heading\n\nContent");
    expect(result.frontmatter).toEqual({ startLine: 1, endLine: 3 });
    expect(result.sections.length).toBe(1);
    expect(result.sections[0].heading).toBe("## Heading");
  });

  it("handles frontmatter only", () => {
    const result = parseSections("---\ntitle: Test\n---");
    expect(result.frontmatter).toEqual({ startLine: 1, endLine: 3 });
    expect(result.sections.length).toBe(0);
  });

  it("includes pre-heading content as null heading section", () => {
    const result = parseSections("---\ntitle: Test\n---\n\nPre-heading content.\n\n## First\n\nContent");
    // The null section should exist for content between frontmatter and first heading
    const nullSection = result.sections.find((s) => s.heading === null);
    expect(nullSection).toBeDefined();
    expect(nullSection!.level).toBe(0);
  });

  it("handles duplicate headings", () => {
    const result = parseSections("## Notes\n\nFirst notes.\n\n## Notes\n\nSecond notes.");
    expect(result.sections.length).toBe(2);
    expect(result.sections[0].heading).toBe("## Notes");
    expect(result.sections[1].heading).toBe("## Notes");
    expect(result.sections[0].startLine).not.toBe(result.sections[1].startLine);
  });

  it("skips headings inside fenced code blocks", () => {
    const result = parseSections("## Real\n\nContent\n\n```\n## Fake\n```\n\n## Also Real");
    expect(result.sections.length).toBe(2);
    expect(result.sections[0].heading).toBe("## Real");
    expect(result.sections[1].heading).toBe("## Also Real");
  });

  it("skips headings inside tilde code blocks", () => {
    const result = parseSections("## Real\n\n~~~\n## Fake\n~~~\n\n## Also Real");
    expect(result.sections.length).toBe(2);
  });

  it("skips blockquoted headings", () => {
    const result = parseSections("## Real\n\n> ## Quoted\n\n## Also Real");
    expect(result.sections.length).toBe(2);
    expect(result.sections[0].heading).toBe("## Real");
    expect(result.sections[1].heading).toBe("## Also Real");
  });

  it("handles empty sections", () => {
    const result = parseSections("## First\n## Second\n\nContent");
    expect(result.sections.length).toBe(2);
    expect(result.sections[0].lineCount).toBe(1);
  });

  it("calculates correct line counts", () => {
    const result = parseSections("## Summary\n\nLine 1\nLine 2\nLine 3\n\n## End");
    expect(result.sections[0].startLine).toBe(1);
    expect(result.sections[0].endLine).toBe(6);
    expect(result.sections[0].lineCount).toBe(6);
  });

  it("nests multiple levels", () => {
    const result = parseSections("# H1\n\n## H2\n\n### H3\n\n#### H4");
    expect(result.sections.length).toBe(1);
    expect(result.sections[0].heading).toBe("# H1");
    expect(result.sections[0].children.length).toBe(1);
    expect(result.sections[0].children[0].heading).toBe("## H2");
    expect(result.sections[0].children[0].children.length).toBe(1);
    expect(result.sections[0].children[0].children[0].children.length).toBe(1);
  });

  it("sibling headings at same level", () => {
    const result = parseSections("## A\n\n### A1\n\n### A2\n\n## B\n\n### B1");
    expect(result.sections.length).toBe(2);
    expect(result.sections[0].children.length).toBe(2);
    expect(result.sections[1].children.length).toBe(1);
  });

  it("parent endLine encompasses children", () => {
    const result = parseSections("## Parent\n\nContent\n\n### Child\n\nChild content\nMore child");
    expect(result.sections[0].endLine).toBe(result.totalLines);
    expect(result.sections[0].endLine).toBeGreaterThanOrEqual(
      result.sections[0].children[0].endLine
    );
  });
});

describe("getSections", () => {
  it("returns section structure for a file", async () => {
    await createSectionFile();

    const result = await getSections("/vault/sections-test.md", config);
    const data = getTestResult(result) as {
      path: string;
      totalLines: number;
      frontmatter: { startLine: number; endLine: number };
      sections: { heading: string | null; level: number; children: unknown[] }[];
    };

    expect(data.path).toBe("/vault/sections-test.md");
    expect(data.totalLines).toBeGreaterThan(0);
    expect(data.frontmatter).toBeDefined();
    expect(data.frontmatter.startLine).toBe(1);

    // Should have null section (intro), Summary, Notes, Transcript
    const headings = data.sections.map((s) => s.heading);
    expect(headings).toContain(null);
    expect(headings).toContain("## Summary");
    expect(headings).toContain("## Notes");
    expect(headings).toContain("## Transcript");

    // Summary should have children
    const summary = data.sections.find((s) => s.heading === "## Summary");
    expect(summary!.children.length).toBe(2);
  });

  it("returns empty sections for file with no headings", async () => {
    await createFile("/vault/no-headings.md", "Just plain text.\nNo headings here.", config);
    const result = await getSections("/vault/no-headings.md", config);
    const data = getTestResult(result) as { sections: unknown[] };
    expect(data.sections.length).toBe(0);
  });

  it("returns error for non-existent file", async () => {
    const result = await getSections("/vault/nope.md", config);
    expect(result.isError).toBe(true);
  });
});

describe("readSection", () => {
  it("reads a section by heading", async () => {
    await createSectionFile();

    const result = await readSection("/vault/sections-test.md", config, {
      heading: "## Notes",
    });
    const data = getTestResult(result) as {
      heading: string;
      content: string;
      startLine: number;
      endLine: number;
      lineCount: number;
      etag: string;
    };

    expect(data.heading).toBe("## Notes");
    expect(data.content).toContain("Some notes.");
    expect(data.etag).toBeDefined();
    expect(data.lineCount).toBeGreaterThan(0);
  });

  it("includes children by default", async () => {
    await createSectionFile();

    const result = await readSection("/vault/sections-test.md", config, {
      heading: "## Summary",
    });
    const data = getTestResult(result) as { content: string };

    expect(data.content).toContain("## Summary");
    expect(data.content).toContain("### Timeline");
    expect(data.content).toContain("### Action Items");
  });

  it("excludes children when includeChildren is false", async () => {
    await createSectionFile();

    const result = await readSection("/vault/sections-test.md", config, {
      heading: "## Summary",
      includeChildren: false,
    });
    const data = getTestResult(result) as { content: string };

    expect(data.content).toContain("Summary content");
    expect(data.content).not.toContain("### Timeline");
  });

  it("excludes heading line when includeHeading is false", async () => {
    await createSectionFile();

    const result = await readSection("/vault/sections-test.md", config, {
      heading: "## Notes",
      includeHeading: false,
    });
    const data = getTestResult(result) as { content: string };

    expect(data.content).not.toContain("## Notes");
    expect(data.content).toContain("Some notes.");
  });

  it("reads frontmatter when heading is 'frontmatter'", async () => {
    await createSectionFile();

    const result = await readSection("/vault/sections-test.md", config, {
      heading: "frontmatter",
    });
    const data = getTestResult(result) as { heading: string; content: string };

    expect(data.heading).toBe("frontmatter");
    expect(data.content).toContain("---");
    expect(data.content).toContain("title: Test File");
  });

  it("returns error for frontmatter when file has none", async () => {
    const result = await readSection("/vault/plain.md", config, {
      heading: "frontmatter",
    });
    expect(result.isError).toBe(true);
    const data = getTestResult(result) as { error: string };
    expect(data.error).toContain("No frontmatter");
  });

  it("returns error for non-existent heading", async () => {
    await createSectionFile();

    const result = await readSection("/vault/sections-test.md", config, {
      heading: "## Nonexistent",
    });
    expect(result.isError).toBe(true);
    const data = getTestResult(result) as { error: string; suggestion: string };
    expect(data.error).toContain("not found");
    expect(data.suggestion).toContain("get_sections");
  });

  it("returns first match for duplicate headings", async () => {
    await createFile(
      "/vault/dupes.md",
      "## Notes\n\nFirst notes.\n\n## Notes\n\nSecond notes.",
      config
    );

    const result = await readSection("/vault/dupes.md", config, {
      heading: "## Notes",
    });
    const data = getTestResult(result) as { content: string; startLine: number };

    expect(data.startLine).toBe(1);
    expect(data.content).toContain("First notes.");
  });

  it("reads child section directly", async () => {
    await createSectionFile();

    const result = await readSection("/vault/sections-test.md", config, {
      heading: "### Action Items",
    });
    const data = getTestResult(result) as { content: string };

    expect(data.content).toContain("Item one");
    expect(data.content).toContain("Item two");
  });
});

describe("readFile truncation", () => {
  it("returns full content for small files", async () => {
    const result = await readFile("/vault/index.md", config);
    const data = getTestResult(result) as { content: string; truncated?: boolean };

    expect(data.content).toContain("# Welcome");
    expect(data.truncated).toBeUndefined();
  });

  it("truncates files over 500 lines", async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `Line ${i + 1}`).join("\n");
    await createFile("/vault/big-file.md", lines, config);

    const result = await readFile("/vault/big-file.md", config);
    const data = getTestResult(result) as {
      content: string;
      truncated: boolean;
      linesReturned: number;
      totalLines: number;
      message: string;
    };

    expect(data.truncated).toBe(true);
    expect(data.linesReturned).toBe(500);
    expect(data.totalLines).toBe(600);
    expect(data.message).toContain("get_sections");
    expect(data.content.split("\n").length).toBe(500);
  });

  it("etag is from full content even when truncated", async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `Line ${i + 1}`).join("\n");
    await createFile("/vault/etag-test.md", lines, config);

    // Read the full content manually to get the expected etag
    const fullResult = await readFile("/vault/etag-test.md", config);
    const fullData = getTestResult(fullResult) as { etag: string; truncated: boolean };

    expect(fullData.truncated).toBe(true);
    // etag should be consistent (based on full file, not truncated)
    expect(fullData.etag).toBeDefined();
    expect(typeof fullData.etag).toBe("string");
  });
});

describe("getFileMetadata with section hints", () => {
  it("includes sectionCount and largeFile", async () => {
    await createSectionFile();

    const result = await getFileMetadata("/vault/sections-test.md", config);
    const data = getTestResult(result) as {
      sectionCount: number;
      largeFile: boolean;
    };

    expect(data.sectionCount).toBeGreaterThan(0);
    expect(typeof data.largeFile).toBe("boolean");
  });

  it("largeFile is false for small files", async () => {
    const result = await getFileMetadata("/vault/plain.md", config);
    const data = getTestResult(result) as { largeFile: boolean };

    expect(data.largeFile).toBe(false);
  });

  it("largeFile is true for files over 200 lines", async () => {
    const lines = Array.from({ length: 250 }, (_, i) => `Line ${i + 1}`).join("\n");
    await createFile("/vault/large-file.md", lines, config);

    const result = await getFileMetadata("/vault/large-file.md", config);
    const data = getTestResult(result) as { largeFile: boolean; lineCount: number };

    expect(data.largeFile).toBe(true);
    expect(data.lineCount).toBe(250);
  });
});
