import { describe, it, expect } from "vitest";
import { vol } from "memfs";
import "./helpers/setup.js";
import { createTestConfig, getTestResult } from "./helpers/setup.js";
import { createBinaryFile, attachToNote } from "../tools/binary.js";
import { readFile } from "../tools/read.js";
import { createFile } from "../tools/create.js";

const config = createTestConfig();

describe("createBinaryFile", () => {
  it("creates a binary file from base64 content", async () => {
    const pdfContent = Buffer.from("fake-pdf-content").toString("base64");

    const result = await createBinaryFile(
      "/vault/attachments/test.pdf",
      pdfContent,
      config
    );
    const data = getTestResult(result) as { success: boolean; path: string; size: number; etag: string };

    expect(data.success).toBe(true);
    expect(data.path).toBe("/vault/attachments/test.pdf");
    expect(data.size).toBe(16); // "fake-pdf-content".length
    expect(data.etag).toBeDefined();
  });

  it("creates parent directories if needed", async () => {
    const content = Buffer.from("data").toString("base64");

    const result = await createBinaryFile(
      "/vault/new/nested/dir/file.png",
      content,
      config
    );
    const data = getTestResult(result) as { success: boolean };

    expect(data.success).toBe(true);
  });

  it("fails if file already exists", async () => {
    const content = Buffer.from("data").toString("base64");

    await createBinaryFile("/vault/attachments/existing.png", content, config);
    const result = await createBinaryFile("/vault/attachments/existing.png", content, config);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("already exists");
  });
});

describe("attachToNote", () => {
  it("creates attachment and inserts embed link at end of note", async () => {
    await createFile("/vault/notes/test-note.md", "# My Note\n\nSome content.", config);

    const pdfContent = Buffer.from("pdf-data").toString("base64");
    const result = await attachToNote(
      "/vault/notes/test-note.md",
      "receipt.pdf",
      pdfContent,
      config,
      "end"
    );
    const data = getTestResult(result) as {
      success: boolean;
      attachmentPath: string;
      notePath: string;
      embedLink: string;
    };

    expect(data.success).toBe(true);
    expect(data.embedLink).toBe("![[receipt.pdf]]");

    // Verify note was updated
    const readResult = await readFile("/vault/notes/test-note.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toContain("![[receipt.pdf]]");
    expect(readData.content).toContain("Some content.");
  });

  it("inserts embed link at start (after frontmatter)", async () => {
    await createFile(
      "/vault/notes/fm-note.md",
      "---\ntitle: Test\n---\n# Heading\n\nBody text.",
      config
    );

    const imgContent = Buffer.from("img-data").toString("base64");
    const result = await attachToNote(
      "/vault/notes/fm-note.md",
      "photo.png",
      imgContent,
      config,
      "start"
    );
    const data = getTestResult(result) as { success: boolean };
    expect(data.success).toBe(true);

    const readResult = await readFile("/vault/notes/fm-note.md", config);
    const readData = getTestResult(readResult) as { content: string };
    // Embed should be after frontmatter but before heading
    expect(readData.content).toMatch(/---\n!?\[\[photo\.png\]\]\n# Heading/);
  });

  it("inserts embed link after specified heading", async () => {
    await createFile(
      "/vault/notes/heading-note.md",
      "# Title\n\nIntro.\n\n## Attachments\n\nExisting stuff.\n\n## Other",
      config
    );

    const content = Buffer.from("data").toString("base64");
    const result = await attachToNote(
      "/vault/notes/heading-note.md",
      "doc.pdf",
      content,
      config,
      "after:Attachments"
    );
    const data = getTestResult(result) as { success: boolean };
    expect(data.success).toBe(true);

    const readResult = await readFile("/vault/notes/heading-note.md", config);
    const readData = getTestResult(readResult) as { content: string };
    expect(readData.content).toContain("## Attachments\n![[doc.pdf]]");
  });

  it("fails if note does not exist", async () => {
    const content = Buffer.from("data").toString("base64");
    const result = await attachToNote(
      "/vault/nonexistent-note.md",
      "file.pdf",
      content,
      config
    );

    expect(result.isError).toBe(true);
  });

  it("fails if attachment already exists", async () => {
    await createFile("/vault/notes/note2.md", "Content", config);
    vol.writeFileSync("/vault/notes/existing.pdf", "old");

    const content = Buffer.from("data").toString("base64");
    const result = await attachToNote(
      "/vault/notes/note2.md",
      "existing.pdf",
      content,
      config
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("already exists");
  });
});
