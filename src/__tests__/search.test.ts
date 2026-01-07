import { describe, it, expect } from "vitest";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { fuzzySearch } from "../tools/fuzzy.js";
import { searchByDate } from "../tools/dates.js";
import { createFile } from "../tools/create.js";

const config = createTestConfig();

describe("fuzzySearch", () => {
  it("finds exact filename match", async () => {
    const result = await fuzzySearch("index", config);
    const data = getTestResult(result) as { results: { path: string; score: number }[] };

    expect(data.results.length).toBeGreaterThan(0);
    // Exact match should have high score
    const indexMatch = data.results.find((r) => r.path === "/index.md");
    expect(indexMatch).toBeDefined();
    expect(indexMatch!.score).toBeGreaterThan(0.8);
  });

  it("finds partial filename match", async () => {
    const result = await fuzzySearch("proj", config);
    const data = getTestResult(result) as { results: { path: string; filename: string }[] };

    // Should find project files
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results.some((r) => r.filename.includes("project"))).toBe(true);
  });

  it("handles typos", async () => {
    // "indx" should still match "index"
    const result = await fuzzySearch("indx", config, undefined, 20, 0.3);
    const data = getTestResult(result) as { results: { path: string }[] };

    expect(data.results.some((r) => r.path.includes("index"))).toBe(true);
  });

  it("returns highlights", async () => {
    const result = await fuzzySearch("todo", config);
    const data = getTestResult(result) as {
      results: { highlights: { start: number; end: number }[] }[];
    };

    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].highlights.length).toBeGreaterThan(0);
  });

  it("respects threshold", async () => {
    const highThreshold = await fuzzySearch("xyz", config, undefined, 20, 0.9);
    const highData = getTestResult(highThreshold) as { results: unknown[] };

    // High threshold should filter out poor matches
    expect(highData.results.length).toBe(0);
  });

  it("limits results", async () => {
    const result = await fuzzySearch("a", config, undefined, 3, 0.1);
    const data = getTestResult(result) as { results: unknown[] };

    expect(data.results.length).toBeLessThanOrEqual(3);
  });

  it("searches within directory", async () => {
    const result = await fuzzySearch("project", config, "/notes/projects");
    const data = getTestResult(result) as { results: { path: string }[] };

    // All results should contain the searched name
    expect(data.results.length).toBeGreaterThan(0);
  });

  it("sorts by score descending", async () => {
    const result = await fuzzySearch("daily", config);
    const data = getTestResult(result) as { results: { score: number }[] };

    for (let i = 1; i < data.results.length; i++) {
      expect(data.results[i].score).toBeLessThanOrEqual(data.results[i - 1].score);
    }
  });
});

describe("searchByDate", () => {
  it("searches by modified date - relative today", async () => {
    // Create a file (will have "today" as modified date in tests)
    await createFile("/today-file.md", "Content", config);

    const result = await searchByDate("modified", { relative: "today" }, config);
    const data = getTestResult(result) as { results: { path: string }[] };

    // Should find the newly created file
    expect(data.results.some((r) => r.path.includes("today-file"))).toBe(true);
  });

  it("searches by frontmatter date field", async () => {
    const result = await searchByDate("date", { equals: "2024-01-01" }, config);
    const data = getTestResult(result) as { results: { path: string; date: string }[] };

    // Should find files with date: 2024-01-01 in frontmatter
    const foundDailyNote = data.results.some((r) => r.path.includes("2024-01-01"));
    expect(foundDailyNote).toBe(true);
  });

  it("searches with after condition", async () => {
    const result = await searchByDate("date", { after: "2024-01-01" }, config);
    const data = getTestResult(result) as { results: { date: string }[] };

    // All dates should be after 2024-01-01
    for (const r of data.results) {
      expect(new Date(r.date).getTime()).toBeGreaterThanOrEqual(new Date("2024-01-01").getTime());
    }
  });

  it("searches with before condition", async () => {
    const result = await searchByDate("date", { before: "2024-01-03" }, config);
    const data = getTestResult(result) as { results: { date: string }[] };

    // All dates should be before 2024-01-03
    for (const r of data.results) {
      expect(new Date(r.date).getTime()).toBeLessThanOrEqual(new Date("2024-01-02").getTime());
    }
  });

  it("searches with between condition", async () => {
    const result = await searchByDate("date", { between: ["2024-01-01", "2024-01-31"] }, config);
    const data = getTestResult(result) as { results: { date: string }[] };

    for (const r of data.results) {
      const date = new Date(r.date).getTime();
      expect(date).toBeGreaterThanOrEqual(new Date("2024-01-01").getTime());
      expect(date).toBeLessThanOrEqual(new Date("2024-01-31").getTime());
    }
  });

  it("sorts by date descending by default", async () => {
    const result = await searchByDate("date", { between: ["2024-01-01", "2024-12-31"] }, config);
    const data = getTestResult(result) as { results: { date: string }[] };

    for (let i = 1; i < data.results.length; i++) {
      expect(new Date(data.results[i].date).getTime()).toBeLessThanOrEqual(
        new Date(data.results[i - 1].date).getTime()
      );
    }
  });

  it("sorts by date ascending when requested", async () => {
    const result = await searchByDate(
      "date",
      { between: ["2024-01-01", "2024-12-31"] },
      config,
      undefined,
      "date",
      "asc"
    );
    const data = getTestResult(result) as { results: { date: string }[] };

    for (let i = 1; i < data.results.length; i++) {
      expect(new Date(data.results[i].date).getTime()).toBeGreaterThanOrEqual(
        new Date(data.results[i - 1].date).getTime()
      );
    }
  });

  it("limits results", async () => {
    const result = await searchByDate(
      "modified",
      { relative: "this_year" },
      config,
      undefined,
      "date",
      "desc",
      2
    );
    const data = getTestResult(result) as { results: unknown[] };

    expect(data.results.length).toBeLessThanOrEqual(2);
  });

  it("returns title from frontmatter or filename", async () => {
    const result = await searchByDate("date", { equals: "2024-01-01" }, config);
    const data = getTestResult(result) as { results: { title: string | null }[] };

    for (const r of data.results) {
      expect(r.title).not.toBeNull();
    }
  });
});
