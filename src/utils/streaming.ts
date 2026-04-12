import { createReadStream } from "fs";
import { createInterface } from "readline";

/**
 * Read the first N lines from a file using streaming, counting total lines
 * without holding the entire file in memory.
 */
export function readFirstLines(
  filePath: string,
  maxLines: number
): Promise<{ lines: string[]; totalLines: number }> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let totalLines = 0;
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => {
      totalLines++;
      if (lines.length < maxLines) {
        lines.push(line);
      }
    });
    rl.on("close", () => resolve({ lines, totalLines }));
    rl.on("error", reject);
  });
}
