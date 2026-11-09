import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli";
import { introduced } from "../src/lint";
import type { Issue } from "../src/types";
import { capture } from "./helpers";

function issue(partial: Partial<Issue> & Pick<Issue, "rule" | "message">): Issue {
  return {
    severity: "error",
    files: ["AGENTS.md"],
    line: 1,
    ...partial,
  };
}

describe("diff", () => {
  it("keeps issues that were not in the base set", () => {
    const kept = issue({ rule: "package-manager", message: "same" });
    const added = issue({ rule: "must-never", message: "new", files: ["CLAUDE.md"] });
    expect(introduced([kept, added], [kept])).toEqual([added]);
    expect(introduced([kept], [kept, added])).toEqual([]);
  });

  it("reports only issues introduced since a git ref", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentctx-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    git("init", "-b", "main");
    git("config", "user.email", "lint@example.com");
    git("config", "user.name", "lint");
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "Use npm. Install with `npm install`.\n");
    fs.writeFileSync(path.join(dir, "index.ts"), "export {}\n");
    git("add", ".");
    git("commit", "-m", "base");

    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "Use pnpm. Install with `pnpm install`.\n");
    const added = capture(dir);
    expect(main(["--diff", "HEAD", "--format", "json"], added.io)).toBe(1);
    const parsed = JSON.parse(added.read().out) as { issues: { rule: string }[] };
    expect(parsed.issues.map((item) => item.rule)).toEqual(["package-manager"]);

    git("add", ".");
    git("commit", "-m", "conflict");
    const clean = capture(dir);
    expect(main(["--diff", "HEAD", "--format", "json"], clean.io)).toBe(0);
    expect(JSON.parse(clean.read().out).issues).toEqual([]);

    const since = capture(dir);
    expect(main(["--diff", "HEAD~1", "--format", "json"], since.io)).toBe(1);
    expect(JSON.parse(since.read().out).issues.map((item: { rule: string }) => item.rule)).toEqual([
      "package-manager",
    ]);
  });

  it("fails when the scan root is not a git checkout", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentctx-nogit-"));
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "Use npm.\n");
    const cap = capture(dir);
    expect(main(["--diff", "HEAD"], cap.io)).toBe(2);
    expect(cap.read().err).toContain("agentctx:");
  });
});
