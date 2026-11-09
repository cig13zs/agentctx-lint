import path from "node:path";
import { matchScoped } from "./glob";
import { isInside, normRel, parentDir } from "./paths";
import type { RepoSnapshot } from "./repo";
import {
  commandStrings,
  lineOf,
  maskFences,
  normalizePhrase,
  sameTopic,
} from "./textutil";
import type { Applied, InstructionFile, Issue } from "./types";
import type { Budgets } from "./config";

const PACKAGE_MANAGERS = ["pnpm", "yarn", "bun", "npm"] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];

function negatedAt(line: string, index: number): boolean {
  const before = line.slice(Math.max(0, index - 40), index).toLowerCase();
  return /\b(?:no|not|never|don't|do not|avoid|without|instead of|rather than)\b/.test(before);
}

function endorsedManager(text: string): { pm: PackageManager; line: number } | null {
  const found = new Map<PackageManager, number>();
  const lines = text.split("\n");
  lines.forEach((original, index) => {
    const line = original.toLowerCase();
    const labeled = line.match(/package\s+manager\s*:\s*(pnpm|yarn|bun|npm)\b/);
    if (labeled) {
      const pm = labeled[1] as PackageManager;
      if (!found.has(pm)) found.set(pm, index + 1);
    }
    for (const pm of PACKAGE_MANAGERS) {
      const re = new RegExp(`\\b${pm}\\b`, "g");
      let match: RegExpExecArray | null;
      while ((match = re.exec(line))) {
        if (negatedAt(line, match.index)) continue;
        const command = new RegExp(`\\b${pm}\\s+(install|ci|run|test|add|exec|dlx|build)\\b`);
        const prose = new RegExp(
          `\\b(use|using|via|with|prefer|requires|require|run)\\b[^\\n]{0,40}\\b${pm}\\b|\\b${pm}\\b[^\\n]{0,24}\\b(only|required)\\b`,
        );
        if (!command.test(line) && !prose.test(line) && !labeled) continue;
        if (!found.has(pm)) found.set(pm, index + 1);
        break;
      }
    }
  });
  if (found.size !== 1) return null;
  const entry = [...found.entries()][0];
  if (!entry) return null;
  return { pm: entry[0], line: entry[1] };
}

function packageManagerIssues(chain: Applied[]): Issue[] {
  const entries: { path: string; pm: PackageManager; line: number }[] = [];
  for (const applied of chain) {
    const hit = endorsedManager(applied.file.content);
    if (hit) entries.push({ path: applied.file.path, pm: hit.pm, line: hit.line });
  }
  const distinct = new Set(entries.map((entry) => entry.pm));
  if (distinct.size < 2) return [];
  const parts = entries.map((entry) => `${entry.pm} (${entry.path})`);
  const primary = entries[entries.length - 1];
  return [
    {
      rule: "package-manager",
      severity: "error",
      message: `package manager disagrees: ${parts.join(" vs ")}`,
      files: [primary.path, ...entries.slice(0, -1).map((entry) => entry.path).reverse()],
      line: primary.line,
    },
  ];
}

function classifyCommand(cmd: string): { kind: "test" | "build"; task: string } | null {
  const compact = cmd.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  const task = compact
    .replace(/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?/, "")
    .replace(/^npx\s+/, "");
  const test =
    /^(?:test|tests)(?:\s|$|:)/.test(task) ||
    /\b(?:pytest|vitest|jest|mocha|ava|rspec|phpunit|ctest)\b/.test(compact) ||
    /\b(?:cargo|go)\s+test\b/.test(compact) ||
    /^(?:make|just)\s+test\b/.test(compact);
  const build =
    /^build(?:\s|$|:)/.test(task) ||
    /\b(?:tsc|webpack|vite\s+build|next\s+build)\b/.test(compact) ||
    /\b(?:cargo|go)\s+build\b/.test(compact) ||
    /^(?:make|just)\s+build\b/.test(compact);
  if (test === build) return null;
  return { kind: test ? "test" : "build", task };
}

function commandIssues(chain: Applied[]): Issue[] {
  const issues: Issue[] = [];
  for (const kind of ["test", "build"] as const) {
    const entries: { path: string; tasks: Set<string>; line: number }[] = [];
    for (const applied of chain) {
      const tasks = new Set<string>();
      let line = 1;
      for (const cmd of commandStrings(applied.file.content)) {
        const classified = classifyCommand(cmd);
        if (!classified || classified.kind !== kind) continue;
        if (!tasks.has(classified.task)) {
          tasks.add(classified.task);
          line = lineOf(applied.file.content, cmd);
        }
      }
      if (tasks.size) entries.push({ path: applied.file.path, tasks, line });
    }
    if (entries.length < 2) continue;
    let conflict = false;
    for (let i = 0; i < entries.length && !conflict; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const overlap = [...entries[i].tasks].some((task) => entries[j].tasks.has(task));
        if (!overlap) conflict = true;
      }
    }
    if (!conflict) continue;
    const parts = entries.map((entry) => {
      const list = [...entry.tasks].sort().map((task) => `"${task}"`).join(", ");
      return `${list} (${entry.path})`;
    });
    const primary = entries[entries.length - 1];
    issues.push({
      rule: "command-conflict",
      severity: "error",
      message: `${kind} commands disagree: ${parts.join(" vs ")}`,
      files: [primary.path, ...entries.slice(0, -1).map((entry) => entry.path).reverse()],
      line: primary.line,
    });
  }
  return issues;
}

