import { createHash } from "crypto";
import { createReadStream } from "fs";

export function generateEtag(content: string | Buffer): string {
  const hash = createHash("sha256");
  hash.update(content);
  return hash.digest("hex").slice(0, 16);
}

/**
 * Compute an etag by streaming the file through a hash,
 * without loading the entire file into memory.
 */
export function generateEtagStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex").slice(0, 16)));
    stream.on("error", reject);
  });
}
