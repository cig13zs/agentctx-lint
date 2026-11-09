import { VERSION } from "./version";
import type { ExplainResult, Issue } from "./types";

function counts(issues: Issue[]): { errors: number; warnings: number } {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  return { errors, warnings: issues.length - errors };
}

function summary(issues: Issue[]): string {
  if (!issues.length) return "agentctx-lint: no issues";
  const { errors, warnings } = counts(issues);
  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export function formatText(issues: Issue[]): string {
  if (!issues.length) return "agentctx-lint: no issues\n";
  const lines = issues.map((issue) => {
    const file = issue.files[0] ?? "";
    const loc = issue.line ? `${file}:${issue.line}` : file;
    const where = issue.path ? `  (${issue.path})` : "";
    return `${loc}  ${issue.severity}  ${issue.rule}  ${issue.message}${where}`;
  });
  lines.push("");
  lines.push(summary(issues));
  return lines.join("\n") + "\n";
}

export function formatJson(issues: Issue[]): string {
  const { errors, warnings } = counts(issues);
  return (
    JSON.stringify(
      {
        version: VERSION,
        issues,
        summary: { errors, warnings },
      },
      null,
      2,
    ) + "\n"
  );
}

function ghEscape(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export function formatGithub(issues: Issue[]): string {
  const lines = issues.map((issue) => {
    const level = issue.severity === "error" ? "error" : "warning";
    const file = issue.files[0] ?? "";
    const line = issue.line && issue.line > 0 ? issue.line : 1;
    return `::${level} file=${file},line=${line},title=${issue.rule}::${ghEscape(issue.message)}`;
  });
  lines.push(summary(issues));
  return lines.join("\n") + "\n";
}

export function formatIssues(issues: Issue[], format: "text" | "json" | "github"): string {
  if (format === "json") return formatJson(issues);
  if (format === "github") return formatGithub(issues);
  return formatText(issues);
}

export function formatExplain(result: ExplainResult, format: "text" | "json"): string {
  if (format === "json") return JSON.stringify(result, null, 2) + "\n";
  const lines: string[] = [result.path, `tokens: ${result.tokens}`, `bytes: ${result.bytes}`, "", "applies:"];
  if (!result.chain.length) lines.push("  (none)");
  else {
    result.chain.forEach((entry, index) => {
      lines.push(`  ${index + 1}. ${entry.path}  ${entry.kind}  ${entry.reason}`);
    });
  }
  if (result.overridden.length) {
    lines.push("");
    lines.push("overridden:");
    for (const entry of result.overridden) {
      lines.push(`  - ${entry.path}  ${entry.kind}  ${entry.reason}`);
    }
  }
  return lines.join("\n") + "\n";
}
