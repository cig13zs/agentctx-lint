import fs from "node:fs";
import path from "node:path";
import { explainPath } from "./chain";
import { loadConfig } from "./config";
import { formatExplain, formatIssues } from "./format";
import { lintDiff, lintDirectory } from "./lint";
import { VERSION } from "./version";

export interface IO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

export type OutputFormat = "text" | "json" | "github";

interface Args {
  command: "scan" | "explain";
  dir?: string;
  target?: string;
  format: OutputFormat;
  config?: string;
  diff?: string;
  failOnWarning: boolean;
  help: boolean;
  version: boolean;
}

const HELP = `agentctx-lint — lint AI agent instruction files

Usage:
  agentctx-lint [dir]
  agentctx-lint explain <path>
  agentctx-lint scan [dir]

Options:
  -f, --format <text|json|github>   Output format (default text)
  -c, --config <file>               Config file (default agentctx.config.json)
      --diff <git-ref>              Only issues introduced since this ref
      --fail-on-warning             Exit 1 when warnings are reported
      --version
  -h, --help

Exit 1 when an error is reported. Warnings alone exit 0.
`;

function need(value: string | undefined, flag: string): string {
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "scan",
    format: "text",
    failOnWarning: false,
    help: false,
    version: false,
  };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--version") args.version = true;
    else if (token === "--fail-on-warning") args.failOnWarning = true;
    else if (token === "--format" || token === "-f") args.format = need(argv[++i], token) as OutputFormat;
    else if (token.startsWith("--format=")) args.format = token.slice("--format=".length) as OutputFormat;
    else if (token === "--config" || token === "-c") args.config = need(argv[++i], token);
    else if (token.startsWith("--config=")) args.config = token.slice("--config=".length);
    else if (token === "--diff") args.diff = need(argv[++i], "--diff");
    else if (token.startsWith("--diff=")) args.diff = token.slice("--diff=".length);
    else if (token.startsWith("-")) throw new Error(`unknown option ${token}`);
    else positionals.push(token);
  }
  if (!["text", "json", "github"].includes(args.format)) {
    throw new Error(`unknown format ${args.format}`);
  }
  if (positionals[0] === "explain") {
    args.command = "explain";
    args.target = positionals[1];
    if (positionals.length > 2) throw new Error(`unexpected argument ${positionals[2]}`);
  } else if (positionals[0] === "scan") {
    args.dir = positionals[1];
    if (positionals.length > 2) throw new Error(`unexpected argument ${positionals[2]}`);
  } else if (positionals.length === 1) {
    args.dir = positionals[0];
  } else if (positionals.length > 1) {
    throw new Error(`unexpected argument ${positionals[1]}`);
  }
  if (args.command === "explain" && args.diff) throw new Error("explain does not support --diff");
  return args;
}

function defaultIO(): IO {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: process.cwd(),
  };
}

export function main(argv: string[], io: IO = defaultIO()): number {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      io.stdout(HELP);
      return 0;
    }
    if (args.version) {
      io.stdout(`${VERSION}\n`);
      return 0;
    }
    const root = path.resolve(io.cwd, args.dir ?? ".");
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`not a directory: ${root}`);
    }
    const config = loadConfig(root, args.config ? path.resolve(io.cwd, args.config) : undefined);
    if (args.command === "explain") {
      if (!args.target) throw new Error("explain requires a path");
      const result = explainPath(root, args.target, config);
      io.stdout(formatExplain(result, args.format === "json" ? "json" : "text"));
      return 0;
    }
    const issues = args.diff ? lintDiff(root, args.diff, config) : lintDirectory(root, config);
    io.stdout(formatIssues(issues, args.format));
    const errors = issues.filter((issue) => issue.severity === "error").length;
    const warnings = issues.length - errors;
    if (errors > 0) return 1;
    if (args.failOnWarning && warnings > 0) return 1;
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`agentctx: ${message}\n`);
    return 2;
  }
}
