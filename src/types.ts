import type { Frontmatter } from "./frontmatter";

export const RULES = [
  "package-manager",
  "command-conflict",
  "style-conflict",
  "must-never",
  "dead-reference",
  "missing-script",
  "unmatched-glob",
  "chain-budget",
] as const;

export type RuleId = (typeof RULES)[number];
export type Severity = "off" | "warning" | "error";

export const DEFAULT_SEVERITY: Record<RuleId, Severity> = {
  "package-manager": "error",
  "command-conflict": "error",
  "style-conflict": "warning",
  "must-never": "error",
  "dead-reference": "warning",
  "missing-script": "error",
  "unmatched-glob": "warning",
  "chain-budget": "warning",
};

export type Kind =
  | "agents"
  | "claude"
  | "cursor-rule"
  | "cursorrules"
  | "copilot"
  | "instructions";

export interface InstructionFile {
  path: string;
  kind: Kind;
  /** Directory this file can affect. Empty string is the repo root. */
  scope: string;
  /** Directory that contains the file. */
  dir: string;
  content: string;
  frontmatter: Frontmatter;
}

export interface Applied {
  file: InstructionFile;
  reason: string;
}

export interface Issue {
  rule: RuleId;
  severity: Exclude<Severity, "off">;
  message: string;
  /** Instruction files. The first entry is the annotation target. */
  files: string[];
  /** Example repo path whose chain produced a chain-level issue. */
  path?: string;
  line?: number;
}

export interface ChainEntry {
  path: string;
  kind: Kind;
  reason: string;
}

export interface ExplainResult {
  path: string;
  chain: ChainEntry[];
  overridden: ChainEntry[];
  tokens: number;
  bytes: number;
}
