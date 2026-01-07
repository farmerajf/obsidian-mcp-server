import { resolve, normalize, relative, join } from "path";
import { existsSync } from "fs";
import type { Config } from "../config.js";

export interface ResolvedPath {
  basePath: string;
  relativePath: string;
  fullPath: string;
}

export function resolvePath(path: string, config: Config): ResolvedPath {
  // Normalize the path - remove leading slash for consistency
  let relativePath = path;
  if (relativePath.startsWith("/")) {
    relativePath = relativePath.slice(1);
  }

  // Security check: no path traversal
  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes("/../")) {
    throw new Error("Path traversal not allowed");
  }

  // Try to find the path in configured directories
  for (const basePath of Object.values(config.paths)) {
    const fullPath = resolve(basePath, relativePath);
    const normalizedBase = normalize(basePath);
    const normalizedFull = normalize(fullPath);

    // Ensure we stay within the base path
    if (
      normalizedFull.startsWith(normalizedBase + "/") ||
      normalizedFull === normalizedBase
    ) {
      // Check if this path exists or if parent directory exists (for new files)
      if (existsSync(fullPath) || existsSync(resolve(fullPath, ".."))) {
        return {
          basePath,
          relativePath,
          fullPath,
        };
      }
    }
  }

  // For new files, use the first configured path
  const firstBasePath = Object.values(config.paths)[0];
  const fullPath = resolve(firstBasePath, relativePath);

  return {
    basePath: firstBasePath,
    relativePath,
    fullPath,
  };
}

export function toVirtualPath(fullPath: string, basePath: string): string {
  const rel = relative(basePath, fullPath);
  return "/" + rel;
}

export function getAllBasePaths(config: Config): string[] {
  return Object.values(config.paths);
}
