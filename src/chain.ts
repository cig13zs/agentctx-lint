import path from "node:path";
import { loadConfig, type Config } from "./config";
import { discover } from "./discover";
import { matchScoped } from "./glob";
import { isInside, parentDir, safeRel } from "./paths";
import { diskSnapshot, type RepoSnapshot } from "./repo";
import type { Applied, ChainEntry, ExplainResult, InstructionFile } from "./types";

export interface Resolution {
  chain: Applied[];
  overridden: Applied[];
}

function byPath(a: InstructionFile, b: InstructionFile): number {
  return a.path.localeCompare(b.path);
}

function inScope(file: InstructionFile, targetFile: string, targetDir: string): boolean {
  if (!file.scope) return true;
  return isInside(targetFile, file.scope) || isInside(targetDir, file.scope);
}

function cursorReason(file: InstructionFile, targetFile: string, targetDir: string): string | null {
  if (!inScope(file, targetFile, targetDir)) return null;
  if (file.frontmatter.alwaysApply) return "alwaysApply";
  if (!file.frontmatter.globs.length) return null;
  const hit = matchScoped(file.frontmatter.globs, targetFile, file.scope);
  return hit ? `glob ${hit}` : null;
}

function instructionReason(file: InstructionFile, targetFile: string, targetDir: string): string | null {
  if (!file.frontmatter.hasApplyTo) return null;
  if (!inScope(file, targetFile, targetDir)) return null;
  const hit = matchScoped(file.frontmatter.applyTo, targetFile, file.scope);
  return hit ? `applyTo ${hit}` : null;
}

/**
 * Lowest precedence first. Nearest AGENTS.md replaces ancestor AGENTS.md files.
 * CLAUDE.md stacks from the repo root down to the target.
 */
export function resolve(targetFile: string, targetDir: string, files: InstructionFile[]): Resolution {
  const agents = files
    .filter((file) => file.kind === "agents" && isInside(targetDir, file.dir))
    .sort((a, b) => a.dir.length - b.dir.length || a.path.localeCompare(b.path));
  const winner = agents[agents.length - 1];
  const overridden: Applied[] = agents
    .filter((file) => file !== winner)
    .map((file) => ({
      file,
      reason: winner ? `overridden by ${winner.path}` : "overridden",
    }));

  const chain: Applied[] = [];
  const pushKind = (kind: InstructionFile["kind"], reason: string): void => {
    for (const file of files.filter((item) => item.kind === kind).sort(byPath)) {
      if (isInside(targetDir, file.scope)) chain.push({ file, reason });
    }
  };
  pushKind("cursorrules", "root");
  pushKind("copilot", "root");

  for (const file of files.filter((item) => item.kind === "cursor-rule").sort(byPath)) {
    const reason = cursorReason(file, targetFile, targetDir);
    if (reason) chain.push({ file, reason });
  }
  for (const file of files.filter((item) => item.kind === "instructions").sort(byPath)) {
    const reason = instructionReason(file, targetFile, targetDir);
    if (reason) chain.push({ file, reason });
  }

  const claudes = files
    .filter((file) => file.kind === "claude" && isInside(targetDir, file.dir))
    .sort((a, b) => a.dir.length - b.dir.length || a.path.localeCompare(b.path));
  for (const file of claudes) chain.push({ file, reason: "directory" });
  if (winner) chain.push({ file: winner, reason: "nearest" });

  return { chain, overridden };
}

export function locate(paths: string[], target: string): { dir: string; file: string } {
  if (!target) return { dir: "", file: "" };
  if (paths.includes(target)) return { dir: parentDir(target), file: target };
  if (paths.some((item) => item.startsWith(target + "/"))) return { dir: target, file: target };
  const base = target.slice(target.lastIndexOf("/") + 1);
  if (base.includes(".")) return { dir: parentDir(target), file: target };
  return { dir: target, file: target };
}

function toEntry(applied: Applied): ChainEntry {
  return { path: applied.file.path, kind: applied.file.kind, reason: applied.reason };
}

export function measure(chain: Applied[]): { tokens: number; bytes: number } {
  let chars = 0;
  let bytes = 0;
  for (const applied of chain) {
    chars += applied.file.content.length;
    bytes += Buffer.byteLength(applied.file.content, "utf8");
  }
  return { tokens: Math.ceil(chars / 4), bytes };
}

export function explainSnapshot(repo: RepoSnapshot, config: Config, target: string): ExplainResult {
  const located = locate(repo.list(), target);
  const resolution = resolve(located.file, located.dir, discover(repo, config));
  const size = measure(resolution.chain);
  return {
    path: target || ".",
    chain: resolution.chain.map(toEntry),
    overridden: resolution.overridden.map(toEntry),
    tokens: size.tokens,
    bytes: size.bytes,
  };
}

export function explainPath(root: string, target: string, config?: Config): ExplainResult {
  const abs = path.resolve(root);
  const rel = safeRel(abs, target);
  const cfg = config ?? loadConfig(abs);
  return explainSnapshot(diskSnapshot(abs), cfg, rel);
}