interface StyleValue {
  value: string;
  line: number;
}

interface StyleFact {
  indent?: StyleValue;
  quotes?: StyleValue;
  semicolons?: StyleValue;
}

function extractStyle(text: string): StyleFact {
  const fact: StyleFact = {};
  const masked = maskFences(text);
  const lines = masked.split("\n");
  lines.forEach((original, index) => {
    const line = original.toLowerCase();
    const lineNo = index + 1;
    const indentContext =
      /\bindent/.test(line) ||
      /\b(?:use|prefer)\s+tabs?\b/.test(line) ||
      /\b(?:use|prefer)\s+\d+\s+spaces?\b/.test(line);
    if (indentContext) {
      const spaces = line.match(/\b(\d+)\s*[- ]?\s*spaces?\b/);
      const tab = /\btabs?\b/.exec(line);
      if (spaces && !negatedAt(line, spaces.index ?? 0)) {
        fact.indent = { value: spaces[1], line: lineNo };
      } else if (tab && !negatedAt(line, tab.index)) {
        fact.indent = { value: "tab", line: lineNo };
      }
    }
    const editor = line.match(/indent_style\s*=\s*(tab|space)/);
    if (editor) {
      if (editor[1] === "tab") fact.indent = { value: "tab", line: lineNo };
      else {
        const size = masked.toLowerCase().match(/indent_size\s*=\s*(\d+)/);
        if (size) fact.indent = { value: size[1], line: lineNo };
      }
    }
    const single = line.search(/\bsingle quotes?\b/);
    const double = line.search(/\bdouble quotes?\b/);
    if (single >= 0 && !negatedAt(line, single)) fact.quotes = { value: "single", line: lineNo };
    if (double >= 0 && !negatedAt(line, double)) fact.quotes = { value: "double", line: lineNo };
    if (
      /\b(?:no|omit|without)\s+semicolons?\b/.test(line) ||
      /\b(?:never|don't|do not|avoid)\s+(?:use\s+)?semicolons?\b/.test(line) ||
      /\bsemicolons?\s*:\s*false\b/.test(line)
    ) {
      fact.semicolons = { value: "never", line: lineNo };
    } else if (
      /\b(?:use|with)\s+semicolons?\b/.test(line) ||
      /\bsemicolons?\s*:\s*true\b/.test(line) ||
      /\balways\s+(?:add|use)\s+semicolons?\b/.test(line)
    ) {
      fact.semicolons = { value: "always", line: lineNo };
    }
  });
  return fact;
}

function indentLabel(value: string): string {
  return value === "tab" ? "tabs" : `${value} spaces`;
}

function styleIssues(chain: Applied[]): Issue[] {
  const facts = chain.map((applied) => ({
    path: applied.file.path,
    style: extractStyle(applied.file.content),
  }));
  const issues: Issue[] = [];
  const facets: { key: keyof StyleFact; label: (value: string) => string; name: string }[] = [
    { key: "indent", name: "indentation", label: indentLabel },
    { key: "quotes", name: "quotes", label: (value) => `${value} quotes` },
    {
      key: "semicolons",
      name: "semicolons",
      label: (value) => (value === "always" ? "semicolons" : "no semicolons"),
    },
  ];
  for (const facet of facets) {
    const entries = facts
      .map((fact) => {
        const value = fact.style[facet.key];
        return value ? { path: fact.path, ...value } : null;
      })
      .filter((entry): entry is { path: string; value: string; line: number } => entry !== null);
    const distinct = new Set(entries.map((entry) => entry.value));
    if (distinct.size < 2) continue;
    const parts = entries.map((entry) => `${facet.label(entry.value)} (${entry.path})`);
    const primary = entries[entries.length - 1];
    issues.push({
      rule: "style-conflict",
      severity: "warning",
      message: `${facet.name} disagrees: ${parts.join(" vs ")}`,
      files: [primary.path, ...entries.slice(0, -1).map((entry) => entry.path).reverse()],
      line: primary.line,
    });
  }
  return issues;
}

interface Directive {
  polarity: "require" | "forbid";
  predicate: string;
  line: number;
}

function directivesOf(text: string): Directive[] {
  const out: Directive[] = [];
  const lines = maskFences(text).split("\n");
  const polarity =
    /^(?:you\s+|we\s+)?(must not|must never|never|do not|don't|must|always)\s+(.+)$/i;
  lines.forEach((line, index) => {
    const cleaned = line
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
      .replace(/\*\*/g, "")
      .trim();
    const match = cleaned.match(polarity);
    if (!match) return;
    const word = match[1].toLowerCase();
    let side: Directive["polarity"] = word === "must" || word === "always" ? "require" : "forbid";
    let predicate = match[2].trim().replace(/[.\s]+$/, "");
    if (side === "forbid" && /^(?:fail to|forget to)\s+/i.test(predicate)) {
      side = "require";
      predicate = predicate.replace(/^(?:fail to|forget to)\s+/i, "");
    }
    if (normalizePhrase(predicate).length < 3) return;
    out.push({ polarity: side, predicate, line: index + 1 });
  });
  return out;
}

function mustNeverIssues(chain: Applied[]): Issue[] {
  const parsed = chain.map((applied) => ({
    path: applied.file.path,
    directives: directivesOf(applied.file.content),
  }));
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      for (const left of parsed[i].directives) {
        for (const right of parsed[j].directives) {
          if (left.polarity === right.polarity) continue;
          if (!sameTopic(left.predicate, right.predicate)) continue;
          const topic =
            normalizePhrase(left.predicate).length <= normalizePhrase(right.predicate).length
              ? normalizePhrase(left.predicate)
              : normalizePhrase(right.predicate);
          const key = [parsed[i].path, parsed[j].path, topic].sort().join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          const earlier = { path: parsed[i].path, directive: left };
          const later = { path: parsed[j].path, directive: right };
          const word = (directive: Directive): string =>
            directive.polarity === "require" ? "requires" : "forbids";
          issues.push({
            rule: "must-never",
            severity: "error",
            message: `must/never disagree on "${topic}": ${earlier.path} ${word(earlier.directive)} it, ${later.path} ${word(later.directive)} it`,
            files: [later.path, earlier.path],
            line: later.directive.line,
          });
        }
      }
    }
  }
  return issues;
}

