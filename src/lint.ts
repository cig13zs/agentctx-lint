import path from "node:path";
import { discover } from "./discover";
import { locate, resolve } from "./chain";
import { isIgnored, loadConfig, type Config } from "./config";
import { gitSnapshot } from "./git";
import { diskSnapshot, type RepoSnapshot } from "./repo";
import { chainIssues, fileIssues } from "./rules";
import type { Issue } from "./types";

const META_FILES = new Set([
  "package.json",
  "package-lock.json",
  "agentctx.config.json",
  "Makefile",
  "makefile",
  "GNUmakefile",
  "justfile",
  "Justfile",
  ".justfile",
]);

/** Lower is a better sample path for a chain-level issue. */
function exampleRank(target: string, instructionPaths: Set<string>): number {
  if (!target || target === ".") return 3;
  if (instructionPaths.has(target)) return 2;
  const base = target.slice(target.lastIndexOf("/") + 1);
  if (META_FILES.has(base)) return 1;
  return 0;
}

function compareIssues(a: Issue, b: Issue): number {
  const file = (a.files[0] ?? "").localeCompare(b.files[0] ?? "");
  if (file) return file;
  const line = (a.line ?? 0) - (b.line ?? 0);
  if (line) return line;
  const rule = a.rule.localeCompare(b.rule);
  if (rule) return rule;
  return a.message.localeCompare(b.message);
}

function applySeverity(issues: Issue[], config: Config): Issue[] {
  const out: Issue[] = [];
  for (const issue of issues) {
    const severity = config.rules[issue.rule];
    if (severity === "off") continue;
    out.push({ ...issue, severity });
  }
  return out;
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const issue of issues) {
    const key = [
      issue.rule,
      issue.message,
      [...issue.files].sort().join(","),
      String(issue.line ?? ""),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

export function fingerprint(issue: Issue): string {
  return [issue.rule, issue.severity, [...issue.files].sort().join(","), issue.message].join("|");
}

export function introduced(current: Issue[], base: Issue[]): Issue[] {
  const previous = new Set(base.map(fingerprint));
  return current.filter((issue) => !previous.has(fingerprint(issue)));
}

export function lintSnapshot(repo: RepoSnapshot, config: Config): Issue[] {
  const paths = repo.list().filter((item) => !isIgnored(item, config.ignore)).sort();
  const instructions = discover(repo, config);
  const instructionPaths = new Set(instructions.map((file) => file.path));
  const chains = new Map<string, { chain: ReturnType<typeof resolve>["chain"]; example: string }>();
  const targets = paths.length ? paths : [""];
  for (const target of targets) {
    const located = locate(paths, target);
    const resolution = resolve(located.file, located.dir, instructions);
    const key = resolution.chain.map((item) => item.file.path).join("\0");
    const example = target || ".";
    const existing = chains.get(key);
    if (!existing) chains.set(key, { chain: resolution.chain, example });
    else if (exampleRank(example, instructionPaths) < exampleRank(existing.example, instructionPaths)) {
      existing.example = example;
    }
  }

  const issues: Issue[] = [];
  for (const { chain, example } of chains.values()) {
    for (const issue of chainIssues(chain, config.budgets)) {
      issues.push({ ...issue, path: example });
    }
  }
  issues.push(...fileIssues(instructions, paths, repo, (rel) => isIgnored(rel, config.ignore)));
  return dedupe(applySeverity(issues, config)).sort(compareIssues);
}

export function lintDirectory(root: string, config?: Config): Issue[] {
  const abs = path.resolve(root);
  const cfg = config ?? loadConfig(abs);
  return lintSnapshot(diskSnapshot(abs), cfg);
}

export function lintDiff(root: string, ref: string, config?: Config): Issue[] {
  const abs = path.resolve(root);
  const cfg = config ?? loadConfig(abs);
  const current = lintSnapshot(diskSnapshot(abs), cfg);
  const base = lintSnapshot(gitSnapshot(abs, ref), cfg);
  return introduced(current, base);
}
