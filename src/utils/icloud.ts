import { existsSync } from "fs";
import { basename, dirname, join } from "path";

/**
 * Check if a file has an iCloud stub (not yet downloaded from iCloud).
 * macOS creates stub files named `.filename.ext.icloud` for files
 * that exist in iCloud but haven't been downloaded locally.
 */
export function hasICloudStub(filePath: string): boolean {
  const dir = dirname(filePath);
  const name = basename(filePath);
  const stubPath = join(dir, `.${name}.icloud`);
  return existsSync(stubPath);
}
