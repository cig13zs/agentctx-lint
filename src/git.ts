import { execFileSync } from "node:child_process";
import path from "node:path";
import { normRel } from "./paths";
import type { RepoSnapshot } from "./repo";

function git(args: string[], cwd: string, maxBuffer = 32 * 1024 * 1024): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const error = err as { stderr?: Buffer | string; message?: string };
    const stderr = error.stderr ? error.stderr.toString().trim() : "";
    throw new Error(stderr || error.message || "git command failed");
  }
}

/** Instruction files and manifests as they exist at `ref`. Paths stay repo-relative. */
export function gitSnapshot(root: string, ref: string): RepoSnapshot {
  const abs = path.resolve(root);
  let top: string;
  try {
    top = git(["rev-parse", "--show-toplevel"], abs).trim();
  } catch {
    throw new Error("not a git repository");
  }
  if (path.resolve(top) !== abs) {
    throw new Error("diff mode expects the scan directory to be the git root");
  }
  let rev: string;
  try {
    rev = git(["rev-parse", "--verify", `${ref}^{commit}`], abs).trim();
  } catch {
    throw new Error(`cannot resolve git ref "${ref}"`);
  }
  const files = git(["ls-tree", "-r", "--name-only", rev], abs)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
  const set = new Set(files);
  const cache = new Map<string, string | null>();
  return {
    list: () => files.slice(),
    exists: (rel) => set.has(normRel(rel)),
    read: (rel) => {
      const name = normRel(rel);
      if (!set.has(name)) return null;
      if (cache.has(name)) return cache.get(name) ?? null;
      try {
        const out = git(["show", `${rev}:${name}`], abs, 2 * 1024 * 1024);
        const text = out.includes("\0") ? null : out.replace(/\r\n/g, "\n");
        cache.set(name, text);
        return text;
      } catch {
        cache.set(name, null);
        return null;
      }
    },
  };
}
