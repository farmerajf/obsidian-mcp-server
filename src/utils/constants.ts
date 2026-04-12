/** Maximum lines returned by read_file and batch_read before truncation */
export const MAX_LINES = 500;

/** Files larger than this use streaming reads instead of loading into memory */
export const STREAMING_THRESHOLD = 64 * 1024; // 64 KB

/** Obsidian trash folder name */
export const TRASH_FOLDER = ".trash";

/** Glob ignore patterns for vault-wide scans — skips system and trash dirs */
export const VAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.obsidian/**",
  "**/.trash/**",
];

/** File extensions treated as searchable text for content search */
export const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".csv", ".json", ".yaml", ".yml",
  ".html", ".htm", ".xml", ".log", ".css", ".js",
  ".ts", ".jsx", ".tsx", ".py", ".rb", ".sh",
  ".toml", ".ini", ".cfg", ".conf", ".env",
  ".rst", ".tex", ".bib", ".org", ".canvas",
]);