function budgetIssues(chain: Applied[], budgets: Budgets): Issue[] {
  if (!chain.length) return [];
  let chars = 0;
  let bytes = 0;
  for (const applied of chain) {
    chars += applied.file.content.length;
    bytes += Buffer.byteLength(applied.file.content, "utf8");
  }
  const tokens = Math.ceil(chars / 4);
  const overTokens = tokens > budgets.maxTokens;
  const overBytes = bytes > budgets.maxBytes;
  if (!overTokens && !overBytes) return [];
  const bits: string[] = [];
  if (overTokens) bits.push(`${tokens} tokens (budget ${budgets.maxTokens})`);
  if (overBytes) bits.push(`${bytes} bytes (budget ${budgets.maxBytes})`);
  const paths = chain.map((applied) => applied.file.path);
  const primary = chain[chain.length - 1].file.path;
  return [
    {
      rule: "chain-budget",
      severity: "warning",
      message: `chain exceeds budget: ${bits.join(", ")} (${paths.join(", ")})`,
      files: [primary, ...paths.filter((item) => item !== primary)],
      line: 1,
    },
  ];
}

export function chainIssues(chain: Applied[], budgets: Budgets): Issue[] {
  return [
    ...packageManagerIssues(chain),
    ...commandIssues(chain),
    ...styleIssues(chain),
    ...mustNeverIssues(chain),
    ...budgetIssues(chain, budgets),
  ];
}

const PATH_EXT = new Set([
  "md",
  "mdc",
  "txt",
  "json",
  "jsonc",
  "yml",
  "yaml",
  "toml",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "rb",
  "sh",
  "bash",
  "css",
  "scss",
  "html",
  "svg",
  "xml",
  "ini",
  "lock",
]);

