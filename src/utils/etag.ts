import { createHash } from "crypto";

export function generateEtag(content: string | Buffer): string {
  const hash = createHash("sha256");
  hash.update(content);
  return hash.digest("hex").slice(0, 16);
}
