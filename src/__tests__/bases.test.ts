import { describe, it, expect } from "vitest";
import { vol } from "memfs";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { listBases, queryBase, createBaseItem, getBaseSchema } from "../tools/bases.js";
import { readFile } from "../tools/read.js";

const config = createTestConfig();

// Set up a mock Base with items before each test
function setupBaseFixture(): void {
  // Create a .base file
  vol.mkdirSync("/vault/Projects", { recursive: true });
  vol.writeFileSync(
    "/vault/Projects/Tasks.base",
    `filters:
  and:
    - file.inFolder("Base items/Tasks")
properties:
  note.Status:
    displayName: Task Status
views:
  - type: table
    name: Active
    order:
      - file.name
      - Status
      - Priority
    sort:
      - property: Priority
        direction: ASC
  - type: table
    name: Done
    order:
      - file.name
      - Status
`
  );

  // Create items folder and items
  vol.mkdirSync("/vault/Base items/Tasks", { recursive: true });

  vol.writeFileSync(
    "/vault/Base items/Tasks/Fix login bug.md",
    `---
Status: In progress
Priority: 1
tags: [bug]
---

Details about the login bug.
`
  );

  vol.writeFileSync(
    "/vault/Base items/Tasks/Add dark mode.md",
    `---
Status: Not started
Priority: 3
tags: [feature]
---

Dark mode implementation notes.
`
  );

  vol.writeFileSync(
    "/vault/Base items/Tasks/Update docs.md",
    `---
Status: Done
Priority: 2
---

Documentation updates.
`
  );
}

describe("listBases", () => {
  it("finds .base files and returns metadata", async () => {
    setupBaseFixture();

    const result = await listBases(config);
    const data = getTestResult(result) as {
      bases: Array<{
        path: string;
        name: string;
        vault: string;
        folder: string;
        itemCount: number;
        views: string[];
        properties: Array<{ key: string; displayName: string }>;
      }>;
      count: number;
    };

    expect(data.count).toBeGreaterThanOrEqual(1);

    const tasksBase = data.bases.find(b => b.name === "Tasks");
    expect(tasksBase).toBeDefined();
    expect(tasksBase!.folder).toBe("Base items/Tasks");
    expect(tasksBase!.itemCount).toBe(3);
    expect(tasksBase!.views).toContain("Active");
    expect(tasksBase!.views).toContain("Done");
  });
});

describe("queryBase", () => {
  it("returns all items with frontmatter properties", async () => {
    setupBaseFixture();

    const result = await queryBase("/vault/Projects/Tasks.base", config);
    const data = getTestResult(result) as {
      base: string;
      itemCount: number;
      items: Array<{
        path: string;
        name: string;
        Status: string;
        Priority: number;
      }>;
      view: string;
      columns: string[];
    };

    expect(data.base).toBe("Tasks");
    expect(data.itemCount).toBe(3);
    expect(data.view).toBe("Active");
    expect(data.columns).toEqual(["file.name", "Status", "Priority"]);

    const loginBug = data.items.find(i => i.name === "Fix login bug");
    expect(loginBug).toBeDefined();
    expect(loginBug!.Status).toBe("In progress");
    expect(loginBug!.Priority).toBe(1);
  });

  it("sorts items by view configuration", async () => {
    setupBaseFixture();

    const result = await queryBase("/vault/Projects/Tasks.base", config, "Active");
    const data = getTestResult(result) as {
      items: Array<{ name: string; Priority: number }>;
    };

    // Should be sorted by Priority ASC
    expect(data.items[0].Priority).toBe(1);
    expect(data.items[1].Priority).toBe(2);
    expect(data.items[2].Priority).toBe(3);
  });

  it("uses specified view", async () => {
    setupBaseFixture();

    const result = await queryBase("/vault/Projects/Tasks.base", config, "Done");
    const data = getTestResult(result) as {
      view: string;
      columns: string[];
    };

    expect(data.view).toBe("Done");
    expect(data.columns).toEqual(["file.name", "Status"]);
  });

  it("returns error for non-existent base file", async () => {
    const result = await queryBase("/vault/nonexistent.base", config);
    expect(result.isError).toBe(true);
  });
});

describe("createBaseItem", () => {
  it("creates a new item in the correct folder", async () => {
    setupBaseFixture();

    const result = await createBaseItem(
      "/vault/Projects/Tasks.base",
      "Write tests",
      { Status: "Not started", Priority: 2, tags: ["testing"] },
      config
    );
    const data = getTestResult(result) as {
      success: boolean;
      path: string;
      base: string;
      etag: string;
    };

    expect(data.success).toBe(true);
    expect(data.path).toBe("/vault/Base items/Tasks/Write tests.md");
    expect(data.base).toBe("Tasks");
    expect(data.etag).toBeDefined();

    // Verify the file was created with correct frontmatter
    const readResult = await readFile("/vault/Base items/Tasks/Write tests.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toContain("Status: Not started");
    expect(readData.content).toContain("Priority: 2");
  });

  it("fails if item already exists", async () => {
    setupBaseFixture();

    const result = await createBaseItem(
      "/vault/Projects/Tasks.base",
      "Fix login bug",
      { Status: "New" },
      config
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("already exists");
  });

  it("creates the item folder if it does not exist", async () => {
    vol.writeFileSync(
      "/vault/NewBase.base",
      `filters:\n  and:\n    - file.inFolder("Base items/NewItems")\nviews:\n  - type: table\n    name: All\n`
    );

    const result = await createBaseItem(
      "/vault/NewBase.base",
      "First item",
      { Category: "Test" },
      config
    );
    const data = getTestResult(result) as { success: boolean };
    expect(data.success).toBe(true);
  });

  it("returns error for non-existent base file", async () => {
    const result = await createBaseItem(
      "/vault/nonexistent.base",
      "Item",
      {},
      config
    );
    expect(result.isError).toBe(true);
  });
});

describe("getBaseSchema", () => {
  it("returns inferred property types from existing items", async () => {
    setupBaseFixture();

    const result = await getBaseSchema("/vault/Projects/Tasks.base", config);
    const data = getTestResult(result) as {
      base: string;
      itemCount: number;
      properties: Array<{
        property: string;
        type: string | string[];
        usedIn: string;
        examples: unknown[];
        displayName?: string;
      }>;
      viewColumns: Record<string, string[]>;
    };

    expect(data.base).toBe("Tasks");
    expect(data.itemCount).toBe(3);

    const statusProp = data.properties.find(p => p.property === "Status");
    expect(statusProp).toBeDefined();
    expect(statusProp!.type).toBe("text");
    expect(statusProp!.usedIn).toBe("3/3 items");
    expect(statusProp!.displayName).toBe("Task Status");

    const priorityProp = data.properties.find(p => p.property === "Priority");
    expect(priorityProp).toBeDefined();
    expect(priorityProp!.type).toBe("number");

    const tagsProp = data.properties.find(p => p.property === "tags");
    expect(tagsProp).toBeDefined();
    expect(tagsProp!.type).toBe("list");

    // View columns
    expect(data.viewColumns["Active"]).toEqual(["file.name", "Status", "Priority"]);
    expect(data.viewColumns["Done"]).toEqual(["file.name", "Status"]);
  });

  it("returns error for non-existent base file", async () => {
    const result = await getBaseSchema("/vault/nonexistent.base", config);
    expect(result.isError).toBe(true);
  });
});
