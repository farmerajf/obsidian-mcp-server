import { resolve, normalize, relative } from "path";
import type { Config } from "../config.js";

export interface ResolvedPath {
  vaultName: string;
  basePath: string;
  relativePath: string;
  fullPath: string;
}

export function resolvePath(path: string, config: Config): ResolvedPath {
  // Normalize the path - remove leading slash and trailing slashes
  let normalizedPath = path;
  if (normalizedPath.startsWith("/")) {
    normalizedPath = normalizedPath.slice(1);
  }
  normalizedPath = normalizedPath.replace(/\/+$/, "");

  // Split into vault name and relative path
  const slashIndex = normalizedPath.indexOf("/");
  let vaultName: string;
  let relativePath: string;

  if (slashIndex === -1) {
    // Path is just vault name (e.g., "personal" or "personal/")
    vaultName = normalizedPath;
    relativePath = "";
  } else {
    vaultName = normalizedPath.slice(0, slashIndex);
    relativePath = normalizedPath.slice(slashIndex + 1);
  }

  // Validate vault name exists in config
  const basePath = config.paths[vaultName];
  if (!basePath) {
    const availableVaults = Object.keys(config.paths).join(", ");
    throw new Error(
      `Invalid vault name: "${vaultName}". Path must start with a vault name. Available vaults: ${availableVaults}`
    );
  }

  // Security check: no path traversal
  if (relativePath) {
    const normalized = normalize(relativePath);
    if (normalized.startsWith("..") || normalized.includes("/../")) {
      throw new Error("Path traversal not allowed");
    }
  }

  const fullPath = relativePath ? resolve(basePath, relativePath) : basePath;

  // Ensure we stay within the vault
  const normalizedBase = normalize(basePath);
  const normalizedFull = normalize(fullPath);
  if (
    !normalizedFull.startsWith(normalizedBase + "/") &&
    normalizedFull !== normalizedBase
  ) {
    throw new Error("Path traversal not allowed");
  }

  return {
    vaultName,
    basePath,
    relativePath,
    fullPath,
  };
}

export function toVirtualPath(
  fullPath: string,
  basePath: string,
  vaultName: string
): string {
  const rel = relative(basePath, fullPath);
  return "/" + vaultName + (rel ? "/" + rel : "");
}

export function getAllBasePaths(config: Config): string[] {
  return Object.values(config.paths);
}

export function getAllVaults(
  config: Config
): Array<{ name: string; basePath: string }> {
  return Object.entries(config.paths).map(([name, basePath]) => ({
    name,
    basePath,
  }));
}

export function isRootPath(path: string): boolean {
  const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized === "";
}

export function getVaultEntries(
  config: Config
): Array<{ name: string; path: string; type: "directory" }> {
  return Object.keys(config.paths).map((name) => ({
    name,
    path: "/" + name,
    type: "directory" as const,
  }));
}
