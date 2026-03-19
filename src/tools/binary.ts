import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { dirname, basename } from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";

export async function createBinaryFile(
  path: string,
  base64Content: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);

    if (existsSync(resolved.fullPath)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: File already exists at ${path}. Use update_file to modify existing files.`,
          },
        ],
        isError: true,
      };
    }

    const dir = dirname(resolved.fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const buffer = Buffer.from(base64Content, "base64");
    writeFileSync(resolved.fullPath, buffer);
    const etag = generateEtag(buffer);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              path,
              size: buffer.length,
              etag,
              message: "Binary file created successfully",
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}

export async function attachToNote(
  notePath: string,
  fileName: string,
  base64Content: string,
  config: Config,
  position: "end" | "start" | string = "end"
): Promise<CallToolResult> {
  try {
    const noteResolved = resolvePath(notePath, config);

    if (!existsSync(noteResolved.fullPath)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Note does not exist at ${notePath}`,
          },
        ],
        isError: true,
      };
    }

    // Determine attachment folder: same directory as the note
    const noteDir = dirname(noteResolved.fullPath);
    const attachmentDir = dirname(notePath);
    const attachmentPath = `${attachmentDir}/${fileName}`;
    const attachmentFullPath = `${noteDir}/${fileName}`;

    if (existsSync(attachmentFullPath)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Attachment already exists at ${attachmentPath}`,
          },
        ],
        isError: true,
      };
    }

    // Write the binary file
    const buffer = Buffer.from(base64Content, "base64");
    writeFileSync(attachmentFullPath, buffer);
    const attachmentEtag = generateEtag(buffer);

    // Insert embed link into the note
    const embedLink = `![[${fileName}]]`;
    let noteContent = readFileSync(noteResolved.fullPath, "utf-8");

    if (position === "end") {
      if (noteContent.length > 0 && !noteContent.endsWith("\n")) {
        noteContent += "\n";
      }
      noteContent += embedLink + "\n";
    } else if (position === "start") {
      // After frontmatter if present
      const fmMatch = noteContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      if (fmMatch) {
        const insertAt = fmMatch[0].length;
        noteContent =
          noteContent.slice(0, insertAt) + embedLink + "\n" + noteContent.slice(insertAt);
      } else {
        noteContent = embedLink + "\n" + noteContent;
      }
    } else if (position.startsWith("after:")) {
      const heading = position.slice(6);
      const headingRegex = new RegExp(`^(#{1,6}\\s+${escapeRegex(heading)})\\s*$`, "m");
      const match = noteContent.match(headingRegex);
      if (match && match.index !== undefined) {
        const insertAt = match.index + match[1].length;
        noteContent =
          noteContent.slice(0, insertAt) + "\n" + embedLink + noteContent.slice(insertAt);
      } else {
        // Heading not found, append to end
        if (noteContent.length > 0 && !noteContent.endsWith("\n")) {
          noteContent += "\n";
        }
        noteContent += embedLink + "\n";
      }
    }

    writeFileSync(noteResolved.fullPath, noteContent, "utf-8");
    const noteEtag = generateEtag(noteContent);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              attachmentPath,
              attachmentSize: buffer.length,
              attachmentEtag,
              notePath,
              noteEtag,
              embedLink,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
