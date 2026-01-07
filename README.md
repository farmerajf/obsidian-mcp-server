# Obsidian Remote MCP Server

A Model Context Protocol (MCP) server that provides remote access to an Obsidian vault with full CRUD operations, Obsidian-aware intelligence, and performance optimizations.

## Features

- **Remote access**: Connect Claude Web/iOS to your Obsidian vault via SSE
- **Obsidian-aware**: Frontmatter, wikilinks, backlinks, tags
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
  "apiKey": "your-secure-api-key",
  "paths": {
    "vault": "/path/to/obsidian/vault"
  }
}
```

### 3. Build and run

```bash
npm run build
npm start
```

## Connecting from Claude Web/iOS

Add a custom connector with URL:
```
https://your-server.com/YOUR_API_KEY/sse
```

## Available Tools (30+)

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

## Path Format

All paths are relative to the configured vault:
- `/` - vault root
- `/notes/todo.md` - specific file
- `/projects` - directory

## Conflict Detection

Files include ETags for optimistic concurrency:
1. Read file → get content + ETag
2. Modify content
3. Update with `expectedEtag` → fails if file changed

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

For production, use HTTPS via reverse proxy (nginx, Cloudflare Tunnel, etc.)

## License

ISC