function isPathRef(ref: string): boolean {
  if (!ref || ref.length < 3 || ref.length > 240) return false;
  if (/^(https?:|mailto:|file:)/i.test(ref)) return false;
  if (ref.startsWith("#") || ref.startsWith("-")) return false;
  if (/[\s$*|;&<>{}]/.test(ref)) return false;
  const pathOnly = ref.split("#")[0].split("?")[0];
  if (!pathOnly || pathOnly.includes(":")) return false;
  if (pathOnly.split("/").includes("node_modules")) return false;
  const hasSlash = pathOnly.includes("/");
  const relative = pathOnly.startsWith("./") || pathOnly.startsWith("../");
  const base = pathOnly.split("/").pop() ?? pathOnly;
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "";
  if (hasSlash || relative) return true;
  if (!PATH_EXT.has(ext)) return false;
  if (/^[A-Z][a-zA-Z]+\.[a-z]+$/.test(base)) return false;
  return true;
}

function extractRefs(text: string): { ref: string; line: number }[] {
  const out: { ref: string; line: number }[] = [];
  const push = (ref: string, index: number): void => {
    const cleaned = ref.trim().replace(/^<|>$/g, "");
    if (!isPathRef(cleaned)) return;
    out.push({ ref: cleaned, line: text.slice(0, index).split("\n").length });
  };
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)/g)) push(match[1], match.index ?? 0);
  for (const match of text.matchAll(/`([^`\n]+)`/g)) push(match[1], match.index ?? 0);
  return out;
}

function refExists(repo: RepoSnapshot, fromFile: string, ref: string): boolean {
  let target = ref.split("#")[0].split("?")[0];
  if (target.endsWith("/")) target = target.slice(0, -1);
  if (!target) return true;
  const candidates: string[] = [];
  const add = (value: string): void => {
    const norm = path.posix.normalize(value);
    if (!norm || norm === "." || norm.startsWith("../") || norm === "..") return;
    candidates.push(normRel(norm));
  };
  if (target.startsWith("/")) add(target.slice(1));
  else {
    const dir = parentDir(fromFile);
    add(dir ? `${dir}/${target}` : target);
    add(target);
  }
  if (!candidates.length) return true;
  const paths = repo.list();
  return candidates.some((candidate) => {
    if (repo.exists(candidate)) return true;
    const prefix = candidate + "/";
    return paths.some((item) => item.startsWith(prefix));
  });
}

function deadReferenceIssues(files: InstructionFile[], repo: RepoSnapshot): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const ref of extractRefs(file.content)) {
      if (refExists(repo, file.path, ref.ref)) continue;
      const key = `${file.path}|${ref.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        rule: "dead-reference",
        severity: "warning",
        message: `missing path "${ref.ref.split("#")[0]}"`,
        files: [file.path],
        line: ref.line,
      });
    }
  }
  return issues;
}

interface ScriptUse {
  tool: "npm" | "make" | "just";
  name: string;
  raw: string;
}

function scriptUses(command: string): ScriptUse[] {
  const uses: ScriptUse[] = [];
  const run = /\b(?:npm|pnpm|yarn|bun)\s+run\s+([A-Za-z0-9][A-Za-z0-9:_./-]*)/g;
  const alias = /\b(?:npm|pnpm|yarn|bun)\s+(test|start|lint|build|dev|format|typecheck|check|serve)\b/g;
  const make = /\bmake\s+(?:-[A-Za-z0-9]+\s+)*([A-Za-z][A-Za-z0-9_.-]*)/g;
  const just = /\bjust\s+(?:-[A-Za-z0-9]+\s+)*([A-Za-z][A-Za-z0-9_-]*)/g;
  for (const match of command.matchAll(run)) {
    uses.push({ tool: "npm", name: match[1], raw: match[0] });
  }
  for (const match of command.matchAll(alias)) {
    uses.push({ tool: "npm", name: match[1], raw: match[0] });
  }
  for (const match of command.matchAll(make)) {
    uses.push({ tool: "make", name: match[1], raw: match[0] });
  }
  for (const match of command.matchAll(just)) {
    uses.push({ tool: "just", name: match[1], raw: match[0] });
  }
  return uses;
}

function makefileTargets(text: string): Set<string> {
  const targets = new Set<string>();
  for (const line of text.split("\n")) {
    if (/^\s/.test(line) || line.startsWith("#")) continue;
    const phony = line.match(/^\.PHONY:\s*(.+)$/);
    if (phony) {
      for (const target of phony[1].split(/\s+/)) if (target) targets.add(target);
      continue;
    }
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/);
    if (match) targets.add(match[1]);
  }
  return targets;
}

