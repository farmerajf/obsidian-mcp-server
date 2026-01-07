import { vol } from "memfs";
import { vi, beforeEach, afterEach } from "vitest";
import type { Config } from "../../config.js";

// Mock fs module
vi.mock("fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

// Mock glob to work with memfs
vi.mock("glob", async () => {
  const memfs = await import("memfs");
  const path = await import("path");

  return {
    glob: async (
      pattern: string,
      options: { cwd?: string; absolute?: boolean; ignore?: string[]; nodir?: boolean }
    ): Promise<string[]> => {
      const cwd = options.cwd || "/";
      const files: string[] = [];

      // Get all files from memfs
      const getAllFiles = (dir: string): string[] => {
        const results: string[] = [];
        try {
          const entries = memfs.fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              results.push(...getAllFiles(fullPath));
            } else {
              results.push(fullPath);
            }
          }
        } catch {
          // Directory doesn't exist
        }
        return results;
      };

      const allFiles = getAllFiles(cwd);

      // Simple pattern matching
      for (const file of allFiles) {
        const relativePath = path.relative(cwd, file);

        // Check ignore patterns
        if (options.ignore) {
          let ignored = false;
          for (const ignorePattern of options.ignore) {
            if (ignorePattern.includes("**")) {
              const cleanPattern = ignorePattern.replace(/\*\*/g, "").replace(/\//g, "");
              if (relativePath.includes(cleanPattern)) {
                ignored = true;
                break;
              }
            }
          }
          if (ignored) continue;
        }

        // Match pattern
        if (pattern === "**/*.md") {
          if (file.endsWith(".md")) {
            files.push(options.absolute ? file : relativePath);
          }
        } else if (pattern === "**/*.*") {
          if (path.extname(file)) {
            files.push(options.absolute ? file : relativePath);
          }
        } else if (pattern === "**/*") {
          files.push(options.absolute ? file : relativePath);
        } else if (pattern.endsWith("/*")) {
          // Direct children only
          const searchDir = pattern.slice(0, -2);
          const targetDir = path.join(cwd, searchDir);
          if (path.dirname(file) === targetDir) {
            files.push(options.absolute ? file : relativePath);
          }
        }
      }

      return files;
    },
  };
});

export const TEST_VAULT_PATH = "/vault";

export function createTestConfig(): Config {
  return {
    transport: "sse",
    port: 3000,
    apiKey: "test-api-key",
    paths: {
      vault: TEST_VAULT_PATH,
    },
  };
}

export function setupMockVault(): void {
  vol.reset();

  vol.fromJSON({
    // .obsidian directory (protected)
    "/vault/.obsidian/config.json": JSON.stringify({ theme: "dark" }),

    // .trash directory
    "/vault/.trash/.gitkeep": "",

    // Root files
    "/vault/index.md": `---
title: Home
tags: [home, index]
created: 2024-01-01
---

# Welcome

This is the index page.

See [[todo]] for tasks.
See [[projects/project-a]] for project A.
`,

    "/vault/todo.md": `---
title: Todo List
tags: [tasks, todo]
---

# Tasks

- [ ] Task one #urgent
- [x] Task two #done
- [ ] Task three #later

Related: [[index]]
`,

    // Daily notes
    "/vault/notes/daily/2024-01-01.md": `---
title: Daily Note
date: 2024-01-01
tags: [daily]
---

# January 1, 2024

Today's notes here.
Links to [[todo]] and [[projects/project-a]].
`,

    "/vault/notes/daily/2024-01-02.md": `---
title: Daily Note
date: 2024-01-02
tags: [daily]
---

# January 2, 2024

More notes.
`,

    // Projects
    "/vault/notes/projects/project-a.md": `---
title: Project A
status: active
tags: [project, active]
---

# Project A

Description of project A.

## Links
- [[project-b]]
- [[../daily/2024-01-01|Jan 1 Daily]]

![[attachment.png]]
`,

    "/vault/notes/projects/project-b.md": `---
title: Project B
status: planned
tags: [project, planned]
---

# Project B

Description of project B.

See also: [[project-a]]
`,

    // Attachments
    "/vault/attachments/attachment.png": "fake-image-data",

    // No frontmatter file
    "/vault/plain.md": `# Plain File

This file has no frontmatter.
Just content with a [[todo|link]].
`,
  });
}

export function getTestResult(result: { content: { type: string; text: string }[] }): unknown {
  const text = result.content[0]?.text;
  if (!text) return null;

  // Check if it's an error
  if (text.startsWith("Error:")) {
    return { error: text };
  }

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export function resetVault(): void {
  vol.reset();
  setupMockVault();
}

// Reset before each test
beforeEach(() => {
  resetVault();
});

afterEach(() => {
  vol.reset();
});
