import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IO } from "../src/cli";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function fixture(name: string): string {
  return path.join(repoRoot, "fixtures", name);
}

export function capture(cwd: string): { io: IO; read: () => { out: string; err: string } } {
  let out = "";
  let err = "";
  return {
    io: {
      cwd,
      stdout: (text) => {
        out += text;
      },
      stderr: (text) => {
        err += text;
      },
    },
    read: () => ({ out, err }),
  };
}
