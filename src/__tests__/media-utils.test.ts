import { describe, it, expect } from "vitest";
import { getMediaType, getMimeType } from "../utils/media.js";

describe("getMediaType", () => {
  it("returns 'image' for image extensions", () => {
    expect(getMediaType("photo.png")).toBe("image");
    expect(getMediaType("photo.jpg")).toBe("image");
    expect(getMediaType("photo.jpeg")).toBe("image");
    expect(getMediaType("photo.gif")).toBe("image");
    expect(getMediaType("photo.webp")).toBe("image");
    expect(getMediaType("photo.bmp")).toBe("image");
    expect(getMediaType("diagram.svg")).toBe("image");
  });

  it("returns 'audio' for audio extensions", () => {
    expect(getMediaType("song.mp3")).toBe("audio");
    expect(getMediaType("song.wav")).toBe("audio");
    expect(getMediaType("song.ogg")).toBe("audio");
    expect(getMediaType("song.flac")).toBe("audio");
    expect(getMediaType("song.m4a")).toBe("audio");
  });

  it("returns 'video' for video extensions", () => {
    expect(getMediaType("clip.mp4")).toBe("video");
    expect(getMediaType("clip.webm")).toBe("video");
    expect(getMediaType("clip.ogv")).toBe("video");
  });

  it("returns 'pdf' for pdf files", () => {
    expect(getMediaType("doc.pdf")).toBe("pdf");
  });

  it("returns 'text' for text/unknown extensions", () => {
    expect(getMediaType("note.md")).toBe("text");
    expect(getMediaType("data.json")).toBe("text");
    expect(getMediaType("file.txt")).toBe("text");
    expect(getMediaType("unknown.xyz")).toBe("text");
  });

  it("returns 'text' for files with no extension", () => {
    expect(getMediaType("README")).toBe("text");
    expect(getMediaType("Makefile")).toBe("text");
  });

  it("is case insensitive", () => {
    expect(getMediaType("photo.PNG")).toBe("image");
    expect(getMediaType("photo.Jpg")).toBe("image");
    expect(getMediaType("song.MP3")).toBe("audio");
  });

  it("handles paths with directories", () => {
    expect(getMediaType("/vault/attachments/photo.png")).toBe("image");
    expect(getMediaType("notes/audio/song.mp3")).toBe("audio");
  });
});

describe("getMimeType", () => {
  it("returns correct MIME types for images", () => {
    expect(getMimeType("photo.png")).toBe("image/png");
    expect(getMimeType("photo.jpg")).toBe("image/jpeg");
    expect(getMimeType("photo.jpeg")).toBe("image/jpeg");
    expect(getMimeType("photo.gif")).toBe("image/gif");
    expect(getMimeType("photo.webp")).toBe("image/webp");
    expect(getMimeType("photo.bmp")).toBe("image/bmp");
    expect(getMimeType("diagram.svg")).toBe("image/svg+xml");
  });

  it("returns correct MIME types for audio", () => {
    expect(getMimeType("song.mp3")).toBe("audio/mpeg");
    expect(getMimeType("song.wav")).toBe("audio/wav");
    expect(getMimeType("song.ogg")).toBe("audio/ogg");
    expect(getMimeType("song.flac")).toBe("audio/flac");
    expect(getMimeType("song.m4a")).toBe("audio/mp4");
  });

  it("returns null for unrecognized extensions", () => {
    expect(getMimeType("note.md")).toBeNull();
    expect(getMimeType("data.json")).toBeNull();
    expect(getMimeType("README")).toBeNull();
  });
});
