import fs from "node:fs";
import path from "node:path";
import { matchGlobs } from "./glob";
import { normRel } from "./paths";
import { DEFAULT_SEVERITY, RULES, type RuleId, type Severity } from "./types";

interface ConfigShape {
  rules?: Record<string, unknown>;
  ignore?: unknown;
  budgets?: { maxTokens?: unknown; maxBytes?: unknown };
}

export interface Budgets {
  maxTokens: number;
  maxBytes: number;
}

export interface Config {
  rules: Record<RuleId, Severity>;
  ignore: string[];
  budgets: Budgets;
}

export const DEFAULT_IGNORE = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/vendor/**",
];

export const DEFAULT_BUDGETS: Budgets = {
  maxTokens: 16000,
  maxBytes: 65536,
};

export function defaultConfig(): Config {
  return {
    rules: { ...DEFAULT_SEVERITY },
    ignore: DEFAULT_IGNORE.slice(),
    budgets: { ...DEFAULT_BUDGETS },
  };
}

export function isIgnored(rel: string, patterns: string[]): boolean {
  const name = normRel(rel);
  if (!name) return false;
  return matchGlobs(patterns, name) !== null;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function parseConfig(text: string, label: string): Config {
  let raw: ConfigShape;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, "")) as ConfigShape;
  } catch {
    throw new Error(`config is not valid JSON: ${label}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`config must be a JSON object: ${label}`);
  }

  const config = defaultConfig();
  if (raw.rules !== undefined) {
    if (!raw.rules || typeof raw.rules !== "object" || Array.isArray(raw.rules)) {
      throw new Error("config.rules must be an object");
    }
    const known = new Set<string>(RULES);
    for (const [key, value] of Object.entries(raw.rules)) {
      if (!known.has(key)) throw new Error(`unknown rule "${key}"`);
      if (value !== "off" && value !== "warning" && value !== "error") {
        throw new Error(`rule "${key}" severity must be off, warning, or error`);
      }
      config.rules[key as RuleId] = value;
    }
  }

  if (raw.ignore !== undefined) {
    if (!Array.isArray(raw.ignore) || raw.ignore.some((item) => typeof item !== "string")) {
      throw new Error("config.ignore must be an array of strings");
    }
    config.ignore = DEFAULT_IGNORE.concat(raw.ignore);
  }

  if (raw.budgets !== undefined) {
    if (!raw.budgets || typeof raw.budgets !== "object" || Array.isArray(raw.budgets)) {
      throw new Error("config.budgets must be an object");
    }
    if (raw.budgets.maxTokens !== undefined) {
      if (!isPositiveInt(raw.budgets.maxTokens)) {
        throw new Error("budgets.maxTokens must be a positive integer");
      }
      config.budgets.maxTokens = raw.budgets.maxTokens;
    }
    if (raw.budgets.maxBytes !== undefined) {
      if (!isPositiveInt(raw.budgets.maxBytes)) {
        throw new Error("budgets.maxBytes must be a positive integer");
      }
      config.budgets.maxBytes = raw.budgets.maxBytes;
    }
  }

  return config;
}

export function loadConfig(root: string, explicit?: string): Config {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`config not found: ${explicit}`);
    return parseConfig(fs.readFileSync(explicit, "utf8"), explicit);
  }
  const candidate = path.join(root, "agentctx.config.json");
  if (!fs.existsSync(candidate)) return defaultConfig();
  return parseConfig(fs.readFileSync(candidate, "utf8"), candidate);
}
