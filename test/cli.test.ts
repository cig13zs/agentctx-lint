import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli";
import { fixture, capture, repoRoot } from "./helpers";

describe("cli", () => {
  it("prints help and version", () => {
    const help = capture(repoRoot);
    expect(main(["--help"], help.io)).toBe(0);
    expect(help.read().out).toContain("explain");
    const version = capture(repoRoot);
    expect(main(["--version"], version.io)).toBe(0);
    expect(version.read().out.trim()).toBe("0.1.0");
  });

  it("exits 1 for errors and 0 for warnings", () => {
    const errors = capture(fixture("package-manager"));
    expect(main([], errors.io)).toBe(1);
    expect(errors.read().out).toContain("package-manager");
    expect(errors.read().out).toContain("1 error");

    const warnings = capture(fixture("style-conflict"));
    expect(main([], warnings.io)).toBe(0);
    expect(warnings.read().out).toContain("style-conflict");

    const strict = capture(fixture("style-conflict"));
    expect(main(["--fail-on-warning"], strict.io)).toBe(1);
  });

  it("writes json and github annotations", () => {
    const json = capture(fixture("package-manager"));
    expect(main(["--format", "json"], json.io)).toBe(1);
    const parsed = JSON.parse(json.read().out) as {
      version: string;
      summary: { errors: number; warnings: number };
      issues: { rule: string }[];
    };
    expect(parsed.version).toBe("0.1.0");
    expect(parsed.summary).toEqual({ errors: 1, warnings: 0 });
    expect(parsed.issues[0].rule).toBe("package-manager");

    const github = capture(fixture("package-manager"));
    expect(main(["--format", "github"], github.io)).toBe(1);
    expect(github.read().out).toContain("::error file=AGENTS.md");
    expect(github.read().out).toContain("title=package-manager::");
  });

  it("explains a path as text and json", () => {
    const text = capture(fixture("chain"));
    expect(main(["explain", "src/pkg/index.ts"], text.io)).toBe(0);
    expect(text.read().out).toContain("src/pkg/AGENTS.md");
    expect(text.read().out).toContain("overridden:");
    expect(text.read().out).toContain("AGENTS.md");

    const json = capture(fixture("override"));
    expect(main(["explain", "src/index.ts", "--format", "json"], json.io)).toBe(0);
    const parsed = JSON.parse(json.read().out) as { chain: { path: string }[]; overridden: { path: string }[] };
    expect(parsed.chain.map((entry) => entry.path)).toEqual(["src/AGENTS.md"]);
    expect(parsed.overridden.map((entry) => entry.path)).toEqual(["AGENTS.md"]);
  });

  it("returns 2 for bad usage and a missing config", () => {
    const bad = capture(repoRoot);
    expect(main(["--format", "xml"], bad.io)).toBe(2);
    expect(bad.read().err).toContain("unknown format");

    const missing = capture(fixture("clean"));
    expect(main(["--config", "nope.json"], missing.io)).toBe(2);
    expect(missing.read().err).toContain("config not found");
  });

  it("ships a composite action that runs the built cli", () => {
    const action = fs.readFileSync(path.join(repoRoot, "action.yml"), "utf8");
    expect(action).toContain("using: composite");
    expect(action).toContain("dist/bin.js");
    expect(action).toContain("fail-on-warning");
    expect(action).toContain("npm ci");
  });

  it("runs the built binary", () => {
    const bin = path.join(repoRoot, "dist/bin.js");
    const out = execFileSync(process.execPath, [bin, "--version"], { encoding: "utf8" });
    expect(out.trim()).toBe("0.1.0");
    const scan = execFileSync(process.execPath, [bin, fixture("clean")], { encoding: "utf8" });
    expect(scan).toContain("no issues");
  });
});
