import { readFileSync } from "fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { generateEtag } from "../utils/etag.js";
import { parseSections, type Section } from "../utils/sections.js";

export async function getSections(
  path: string,
  config: Config
): Promise<CallToolResult> {
  try {
    const resolved = resolvePath(path, config);
    const content = readFileSync(resolved.fullPath, "utf-8");
    const parsed = parseSections(content);

    // Strip content from sections — only return structure
    function stripContent(sections: Section[]): unknown[] {
      return sections.map((s) => ({
        heading: s.heading,
        level: s.level,
        startLine: s.startLine,
        endLine: s.endLine,
        lineCount: s.lineCount,
        children: stripContent(s.children),
      }));
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path,
              totalLines: parsed.totalLines,
              frontmatter: parsed.frontmatter,
              sections: stripContent(parsed.sections),
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

export async function readSection(
  path: string,
  config: Config,
  options: {
    heading: string;
    includeChildren?: boolean;
    includeHeading?: boolean;
  }
): Promise<CallToolResult> {
  const { heading, includeChildren = true, includeHeading = true } = options;

  try {
    const resolved = resolvePath(path, config);
    const content = readFileSync(resolved.fullPath, "utf-8");
    const etag = generateEtag(content);
    const lines = content.split("\n");

    // Special case: frontmatter
    if (heading === "frontmatter") {
      const parsed = parseSections(content);
      if (!parsed.frontmatter) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "No frontmatter found in file" },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      const fm = parsed.frontmatter;
      const fmContent = lines.slice(fm.startLine - 1, fm.endLine).join("\n");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                path,
                heading: "frontmatter",
                startLine: fm.startLine,
                endLine: fm.endLine,
                lineCount: fm.endLine - fm.startLine + 1,
                content: fmContent,
                etag,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // Parse sections and find matching heading
    const parsed = parseSections(content);
    const match = findSection(parsed.sections, heading);

    if (!match) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: `Heading '${heading}' not found in file`,
                suggestion:
                  "Use get_sections to see available headings in this file.",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    let startLine = match.startLine;
    let endLine: number;

    if (includeChildren) {
      // Include all children — use the section's endLine which encompasses children
      endLine = match.endLine;
    } else {
      // Stop at first child heading
      if (match.children.length > 0) {
        endLine = match.children[0].startLine - 1;
      } else {
        endLine = match.endLine;
      }
    }

    if (!includeHeading) {
      startLine = startLine + 1;
    }

    // Clamp
    startLine = Math.max(startLine, 1);
    endLine = Math.min(endLine, lines.length);

    const sectionContent = lines.slice(startLine - 1, endLine).join("\n");
    const lineCount = endLine - startLine + 1;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path,
              heading,
              startLine,
              endLine,
              lineCount,
              content: sectionContent,
              etag,
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

/** Recursively find a section by exact heading match (first occurrence). */
function findSection(sections: Section[], heading: string): Section | null {
  for (const section of sections) {
    if (section.heading === heading) return section;
    const child = findSection(section.children, heading);
    if (child) return child;
  }
  return null;
}
