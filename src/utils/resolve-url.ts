import { extname } from "path";
import type { Config } from "../config.js";

/**
 * Resolve an obsidian:// URL to a vault path string.
 * Throws on invalid URLs or unknown vaults.
 */
export function resolveUrlToPath(url: string, config: Config): string {
  const parsed = new URL(url);

  if (parsed.protocol !== "obsidian:") {
    throw new Error(
      `Invalid URL scheme: expected "obsidian:", got "${parsed.protocol}"`
    );
  }

  const action = parsed.hostname;
  if (action !== "open") {
    throw new Error(
      `Unsupported action: "${action}". Only "open" is supported.`
    );
  }

  const vault = parsed.searchParams.get("vault");
  if (!vault) {
    throw new Error("Missing required 'vault' parameter in URL");
  }

  const file = parsed.searchParams.get("file");
  if (!file) {
    throw new Error("Missing required 'file' parameter in URL");
  }

  // Find config vault by case-insensitive match
  const vaultKey = Object.keys(config.paths).find(
    (k) => k.toLowerCase() === vault.toLowerCase()
  );
  if (!vaultKey) {
    const available = Object.keys(config.paths).join(", ");
    throw new Error(
      `Unknown vault: "${vault}". Available vaults: ${available}`
    );
  }

  // Append .md if no extension
  const filePath = extname(file) ? file : file + ".md";
  return "/" + vaultKey + "/" + filePath;
}

/**
 * Resolve a path from either a path string or an obsidian:// URL.
 * Path takes precedence when both are provided.
 * Throws if neither is provided.
 */
export function resolvePathOrUrl(
  path: string | undefined,
  url: string | undefined,
  config: Config
): string {
  if (path) return path;
  if (url) return resolveUrlToPath(url, config);
  throw new Error("Either 'path' or 'url' is required");
}
