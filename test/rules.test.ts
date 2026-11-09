import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config";
import { lintDirectory, lintSnapshot } from "../src/lint";
import { diskSnapshot, memorySnapshot } from "../src/repo";
import { RULES } from "../src/types";
import { fixture, repoRoot } from "./helpers";

function rules(name: string): string[] {
  return lintDirectory(fixture(name)).map((issue) => issue.rule);
}

describe("rules", () => {
  it("flags a package manager clash only when both files apply", () => {
    const issues = lintDirectory(fixture("package-manager"));
    expect(issues.map((issue) => issue.rule)).toEqual(["package-manager"]);
    expect(issues[0].message).toContain("npm");
    expect(issues[0].message).toContain("pnpm");
    expect(issues[0].files).toContain("AGENTS.md");
    expect(issues[0].files).toContain("CLAUDE.md");
  });

  it("does not clash when a nearer AGENTS.md overrides the root", () => {
    expect(rules("override")).toEqual([]);
  });

  it("flags test and build commands that do not overlap", () => {
    const issues = lintDirectory(fixture("command-conflict"));
    expect(issues.map((issue) => issue.rule)).toEqual(["command-conflict", "command-conflict"]);
    expect(issues.map((issue) => issue.message).join("\n")).toContain("vitest run");
    expect(issues.map((issue) => issue.message).join("\n")).toContain("pytest -q");
    expect(issues.map((issue) => issue.message).join("\n")).toContain("tsc -b");
    expect(issues.map((issue) => issue.message).join("\n")).toContain("go build ./...");
  });

  it("flags indent, quotes, and semicolons", () => {
    const issues = lintDirectory(fixture("style-conflict"));
    expect(issues).toHaveLength(3);
    expect(new Set(issues.map((issue) => issue.rule))).toEqual(new Set(["style-conflict"]));
    const text = issues.map((issue) => issue.message).join("\n");
    expect(text).toContain("2 spaces");
    expect(text).toContain("tabs");
    expect(text).toContain("single quotes");
    expect(text).toContain("double quotes");
    expect(text).toContain("no semicolons");
  });

  it("flags opposite must and never rules on the same topic", () => {
    const issues = lintDirectory(fixture("must-never"));
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("must-never");
    expect(issues[0].message).toContain("write unit tests for every change");
    expect(issues[0].message).not.toContain("public functions");
  });

  it("flags missing paths and ignores urls and Node.js", () => {
    const issues = lintDirectory(fixture("dead-reference"));
    expect(issues.map((issue) => issue.rule)).toEqual(["dead-reference", "dead-reference"]);
    const text = issues.map((issue) => issue.message).join("\n");
    expect(text).toContain("docs/guide.md");
    expect(text).toContain("scripts/setup.sh");
    expect(text).not.toContain("README.md");
    expect(text).not.toContain("Node.js");
    expect(text).not.toContain("example.com");
  });

  it("flags scripts and targets that are not defined", () => {
    const issues = lintDirectory(fixture("missing-script"));
    expect(issues.map((issue) => issue.rule)).toEqual([
      "missing-script",
      "missing-script",
      "missing-script",
    ]);
    const text = issues.map((issue) => issue.message).join("\n");
    expect(text).toContain('script "build"');
    expect(text).toContain('target "lint"');
    expect(text).toContain('recipe "deploy"');
    expect(text).not.toContain('"test"');
  });

  it("flags globs and applyTo patterns that match nothing", () => {
    const issues = lintDirectory(fixture("unmatched-glob"));
    expect(issues).toHaveLength(2);
    const text = issues.map((issue) => issue.message).join("\n");
    expect(text).toContain('glob "**/*.py"');
    expect(text).toContain("no applyTo");
    expect(text).not.toContain("**/*.ts");
  });

  it("flags a chain over the configured budget", () => {
    const issues = lintDirectory(fixture("chain-budget"));
    expect(issues.map((issue) => issue.rule)).toEqual(["chain-budget"]);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("exceeds budget");
  });

  it("limits a glob rule to files that match", () => {
    const issues = lintDirectory(fixture("glob-scope"));
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("package-manager");
    expect(issues[0].path).toBe("docs/guide.md");
  });

  it("keeps a nested alwaysApply rule inside its package", () => {
    const issues = lintDirectory(fixture("subtree"));
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("package-manager");
    expect(issues[0].path?.startsWith("packages/web/")).toBe(true);
    expect(issues[0].files).toContain("packages/web/.cursor/rules/web.mdc");
  });

  it("skips ignored directories from config", () => {
    expect(rules("ignore")).toEqual([]);
    const bare = lintSnapshot(diskSnapshot(fixture("ignore")), defaultConfig());
    expect(bare.map((issue) => issue.rule)).toContain("package-manager");
  });

  it("turns a rule off", () => {
    const config = defaultConfig();
    config.rules["package-manager"] = "off";
    expect(lintSnapshot(diskSnapshot(fixture("package-manager")), config)).toEqual([]);
  });

  it("ignores a file that names two package managers", () => {
    const repo = memorySnapshot({
      "AGENTS.md": "Use npm. Use pnpm.\n",
      "CLAUDE.md": "Use yarn. Install with `yarn install`.\n",
      "index.ts": "export {}\n",
    });
    expect(lintSnapshot(repo, defaultConfig())).toEqual([]);
  });

  it("treats a negated package manager as not endorsed", () => {
    const repo = memorySnapshot({
      "AGENTS.md": "Use pnpm, not npm. Install with `pnpm install`.\n",
      "CLAUDE.md": "Use npm. Install with `npm install`.\n",
      "index.ts": "export {}\n",
    });
    const issues = lintSnapshot(repo, defaultConfig());
    expect(issues.map((issue) => issue.rule)).toEqual(["package-manager"]);
    expect(issues[0].message).toContain("pnpm (AGENTS.md)");
    expect(issues[0].message).toContain("npm (CLAUDE.md)");
  });

  it("reports every rule from the demo fixture", () => {
    const found = rules("demo").sort();
    expect(found).toEqual([...RULES].sort());
  });

  it("stays quiet on a consistent tree and on this repo", () => {
    expect(rules("clean")).toEqual([]);
    expect(lintDirectory(repoRoot)).toEqual([]);
  });
});
