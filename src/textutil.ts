/** Blank fenced code without shifting line numbers. */
export function maskFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, " "));
}

export function lineOf(text: string, snippet: string): number {
  const index = text.indexOf(snippet);
  if (index < 0) return 1;
  return text.slice(0, index).split("\n").length;
}

/** Inline code and shell fences. Prose outside those is ignored. */
export function commandStrings(text: string): string[] {
  const out: string[] = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  const without = text.replace(fence, (_full, lang: string, body: string) => {
    const language = String(lang).trim().toLowerCase();
    if (language === "" || /^(sh|bash|shell|console|zsh|fish)$/.test(language)) {
      for (const line of String(body).split("\n")) {
        const trimmed = line.replace(/^\s*\$\s*/, "").trim();
        if (trimmed && !trimmed.startsWith("#")) out.push(trimmed);
      }
    }
    return "\n";
  });
  for (const match of without.matchAll(/`([^`\n]+)`/g)) {
    const value = match[1].trim();
    if (value) out.push(value);
  }
  return out;
}

export function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "to",
  "for",
  "of",
  "and",
  "or",
  "in",
  "on",
  "with",
  "your",
  "you",
  "our",
  "we",
  "that",
  "this",
  "from",
  "when",
  "every",
  "all",
  "any",
  "into",
  "its",
  "it",
  "be",
  "is",
  "are",
  "as",
  "by",
  "at",
]);

export function contentTokens(phrase: string): Set<string> {
  const tokens = normalizePhrase(phrase)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP.has(token));
  return new Set(tokens);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Same topic when the phrases match, or one contains the other, or token overlap is high. */
export function sameTopic(a: string, b: string): boolean {
  const left = normalizePhrase(a);
  const right = normalizePhrase(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length >= 12) {
    const re = new RegExp(`(?:^| )${escapeRegExp(shorter)}(?: |$)`);
    if (re.test(longer)) return true;
  }
  const ta = contentTokens(left);
  const tb = contentTokens(right);
  if (ta.size < 2 || tb.size < 2) return false;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  const union = ta.size + tb.size - shared;
  return shared >= 2 && union > 0 && shared / union >= 0.8;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
