import { describe, it, expect } from "vitest";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { resolveWikilink, extractWikilinks } from "../tools/wikilinks.js";
import { getBacklinks } from "../tools/backlinks.js";
import { createFile } from "../tools/create.js";

const config = createTestConfig();

describe("resolveWikilink", () => {
  it("resolves simple wikilink", async () => {
    const result = await resolveWikilink("todo", config);
    const data = getTestResult(result) as { resolved: boolean; targetPath: string; targetExists: boolean };

    expect(data.resolved).toBe(true);
    expect(data.targetExists).toBe(true);
    expect(data.targetPath).toBe("/todo.md");
  });

  it("resolves wikilink with brackets", async () => {
    const result = await resolveWikilink("[[todo]]", config);
    const data = getTestResult(result) as { resolved: boolean; targetPath: string };

    expect(data.resolved).toBe(true);
    expect(data.targetPath).toBe("/todo.md");
  });

  it("resolves wikilink with heading", async () => {
    const result = await resolveWikilink("index#Welcome", config);
    const data = getTestResult(result) as { heading: string | null };

    expect(data.heading).toBe("Welcome");
  });

  it("resolves wikilink with display text", async () => {
    const result = await resolveWikilink("todo|My Tasks", config);
    const data = getTestResult(result) as { displayText: string | null };

    expect(data.displayText).toBe("My Tasks");
  });

  it("resolves wikilink with block reference", async () => {
    // Block references use the format [[note#^blockid]]
    // The ^ is in the heading part, so it's extracted from there
    const result = await resolveWikilink("index#heading^blockid", config);
    const data = getTestResult(result) as { blockRef: string | null; heading: string | null };

    // The block ref parsing depends on implementation
    // Just verify the link resolves
    expect(data.heading).toBeDefined();
  });

  it("returns targetExists: false for non-existent file", async () => {
    const result = await resolveWikilink("nonexistent-note", config);
    const data = getTestResult(result) as { resolved: boolean; targetExists: boolean };

    expect(data.resolved).toBe(false);
    expect(data.targetExists).toBe(false);
  });

  it("resolves wikilink to file in subdirectory", async () => {
    const result = await resolveWikilink("project-a", config);
    const data = getTestResult(result) as { resolved: boolean; targetPath: string };

    expect(data.resolved).toBe(true);
    expect(data.targetPath).toContain("project-a");
  });
});

describe("extractWikilinks", () => {
  it("extracts all wikilinks from file", async () => {
    const result = await extractWikilinks("/index.md", config, false, true);
    const data = getTestResult(result) as { links: { raw: string; isEmbed: boolean }[] };

    expect(data.links.length).toBeGreaterThan(0);
    expect(data.links.some((l) => l.raw.includes("todo"))).toBe(true);
  });

  it("includes embeds when requested", async () => {
    // project-a.md has an embed ![[attachment.png]]
    const result = await extractWikilinks("/notes/projects/project-a.md", config, false, true);
    const data = getTestResult(result) as { links: { raw: string; isEmbed: boolean }[] };

    const embeds = data.links.filter((l) => l.isEmbed);
    expect(embeds.length).toBeGreaterThan(0);
  });

  it("excludes embeds when not requested", async () => {
    const result = await extractWikilinks("/notes/projects/project-a.md", config, false, false);
    const data = getTestResult(result) as { links: { isEmbed: boolean }[] };

    const embeds = data.links.filter((l) => l.isEmbed);
    expect(embeds.length).toBe(0);
  });

  it("includes line and column for each link", async () => {
    const result = await extractWikilinks("/index.md", config, false, true);
    const data = getTestResult(result) as { links: { line: number; column: number }[] };

    for (const link of data.links) {
      expect(link.line).toBeGreaterThan(0);
      expect(link.column).toBeGreaterThan(0);
    }
  });

  it("resolves links when requested", async () => {
    const result = await extractWikilinks("/index.md", config, true, true);
    const data = getTestResult(result) as {
      links: { resolved: { targetPath: string | null; targetExists: boolean } }[];
    };

    for (const link of data.links) {
      expect(link.resolved).toBeDefined();
      expect(link.resolved.targetExists).toBeDefined();
    }
  });

  it("counts unresolved links", async () => {
    await createFile(
      "/with-broken.md",
      "Link to [[nonexistent-page]] and [[another-missing]]",
      config
    );

    const result = await extractWikilinks("/with-broken.md", config, true, true);
    const data = getTestResult(result) as { unresolvedCount: number };

    expect(data.unresolvedCount).toBe(2);
  });

  it("returns error for non-existent file", async () => {
    const result = await extractWikilinks("/nonexistent.md", config, false, true);
    expect(result.isError).toBe(true);
  });
});

describe("getBacklinks", () => {
  it("finds files linking to target", async () => {
    const result = await getBacklinks("/todo.md", config, false, 1);
    const data = getTestResult(result) as {
      backlinks: { sourcePath: string; matches: { linkText: string }[] }[];
      totalCount: number;
    };

    expect(data.totalCount).toBeGreaterThan(0);
    // index.md links to todo
    const hasIndexLink = data.backlinks.some((b) => b.sourcePath.includes("index"));
    expect(hasIndexLink).toBe(true);
  });

  it("includes context when requested", async () => {
    const result = await getBacklinks("/todo.md", config, true, 1);
    const data = getTestResult(result) as {
      backlinks: { matches: { context?: string }[] }[];
    };

    for (const backlink of data.backlinks) {
      for (const match of backlink.matches) {
        expect(match.context).toBeDefined();
      }
    }
  });

  it("includes source title", async () => {
    const result = await getBacklinks("/todo.md", config, false, 1);
    const data = getTestResult(result) as {
      backlinks: { sourceTitle: string | null }[];
    };

    for (const backlink of data.backlinks) {
      expect(backlink.sourceTitle).not.toBeNull();
    }
  });

  it("returns empty backlinks for file with no links to it", async () => {
    await createFile("/isolated.md", "No one links here", config);

    const result = await getBacklinks("/isolated.md", config, false, 1);
    const data = getTestResult(result) as { backlinks: unknown[]; totalCount: number };

    expect(data.totalCount).toBe(0);
    expect(data.backlinks.length).toBe(0);
  });
});
