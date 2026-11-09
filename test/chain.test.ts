import { describe, expect, it } from "vitest";
import { explainPath } from "../src/chain";
import { lintDirectory } from "../src/lint";
import { fixture } from "./helpers";

describe("instruction chain", () => {
  const root = fixture("chain");

  it("stacks claude files and keeps only the nearest AGENTS.md", () => {
    const result = explainPath(root, "src/pkg/index.ts");
    expect(result.chain.map((entry) => [entry.path, entry.kind, entry.reason])).toEqual([
      [".cursorrules", "cursorrules", "root"],
      [".github/copilot-instructions.md", "copilot", "root"],
      [".cursor/rules/always.mdc", "cursor-rule", "alwaysApply"],
      [".cursor/rules/ts.mdc", "cursor-rule", "glob **/*.ts"],
      [".github/instructions/ts.instructions.md", "instructions", "applyTo **/*.ts"],
      ["CLAUDE.md", "claude", "directory"],
      ["src/CLAUDE.md", "claude", "directory"],
      ["src/pkg/AGENTS.md", "agents", "nearest"],
    ]);
    expect(result.overridden.map((entry) => [entry.path, entry.reason])).toEqual([
      ["AGENTS.md", "overridden by src/pkg/AGENTS.md"],
    ]);
    expect(result.tokens).toBeGreaterThan(0);
  });

  it("skips globs that do not match the file", () => {
    const result = explainPath(root, "src/pkg/note.md");
    expect(result.chain.map((entry) => entry.path)).toEqual([
      ".cursorrules",
      ".github/copilot-instructions.md",
      ".cursor/rules/always.mdc",
      "CLAUDE.md",
      "src/CLAUDE.md",
      "src/pkg/AGENTS.md",
    ]);
  });

  it("keeps a nested cursor rule inside its subtree", () => {
    const result = explainPath(root, "packages/web/app.ts");
    expect(result.chain.map((entry) => entry.path)).toEqual([
      ".cursorrules",
      ".github/copilot-instructions.md",
      ".cursor/rules/always.mdc",
      ".cursor/rules/ts.mdc",
      "packages/web/.cursor/rules/local.mdc",
      ".github/instructions/ts.instructions.md",
      "CLAUDE.md",
      "AGENTS.md",
    ]);
    expect(result.overridden).toEqual([]);
  });

  it("does not treat a description-only rule as part of the chain", () => {
    const result = explainPath(root, "src/pkg/index.ts");
    expect(result.chain.some((entry) => entry.path.endsWith("manual.mdc"))).toBe(false);
    expect(result.chain.some((entry) => entry.path.endsWith("py.mdc"))).toBe(false);
  });

  it("flags the python glob and nothing else in the chain fixture", () => {
    const issues = lintDirectory(root);
    expect(issues.map((issue) => issue.rule)).toEqual(["unmatched-glob"]);
    expect(issues[0].message).toContain("**/*.py");
  });
});
