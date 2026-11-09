# agentctx-lint

Lints AI agent instruction files. It builds the chain of files that apply to a path, then checks that chain for conflicts and stale references.

## Demo

`fixtures/demo` is a small repo with a clashing root `AGENTS.md` and `CLAUDE.md`.

```
$ npx agentctx-lint fixtures/demo
.cursor/rules/py.mdc:2  warning  unmatched-glob  glob "**/*.py" matches no files
AGENTS.md:1  warning  chain-budget  chain exceeds budget: 91 tokens (budget 30), 361 bytes (budget 120) (CLAUDE.md, AGENTS.md)  (src/index.ts)
AGENTS.md:3  error  package-manager  package manager disagrees: npm (CLAUDE.md) vs pnpm (AGENTS.md)  (src/index.ts)
AGENTS.md:4  error  command-conflict  test commands disagree: "pytest -q" (CLAUDE.md) vs "vitest run" (AGENTS.md)  (src/index.ts)
AGENTS.md:5  error  missing-script  script "lint" from `pnpm run lint` is not in package.json
AGENTS.md:6  warning  style-conflict  indentation disagrees: tabs (CLAUDE.md) vs 2 spaces (AGENTS.md)  (src/index.ts)
AGENTS.md:7  warning  dead-reference  missing path "docs/setup.md"
AGENTS.md:9  error  must-never  must/never disagree on "write unit tests for every change": CLAUDE.md forbids it, AGENTS.md requires it  (src/index.ts)

4 errors, 4 warnings
```

The path in parentheses is one file that pulled that chain in. Exit code is 1 because there are errors.

`explain` prints the chain for one path. From `fixtures/chain`:

```
$ npx agentctx-lint explain src/pkg/index.ts
src/pkg/index.ts
tokens: 68
bytes: 269

applies:
  1. .cursorrules  cursorrules  root
  2. .github/copilot-instructions.md  copilot  root
  3. .cursor/rules/always.mdc  cursor-rule  alwaysApply
  4. .cursor/rules/ts.mdc  cursor-rule  glob **/*.ts
  5. .github/instructions/ts.instructions.md  instructions  applyTo **/*.ts
  6. CLAUDE.md  claude  directory
  7. src/CLAUDE.md  claude  directory
  8. src/pkg/AGENTS.md  agents  nearest

overridden:
  - AGENTS.md  agents  overridden by src/pkg/AGENTS.md
```

## Install

Node 18 or newer. The package is not published. From a checkout:

```
npm install
npx agentctx-lint
npx agentctx-lint explain src/index.ts
```

`npm install` compiles `dist/`. Warnings alone exit 0. `--fail-on-warning` makes them fail the process.

## What applies

A conflict is reported only when both files are on the same path's chain.

| File | Scope |
| --- | --- |
| `AGENTS.md` | That directory and below. The nearest file wins. Ancestors drop out. |
| `CLAUDE.md` | Every file from the repo root down to the path. |
| `.cursorrules` | Repo root. |
| `.cursor/rules/*.mdc` | `alwaysApply: true`, otherwise `globs`. A nested `.cursor/rules` directory stays inside its parent. No globs and `alwaysApply: false` means the file is not auto-applied. |
| `.github/copilot-instructions.md` | Repo root. |
| `.github/instructions/*.instructions.md` | `applyTo` globs. With no `applyTo`, the file never applies. |

Low precedence to high: `.cursorrules`, copilot instructions, cursor rules, path instructions, `CLAUDE.md` from the outside in, then the nearest `AGENTS.md`.

Globs accept `*`, `**`, `?`, `{a,b}`, and a leading `!`. Nested rules are matched against the repo path and against the path relative to their directory.

## Rules

| Rule | Default | Checks |
| --- | --- | --- |
| `package-manager` | error | Two files in one chain endorse different managers (`npm`, `pnpm`, `yarn`, `bun`). A file counts only when it endorses exactly one. `use pnpm, not npm` is pnpm. |
| `command-conflict` | error | Test or build commands with nothing in common. `npm test` and `pnpm test` both normalize to `test`. |
| `style-conflict` | warning | Indentation, single vs double quotes, or semicolons. |
| `must-never` | error | `must` / `always` against `never` / `must not` / `do not` on the same phrase. Paraphrases are usually missed. |
| `dead-reference` | warning | Backtick paths and relative markdown links that are not in the repo. |
| `missing-script` | error | `npm` / `pnpm` / `yarn` / `bun` scripts, `make` targets, and `just` recipes that are not defined. |
| `unmatched-glob` | warning | `.mdc` globs or `applyTo` patterns that match no file. |
| `chain-budget` | warning | Chain size. Tokens are `ceil(chars / 4)`. |

## Config

`agentctx.config.json` in the scan root. `node_modules`, `dist`, `build`, `coverage`, `.next`, and `vendor` are always ignored. `ignore` adds more patterns.

```json
{
  "rules": {
    "style-conflict": "off",
    "dead-reference": "error"
  },
  "ignore": ["fixtures/**"],
  "budgets": {
    "maxTokens": 16000,
    "maxBytes": 65536
  }
}
```

Severity is `off`, `warning`, or `error`. Unknown rule names are an error.

## Diff

```
npx agentctx-lint --diff origin/main
```

Prints issues in the working tree that are not present at that git ref. The scan directory must be the git root.

## Formats

`--format text` (default), `json`, or `github`.

```
::warning file=CLAUDE.md,line=1,title=style-conflict::indentation disagrees: 2 spaces (.cursorrules) vs tabs (CLAUDE.md)
```

## Action

The action installs and builds this repo, then runs the CLI with the workflow workspace as the working directory. The runner needs Node 18+.

```yaml
- uses: ./
  with:
    format: github
    diff: origin/main
```

| Input | Default | |
| --- | --- | --- |
| `path` | `.` | Directory to scan |
| `format` | `github` | `text`, `json`, or `github` |
| `config` | | Config path. Empty uses `agentctx.config.json` in the scan root if it exists. |
| `diff` | | Git ref passed to `--diff` |
| `fail-on-warning` | `false` | Fail when warnings are reported |

## License

MIT.
