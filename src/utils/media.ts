import { extname } from "path";

export type MediaType = "image" | "audio" | "video" | "pdf" | "text";

const MIME_MAP: Record<string, string> = {
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  // Audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  // Video
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  // Documents
  pdf: "application/pdf",
};

/** Max file size (bytes) for inline binary content. 10 MB. */
export const MAX_MEDIA_SIZE = 10 * 1024 * 1024;

export function getMimeType(filePath: string): string | null {
  const ext = extname(filePath).slice(1).toLowerCase();
  return MIME_MAP[ext] ?? null;
}

export function getMediaType(filePath: string): MediaType {
  const mime = getMimeType(filePath);
  if (!mime) return "text";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "text";
}
