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
    const indexMatch = data.results.find((r) => r.path === "/vault/index.md");
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
    const result = await fuzzySearch("project", config, "/vault/notes/projects");
    const data = getTestResult(result) as { results: { path: string }[] };

    // All results should contain the searched name
    expect(data.results.length).toBeGreaterThan(0);
  });

  it("returns full path when searching subdirectory", async () => {
    // Create a file in a subdirectory
    await createFile("/vault/notes/daily/search-test-file.md", "Test content", config);

    const result = await fuzzySearch("search-test", config, "/vault/notes/daily");
    const data = getTestResult(result) as { results: { path: string }[] };

    expect(data.results.length).toBeGreaterThan(0);
    // Critical: path should include the full subdirectory, not just /vault/search-test-file.md
    const found = data.results.find((r) => r.path.includes("search-test-file"));
    expect(found).toBeDefined();
    expect(found!.path).toBe("/vault/notes/daily/search-test-file.md");
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
    await createFile("/vault/today-file.md", "Content", config);

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

  it("returns full path when searching subdirectory", async () => {
    // Create a file in a subdirectory with a date in frontmatter
    await createFile(
      "/vault/notes/daily/date-search-test.md",
      `---
date: 2024-06-15
---

Test content`,
      config
    );

    const result = await searchByDate("date", { equals: "2024-06-15" }, config, "/vault/notes/daily");
    const data = getTestResult(result) as { results: { path: string }[] };

    expect(data.results.length).toBeGreaterThan(0);
    // Critical: path should include the full subdirectory
    const found = data.results.find((r) => r.path.includes("date-search-test"));
    expect(found).toBeDefined();
    expect(found!.path).toBe("/vault/notes/daily/date-search-test.md");
  });

  it("searches with relative: yesterday", async () => {
    const result = await searchByDate("modified", { relative: "yesterday" }, config);
    const data = getTestResult(result) as { results: unknown[] };
    // Just verify it doesn't error - files might or might not match
    expect(data.results).toBeDefined();
  });

  it("searches with relative: this_week", async () => {
    await createFile("/vault/week-test.md", "Content", config);
    const result = await searchByDate("modified", { relative: "this_week" }, config);
    const data = getTestResult(result) as { results: { path: string }[] };
    expect(data.results.some((r) => r.path.includes("week-test"))).toBe(true);
  });

  it("searches with relative: last_7_days", async () => {
    await createFile("/vault/week7-test.md", "Content", config);
    const result = await searchByDate("modified", { relative: "last_7_days" }, config);
    const data = getTestResult(result) as { results: { path: string }[] };
    expect(data.results.some((r) => r.path.includes("week7-test"))).toBe(true);
  });

  it("searches with relative: this_month", async () => {
    await createFile("/vault/month-test.md", "Content", config);
    const result = await searchByDate("modified", { relative: "this_month" }, config);
    const data = getTestResult(result) as { results: { path: string }[] };
    expect(data.results.some((r) => r.path.includes("month-test"))).toBe(true);
  });

  it("searches with relative: last_30_days", async () => {
    await createFile("/vault/month30-test.md", "Content", config);
    const result = await searchByDate("modified", { relative: "last_30_days" }, config);
    const data = getTestResult(result) as { results: { path: string }[] };
    expect(data.results.some((r) => r.path.includes("month30-test"))).toBe(true);
  });

  it("searches with relative: this_year", async () => {
    await createFile("/vault/year-test.md", "Content", config);
    const result = await searchByDate("modified", { relative: "this_year" }, config);
    const data = getTestResult(result) as { results: { path: string }[] };
    expect(data.results.some((r) => r.path.includes("year-test"))).toBe(true);
  });

  it("sorts by name", async () => {
    await createFile("/vault/z-dated.md", "---\ndate: 2024-03-01\n---\nContent", config);
    await createFile("/vault/a-dated.md", "---\ndate: 2024-03-02\n---\nContent", config);

    const result = await searchByDate(
      "date",
      { between: ["2024-03-01", "2024-03-31"] },
      config,
      undefined,
      "name",
      "asc"
    );
    const data = getTestResult(result) as { results: { title: string }[] };

    if (data.results.length >= 2) {
      expect(data.results[0].title.localeCompare(data.results[1].title)).toBeLessThanOrEqual(0);
    }
  });

  it("skips files with invalid frontmatter dates", async () => {
    await createFile(
      "/vault/bad-date.md",
      "---\ndate: not-a-date\n---\nContent",
      config
    );

    const result = await searchByDate("date", { equals: "not-a-date" }, config);
    const data = getTestResult(result) as { results: unknown[] };
    // Invalid date should not appear in results
    expect(data.results.length).toBe(0);
  });

  it("falls back to filename for title when no frontmatter title", async () => {
    await createFile(
      "/vault/no-title-date.md",
      "---\ndate: 2024-05-01\n---\nContent without title",
      config
    );

    const result = await searchByDate("date", { equals: "2024-05-01" }, config);
    const data = getTestResult(result) as { results: { title: string }[] };
    const found = data.results.find((r) => r.title === "no-title-date");
    expect(found).toBeDefined();
  });
});