const JUST_RESERVED = new Set(["set", "export", "alias", "mod", "import", "if", "else"]);

function justTargets(text: string): Set<string> {
  const targets = new Set<string>();
  for (const line of text.split("\n")) {
    if (/^\s/.test(line) || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\b.*:$/);
    if (!match || JUST_RESERVED.has(match[1])) continue;
    targets.add(match[1]);
  }
  return targets;
}

function collectDefined(repo: RepoSnapshot, ignored: (rel: string) => boolean): {
  npm: Set<string>;
  make: Set<string>;
  just: Set<string>;
} {
  const npm = new Set<string>();
  const make = new Set<string>();
  const just = new Set<string>();
  for (const rel of repo.list()) {
    if (ignored(rel)) continue;
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    const text = repo.read(rel);
    if (text === null) continue;
    if (base === "package.json") {
      try {
        const parsed = JSON.parse(text) as { scripts?: Record<string, unknown> };
        for (const name of Object.keys(parsed.scripts ?? {})) npm.add(name);
      } catch {
        continue;
      }
    } else if (base === "Makefile" || base === "makefile" || base === "GNUmakefile") {
      for (const target of makefileTargets(text)) make.add(target);
    } else if (base === "justfile" || base === "Justfile" || base === ".justfile") {
      for (const target of justTargets(text)) just.add(target);
    }
  }
  return { npm, make, just };
}

function missingScriptIssues(
  files: InstructionFile[],
  repo: RepoSnapshot,
  ignored: (rel: string) => boolean,
): Issue[] {
  const defined = collectDefined(repo, ignored);
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const command of commandStrings(file.content)) {
      for (const use of scriptUses(command)) {
        const key = `${file.path}|${use.tool}|${use.name}`;
        if (seen.has(key)) continue;
        const ok =
          use.tool === "npm"
            ? defined.npm.has(use.name)
            : use.tool === "make"
              ? defined.make.has(use.name)
              : defined.just.has(use.name);
        if (ok) continue;
        seen.add(key);
        const where =
          use.tool === "npm"
            ? "package.json"
            : use.tool === "make"
              ? "a Makefile"
              : "a justfile";
        const noun = use.tool === "npm" ? "script" : use.tool === "make" ? "target" : "recipe";
        issues.push({
          rule: "missing-script",
          severity: "error",
          message: `${noun} "${use.name}" from \`${use.raw}\` is not in ${where}`,
          files: [file.path],
          line: lineOf(file.content, use.raw),
        });
      }
    }
  }
  return issues;
}

function pathInScope(file: string, scope: string): boolean {
  return isInside(file, scope);
}

function unmatchedGlobIssues(files: InstructionFile[], paths: string[]): Issue[] {
  const issues: Issue[] = [];
  for (const file of files) {
    if (file.kind === "cursor-rule") {
      for (const glob of file.frontmatter.globs) {
        const hit = paths.some(
          (item) => pathInScope(item, file.scope) && matchScoped([glob], item, file.scope),
        );
        if (hit) continue;
        issues.push({
          rule: "unmatched-glob",
          severity: "warning",
          message: `glob "${glob}" matches no files`,
          files: [file.path],
          line: file.frontmatter.globLine ?? 1,
        });
      }
    }
    if (file.kind === "instructions") {
      if (!file.frontmatter.hasApplyTo) {
        issues.push({
          rule: "unmatched-glob",
          severity: "warning",
          message: "instructions file has no applyTo glob and does not apply",
          files: [file.path],
          line: 1,
        });
        continue;
      }
      for (const glob of file.frontmatter.applyTo) {
        const hit = paths.some(
          (item) => pathInScope(item, file.scope) && matchScoped([glob], item, file.scope),
        );
        if (hit) continue;
        issues.push({
          rule: "unmatched-glob",
          severity: "warning",
          message: `applyTo "${glob}" matches no files`,
          files: [file.path],
          line: file.frontmatter.applyToLine ?? 1,
        });
      }
    }
  }
  return issues;
}

export function fileIssues(
  files: InstructionFile[],
  paths: string[],
  repo: RepoSnapshot,
  ignored: (rel: string) => boolean,
): Issue[] {
  return [
    ...deadReferenceIssues(files, repo),
    ...missingScriptIssues(files, repo, ignored),
    ...unmatchedGlobIssues(files, paths),
  ];
}
