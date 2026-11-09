import path from "node:path";

/** Repo-relative posix path. "." and empty both become "". */
export function normRel(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (normalized === "." || normalized === "") return "";
  return normalized;
}

export function parentDir(file: string): string {
  const rel = normRel(file);
  const slash = rel.lastIndexOf("/");
  if (slash === -1) return "";
  return rel.slice(0, slash);
}

/** True when child is parent or a path under parent. Empty parent is the repo root. */
export function isInside(child: string, parent: string): boolean {
  const c = normRel(child);
  const p = normRel(parent);
  if (p === "") return true;
  return c === p || c.startsWith(p + "/");
}

export function safeRel(root: string, target: string): string {
  const raw = path.isAbsolute(target) ? path.relative(root, target) : target;
  const norm = path.posix.normalize(normRel(raw));
  if (norm === ".." || norm.startsWith("../")) {
    throw new Error("path is outside the scan root");
  }
  return norm === "." ? "" : norm;
}
