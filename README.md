# Obsidian Remote MCP Server

A Model Context Protocol (MCP) server that provides remote access to Obsidian vaults with full CRUD operations, Obsidian-aware intelligence, and performance optimizations.

## Why not a generic filesystem MCP server?

A generic filesystem server treats your vault as flat files. This server understands Obsidian:

- **Wikilinks are first-class** - resolve `[[links]]`, extract all links from a file, find backlinks, and automatically update links when you move or rename files. A filesystem server has no concept of `[[wikilinks]]`.
- **Frontmatter as structured data** - read and update YAML frontmatter as JSON with merge semantics, not raw text manipulation.
- **Tag intelligence** - search by tags across frontmatter and inline `#tags`, list all tags with counts, understand nested tag hierarchies like `#project/frontend`.
- **Obsidian URL deep-links** - convert between `obsidian://open?vault=...&file=...` URLs and file paths. The AI automatically cites sources as clickable links that open directly in Obsidian.
- **Obsidian-safe operations** - soft delete to `.trash/` (matching Obsidian's behavior), `.obsidian/` directory protection, ETag conflict detection to prevent overwriting concurrent edits from the Obsidian app.
- **Multi-vault** - access multiple vaults through a single server with a virtual path system, rather than configuring separate filesystem mounts.
- **Remote-first** - SSE transport with API key auth, designed for accessing your vault from Claude Web/iOS over the network. Supports reverse proxy setups like Tailscale Funnel.

## Features

- **Remote access**: Connect Claude Web/iOS to your Obsidian vault via SSE
- **Multi-vault**: Configure multiple vaults with a virtual root path system
- **Obsidian-aware**: Frontmatter, wikilinks, backlinks, tags, Obsidian URL deep-links
- **CRUD+**: Standard operations plus append, patch, partial read
- **Performance**: Batch operations, surgical edits, metadata-only reads
- **Safe**: Soft delete to .trash, ETag conflict detection, .obsidian protection

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create config file

```bash
cp config.example.json config.json
```

Edit `config.json`:

```json
{
  "port": 3000,
  "apiKey": "generate-a-random-secret-here",
  "paths": {
    "personal": "/path/to/obsidian/Personal",
    "work": "/path/to/obsidian/Work"
  }
}
```

- **`apiKey`**: A secret string you generate yourself. Use something long and random (e.g., `openssl rand -hex 32`). This key authenticates requests to your server.
- **`port`**: The port the SSE server listens on.
- **`paths`**: A map of vault names to their absolute filesystem paths. The keys (e.g., `personal`, `work`) become the vault names used in paths and Obsidian URLs. You can configure one or many vaults.
- **`basePath`** (optional): Set this when behind a reverse proxy that strips a path prefix (e.g., Tailscale Funnel with `--set-path`).

### 3. Build and run

```bash
npm run build
npm start
```

### Transport modes

The server supports two transport modes:

- **SSE** (default): For remote access from Claude Web/iOS. Requires `port` and `apiKey`.
- **stdio**: For local use with Claude Desktop. Set via `--stdio` flag, `MCP_TRANSPORT=stdio` env var, or config.

## Connecting from Claude Web/iOS

Add a custom connector with URL:
```
https://your-server.com/YOUR_API_KEY/sse
```

## Available Tools

### Core File Operations

| Tool | Description |
|------|-------------|
| `list_directory` | List directory contents |
| `read_file` | Read file with ETag |
| `create_file` | Create new file |
| `update_file` | Update file with conflict detection |
| `delete_file` | Delete file (soft delete to .trash by default) |
| `search` | Search by content or filename |

### Append & Prepend

| Tool | Description |
|------|-------------|
| `append_file` | Append to end of file (great for daily notes) |
| `prepend_file` | Insert at beginning (after frontmatter) |

### Performance

| Tool | Description |
|------|-------------|
| `patch_file` | Surgical edits without full file transfer |
| `read_file_partial` | Read portion by lines or bytes |
| `get_file_metadata` | Get file info without reading content |
| `batch_read` | Read multiple files in one request |
| `batch_write` | Write multiple files atomically |

### Trash Management

| Tool | Description |
|------|-------------|
| `list_trash` | List .trash contents |
| `restore_from_trash` | Restore deleted file |
| `empty_trash` | Permanently delete from trash |

### Directory Management

| Tool | Description |
|------|-------------|
| `create_directory` | Create directory (nested) |
| `rename_directory` | Rename directory |
| `delete_directory` | Delete directory (protected: .obsidian) |
| `get_directory_info` | Get directory stats |

### Move & Rename

| Tool | Description |
|------|-------------|
| `move` | Move with automatic wikilink updates |
| `rename` | Rename with automatic wikilink updates |

### Frontmatter

| Tool | Description |
|------|-------------|
| `get_frontmatter` | Extract YAML frontmatter as JSON |
| `update_frontmatter` | Update frontmatter fields (merge semantics) |

### Wikilinks

| Tool | Description |
|------|-------------|
| `resolve_wikilink` | Resolve wikilink to file path |
| `extract_wikilinks` | Extract all wikilinks from file |
| `get_backlinks` | Find all files linking to a file |

### Tags

| Tool | Description |
|------|-------------|
| `search_by_tag` | Find files with tags (frontmatter + inline) |
| `list_all_tags` | Get all tags with usage counts |

### Search

| Tool | Description |
|------|-------------|
| `fuzzy_search` | Fuzzy filename search with typo tolerance |
| `search_by_date` | Find files by date (created/modified/frontmatter) |

### Obsidian URLs

| Tool | Description |
|------|-------------|
| `obsidian_url_to_path` | Convert an `obsidian://` URL to a vault file path |
| `path_to_obsidian_url` | Convert a vault file path to an `obsidian://` deep-link URL |

The server includes instructions that tell the AI to cite sources as clickable `obsidian://` URLs, so references in responses open directly in Obsidian.

## Path Format

All paths use the vault name as a prefix:
- `/` - lists all configured vaults
- `/personal/notes/todo.md` - file in the "personal" vault
- `/work/projects` - directory in the "work" vault

## Conflict Detection

Files include ETags for optimistic concurrency:
1. Read file -> get content + ETag
2. Modify content
3. Update with `expectedEtag` -> fails if file changed

## Soft Delete

By default, `delete_file` moves files to `.trash/` instead of permanent deletion:
- Matches Obsidian's behavior
- Use `permanent: true` for immediate deletion
- Restore with `restore_from_trash`

## Protected Directories

The server never modifies or deletes `.obsidian/` directory.

## Security

- API key in URL path (use HTTPS in production)
- Path traversal protection
- Configured paths act as allowlist

## Deployment

For production, use HTTPS via reverse proxy (nginx, Cloudflare Tunnel, Tailscale Funnel, etc.)

## License

ISC
