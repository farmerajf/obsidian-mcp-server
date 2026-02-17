export interface Section {
  heading: string | null;
  level: number;
  startLine: number;
  endLine: number;
  lineCount: number;
  children: Section[];
}

export interface ParsedSections {
  frontmatter: { startLine: number; endLine: number } | null;
  sections: Section[];
  totalLines: number;
}

/**
 * Parse a markdown file into a hierarchical section structure.
 * Handles frontmatter, fenced code blocks, and blockquoted headings.
 */
export function parseSections(content: string): ParsedSections {
  const lines = content.split("\n");
  const totalLines = lines.length;

  let frontmatter: { startLine: number; endLine: number } | null = null;
  let contentStartLine = 1;

  // Detect frontmatter
  if (lines[0] === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") {
        frontmatter = { startLine: 1, endLine: i + 1 };
        contentStartLine = i + 2; // Line after closing ---
        break;
      }
    }
  }

  // Find all headings (flat list with line numbers)
  const headings: { heading: string; level: number; line: number }[] = [];
  let inCodeBlock = false;

  for (let i = contentStartLine - 1; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-indexed

    // Track fenced code blocks
    if (/^(`{3,}|~{3,})/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Skip blockquoted headings
    if (line.startsWith(">")) continue;

    // Detect headings
    const match = line.match(/^(#{1,6})\s+/);
    if (match) {
      headings.push({
        heading: line,
        level: match[1].length,
        line: lineNum,
      });
    }
  }

  // Build flat sections with correct endLine
  const flatSections: Section[] = [];

  // Content before first heading (after frontmatter)
  const firstHeadingLine = headings.length > 0 ? headings[0].line : null;
  if (firstHeadingLine && firstHeadingLine > contentStartLine) {
    flatSections.push({
      heading: null,
      level: 0,
      startLine: contentStartLine,
      endLine: firstHeadingLine - 1,
      lineCount: firstHeadingLine - contentStartLine,
      children: [],
    });
  } else if (!firstHeadingLine && contentStartLine <= totalLines) {
    // No headings at all, but there is content after frontmatter
    // Don't add a null section — spec says return empty sections array
  }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    // endLine: line before next heading of same or higher level (fewer #), or EOF
    // For flat list, endLine is line before the next heading of any level, or EOF
    const nextHeading = i + 1 < headings.length ? headings[i + 1] : null;
    const endLine = nextHeading ? nextHeading.line - 1 : totalLines;

    flatSections.push({
      heading: h.heading,
      level: h.level,
      startLine: h.line,
      endLine,
      lineCount: endLine - h.line + 1,
      children: [],
    });
  }

  // Build hierarchical tree
  const rootSections = buildHierarchy(flatSections);

  return { frontmatter, sections: rootSections, totalLines };
}

/**
 * Build a hierarchical tree from a flat list of sections.
 * An H3 inside an H2 becomes a child. An H2 following an H2 is a sibling.
 */
function buildHierarchy(flatSections: Section[]): Section[] {
  const root: Section[] = [];
  const stack: Section[] = [];

  for (const section of flatSections) {
    // null heading (pre-content) always goes to root
    if (section.heading === null) {
      root.push(section);
      continue;
    }

    // Pop stack until we find a parent with a lower level (fewer #)
    while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(section);
    } else {
      stack[stack.length - 1].children.push(section);
    }

    stack.push(section);
  }

  // Fix endLine for parent sections: a parent's endLine should encompass all children
  fixEndLines(root);

  return root;
}

/**
 * Fix endLine for parent sections so they encompass their children.
 * A parent's endLine should be the max of its own endLine and all children's endLines.
 */
function fixEndLines(sections: Section[]): void {
  for (const section of sections) {
    if (section.children.length > 0) {
      fixEndLines(section.children);
      const lastChild = section.children[section.children.length - 1];
      section.endLine = Math.max(section.endLine, lastChild.endLine);
      section.lineCount = section.endLine - section.startLine + 1;
    }
  }
}
