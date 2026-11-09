import { EMPTY_FRONTMATTER, parseFrontmatter } from "./frontmatter";
import { isIgnored, type Config } from "./config";
import { parentDir } from "./paths";
import type { RepoSnapshot } from "./repo";
import type { InstructionFile, Kind } from "./types";

const CURSOR_RULE = /(^|.*\/)\.cursor\/rules\/[^/]+\.mdc$/;
const INSTRUCTIONS = /(^|.*\/)\.github\/instructions\/[^/]+\.instructions\.md$/;

function scopeBefore(rel: string, marker: string): string {
  const index = rel.lastIndexOf(marker);
  if (index <= 0) return "";
  return rel.slice(0, index).replace(/\/$/, "");
}

function kindOf(rel: string): Kind | null {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  if (base === "AGENTS.md") return "agents";
  if (base === "CLAUDE.md") return "claude";
  if (rel === ".cursorrules") return "cursorrules";
  if (rel === ".github/copilot-instructions.md") return "copilot";
  if (CURSOR_RULE.test(rel)) return "cursor-rule";
  if (INSTRUCTIONS.test(rel)) return "instructions";
  return null;
}

export function discover(repo: RepoSnapshot, config: Config): InstructionFile[] {
  const found: InstructionFile[] = [];
  for (const rel of repo.list()) {
    if (isIgnored(rel, config.ignore)) continue;
    const kind = kindOf(rel);
    if (!kind) continue;
    const content = repo.read(rel);
    if (content === null) continue;
    const dir = parentDir(rel);
    let scope = dir;
    if (kind === "cursor-rule") scope = scopeBefore(rel, ".cursor/rules/");
    if (kind === "instructions") scope = scopeBefore(rel, ".github/instructions/");
    if (kind === "cursorrules" || kind === "copilot") scope = "";
    const frontmatter =
      kind === "cursor-rule" || kind === "instructions"
        ? parseFrontmatter(content).frontmatter
        : { ...EMPTY_FRONTMATTER };
    found.push({ path: rel, kind, scope, dir, content, frontmatter });
  }
  return found;
}
