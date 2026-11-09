import { splitGlobs } from "./glob";

export interface Frontmatter {
  globs: string[];
  alwaysApply: boolean;
  description?: string;
  applyTo: string[];
  hasApplyTo: boolean;
  globLine?: number;
  applyToLine?: number;
}

export const EMPTY_FRONTMATTER: Frontmatter = {
  globs: [],
  alwaysApply: false,
  applyTo: [],
  hasApplyTo: false,
};

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function assign(fm: Frontmatter, key: string, values: string[], line: number): void {
  const name = key.toLowerCase();
  if (name === "alwaysapply") {
    fm.alwaysApply = /^(true|yes|on)$/i.test(values[0] ?? "");
    return;
  }
  if (name === "description") {
    const text = values.join(" ").trim();
    if (text) fm.description = text;
    return;
  }
  if (name === "globs" || name === "glob") {
    fm.globLine = line;
    fm.globs = values.flatMap((value) => splitGlobs(unquote(value))).filter(Boolean);
    return;
  }
  if (name === "applyto") {
    fm.hasApplyTo = true;
    fm.applyToLine = line;
    fm.applyTo = values.flatMap((value) => splitGlobs(unquote(value))).filter(Boolean);
  }
}

function parseYaml(raw: string): Frontmatter {
  const fm: Frontmatter = {
    globs: [],
    alwaysApply: false,
    applyTo: [],
    hasApplyTo: false,
  };
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].trim();
    const lineNo = i + 2;
    if (value === "" || value === "|" || value === ">" || value === "|-" || value === ">-") {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        i++;
        items.push(unquote(lines[i].replace(/^\s+-\s+/, "")));
      }
      assign(fm, key, items, lineNo);
      continue;
    }
    if (value.startsWith("[")) {
      const inner = value.replace(/^\[/, "").replace(/\]\s*$/, "");
      assign(fm, key, splitGlobs(inner).map(unquote), lineNo);
      continue;
    }
    assign(fm, key, [unquote(value)], lineNo);
  }
  return fm;
}

/** Parse a leading `---` block. The body is the rest of the file. */
export function parseFrontmatter(text: string): { frontmatter: Frontmatter; body: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: { ...EMPTY_FRONTMATTER }, body: normalized };
  }
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) {
    return { frontmatter: { ...EMPTY_FRONTMATTER }, body: normalized };
  }
  const raw = normalized.slice(4, end);
  let body = normalized.slice(end + 4);
  if (body.startsWith("\n")) body = body.slice(1);
  return { frontmatter: parseYaml(raw), body };
}
