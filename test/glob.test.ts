import { describe, expect, it } from "vitest";
import { matchGlobs, splitGlobs } from "../src/glob";
import { parseFrontmatter } from "../src/frontmatter";

describe("globs", () => {
  it("matches stars, double stars, and braces", () => {
    expect(matchGlobs(["**/*.ts"], "a.ts")).toBe("**/*.ts");
    expect(matchGlobs(["**/*.ts"], "src/a.ts")).toBe("**/*.ts");
    expect(matchGlobs(["**/*.ts"], "a.js")).toBeNull();
    expect(matchGlobs(["src/**/*.ts"], "src/a.ts")).toBe("src/**/*.ts");
    expect(matchGlobs(["src/**/*.ts"], "src/b/a.ts")).toBe("src/**/*.ts");
    expect(matchGlobs(["src/**/*.ts"], "lib/a.ts")).toBeNull();
    expect(matchGlobs(["*.md"], "README.md")).toBe("*.md");
    expect(matchGlobs(["*.md"], "docs/a.md")).toBeNull();
    expect(matchGlobs(["docs/**/*.md"], "docs/guide.md")).toBe("docs/**/*.md");
    expect(matchGlobs(["docs/**/*.md"], "src/docs/a.md")).toBeNull();
    expect(matchGlobs(["**/*.{ts,tsx}"], "src/a.tsx")).toBe("**/*.{ts,tsx}");
    expect(matchGlobs(["**/*.{ts,tsx}"], "src/a.js")).toBeNull();
  });

  it("lets a later negation win", () => {
    const patterns = ["**/*.ts", "!**/*.test.ts"];
    expect(matchGlobs(patterns, "src/foo.ts")).toBe("**/*.ts");
    expect(matchGlobs(patterns, "src/foo.test.ts")).toBeNull();
  });

  it("does not split commas inside braces", () => {
    expect(splitGlobs("**/*.{ts,tsx}, src/**/*.md")).toEqual(["**/*.{ts,tsx}", "src/**/*.md"]);
  });
});

describe("frontmatter", () => {
  it("parses globs, alwaysApply, and applyTo", () => {
    const text = `---
description: TypeScript files
alwaysApply: false
globs: "**/*.ts, **/*.tsx"
applyTo:
  - "src/**/*.ts"
  - "lib/**/*.ts"
---
Body line.
`;
    const parsed = parseFrontmatter(text);
    expect(parsed.body).toBe("Body line.\n");
    expect(parsed.frontmatter.description).toBe("TypeScript files");
    expect(parsed.frontmatter.alwaysApply).toBe(false);
    expect(parsed.frontmatter.globs).toEqual(["**/*.ts", "**/*.tsx"]);
    expect(parsed.frontmatter.hasApplyTo).toBe(true);
    expect(parsed.frontmatter.applyTo).toEqual(["src/**/*.ts", "lib/**/*.ts"]);
    expect(parsed.frontmatter.globLine).toBe(4);
  });

  it("parses an inline list and a true flag", () => {
    const parsed = parseFrontmatter(`---
alwaysApply: true
globs: ["src/**/*.ts", "src/**/*.tsx"]
---
Hi
`);
    expect(parsed.frontmatter.alwaysApply).toBe(true);
    expect(parsed.frontmatter.globs).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
  });

  it("returns empty frontmatter when the file has none", () => {
    const parsed = parseFrontmatter("Just text\n");
    expect(parsed.frontmatter.globs).toEqual([]);
    expect(parsed.frontmatter.alwaysApply).toBe(false);
    expect(parsed.body).toBe("Just text\n");
  });
});
