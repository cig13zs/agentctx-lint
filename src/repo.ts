import fs from "node:fs";
import path from "node:path";
import { normRel } from "./paths";

export interface RepoSnapshot {
  list(): string[];
  read(rel: string): string | null;
  exists(rel: string): boolean;
}

function skipDir(name: string): boolean {
  return name === ".git" || name === "node_modules";
}

export function diskSnapshot(root: string): RepoSnapshot {
  const abs = path.resolve(root);
  const files: string[] = [];

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skipDir(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = normRel(path.relative(abs, full));
      if (!rel || rel.startsWith("..")) continue;
      files.push(rel);
    }
  };

  walk(abs);
  files.sort();
  const set = new Set(files);

  return {
    list: () => files.slice(),
    exists: (rel) => set.has(normRel(rel)),
    read: (rel) => {
      const name = normRel(rel);
      if (!set.has(name)) return null;
      try {
        const buf = fs.readFileSync(path.join(abs, name));
        if (buf.includes(0)) return null;
        return buf.toString("utf8").replace(/\r\n/g, "\n");
      } catch {
        return null;
      }
    },
  };
}

export function memorySnapshot(files: Record<string, string>): RepoSnapshot {
  const map = new Map<string, string>();
  for (const [file, content] of Object.entries(files)) {
    const name = normRel(file);
    if (!name) continue;
    map.set(name, content.replace(/\r\n/g, "\n"));
  }
  const paths = [...map.keys()].sort();
  const set = new Set(paths);
  return {
    list: () => paths.slice(),
    exists: (rel) => set.has(normRel(rel)),
    read: (rel) => map.get(normRel(rel)) ?? null,
  };
}
