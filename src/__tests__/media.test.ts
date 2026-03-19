import { describe, it, expect } from "vitest";
import { createTestConfig, setupMockVault } from "./helpers/setup.js";
import { readFile } from "../tools/read.js";
import { batchRead } from "../tools/batch.js";
import { getFileMetadata, readFilePartial } from "../tools/metadata.js";

setupMockVault();

const config = createTestConfig();

describe("readFile with media files", () => {
  it("returns image content block for .png files", async () => {
    const result = await readFile("/vault/attachments/attachment.png", config);
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);

    const imageBlock = result.content[0] as { type: string; data: string; mimeType: string };
    expect(imageBlock.type).toBe("image");
    expect(imageBlock.mimeType).toBe("image/png");
    expect(imageBlock.data).toBe(Buffer.from("fake-image-data").toString("base64"));

    const metaBlock = result.content[1] as { type: string; text: string };
    expect(metaBlock.type).toBe("text");
    const meta = JSON.parse(metaBlock.text);
    expect(meta.path).toBe("/vault/attachments/attachment.png");
    expect(meta.mimeType).toBe("image/png");
    expect(meta.etag).toBeDefined();
    expect(meta.size).toBeDefined();
  });

  it("returns image content block for .jpg files", async () => {
    const result = await readFile("/vault/attachments/photo.jpg", config);
    const imageBlock = result.content[0] as { type: string; mimeType: string };
    expect(imageBlock.type).toBe("image");
    expect(imageBlock.mimeType).toBe("image/jpeg");
  });

  it("returns image content block for .svg files", async () => {
    const result = await readFile("/vault/attachments/diagram.svg", config);
    const imageBlock = result.content[0] as { type: string; mimeType: string };
    expect(imageBlock.type).toBe("image");
    expect(imageBlock.mimeType).toBe("image/svg+xml");
  });

  it("returns audio content block for .mp3 files", async () => {
    const result = await readFile("/vault/attachments/song.mp3", config);
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);

    const audioBlock = result.content[0] as { type: string; data: string; mimeType: string };
    expect(audioBlock.type).toBe("audio");
    expect(audioBlock.mimeType).toBe("audio/mpeg");
    expect(audioBlock.data).toBe(Buffer.from("fake-audio-data").toString("base64"));
  });

  it("returns error for video files", async () => {
    const result = await readFile("/vault/attachments/movie.mp4", config);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Video");
    expect(text).toContain("cannot be returned");
  });

  it("returns error for PDF files", async () => {
    const result = await readFile("/vault/attachments/document.pdf", config);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("PDF");
    expect(text).toContain("cannot be returned");
  });

  it("still returns text for .md files", async () => {
    const result = await readFile("/vault/index.md", config);
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const textBlock = result.content[0] as { type: string; text: string };
    expect(textBlock.type).toBe("text");
    const data = JSON.parse(textBlock.text);
    expect(data.content).toContain("# Welcome");
  });
});

describe("batchRead with media files", () => {
  it("handles mixed text and image files", async () => {
    const result = await batchRead(
      ["/vault/index.md", "/vault/attachments/attachment.png"],
      config
    );
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.successCount).toBe(2);
    expect(data.failureCount).toBe(0);

    // Text file
    const textResult = data.results[0];
    expect(textResult.success).toBe(true);
    expect(textResult.mediaType).toBeUndefined();
    expect(textResult.content).toContain("# Welcome");

    // Image file
    const imageResult = data.results[1];
    expect(imageResult.success).toBe(true);
    expect(imageResult.mediaType).toBe("image");
    expect(imageResult.mimeType).toBe("image/png");
    expect(imageResult.content).toBe(Buffer.from("fake-image-data").toString("base64"));
  });

  it("handles video files in batch without content", async () => {
    const result = await batchRead(["/vault/attachments/movie.mp4"], config);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.results[0].success).toBe(true);
    expect(data.results[0].mediaType).toBe("video");
    expect(data.results[0].content).toBeUndefined();
  });
});

describe("getFileMetadata with media files", () => {
  it("returns metadata for image files without frontmatter parsing", async () => {
    const result = await getFileMetadata("/vault/attachments/attachment.png", config);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.exists).toBe(true);
    expect(data.type).toBe("file");
    expect(data.mediaType).toBe("image");
    expect(data.mimeType).toBe("image/png");
    expect(data.etag).toBeDefined();
    expect(data.size).toBeDefined();
    // Should not have text-file-specific fields
    expect(data.lineCount).toBeUndefined();
    expect(data.hasFrontmatter).toBeUndefined();
    expect(data.sectionCount).toBeUndefined();
  });
});

describe("readFilePartial with media files", () => {
  it("returns error for binary files", async () => {
    const result = await readFilePartial("/vault/attachments/attachment.png", config, {
      mode: "lines",
      start: 1,
    });
    expect(result.isError).toBe(true);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.error).toContain("not supported for binary files");
    expect(data.mediaType).toBe("image");
  });
});
