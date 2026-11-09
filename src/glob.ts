export interface CompiledGlob {
  positive: boolean;
  /** Pattern with a leading ! removed, used as the match key. */
  source: string;
  raw: string;
  re: RegExp;
}

/** Split on commas that are not inside `{a,b}` groups. */
export function splitGlobs(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const char of input) {
    if (char === "{") depth++;
    else if (char === "}" && depth > 0) depth--;
    else if (char === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += char;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function escapeChar(char: string): string {
  return "\\^$+?.()|[]{}".includes(char) ? "\\" + char : char;
}

function globBody(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    if (char === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        out += "\\{";
        continue;
      }
      const parts = splitGlobs(glob.slice(i + 1, end));
      out += "(?:" + parts.map((part) => globBody(part)).join("|") + ")";
      i = end;
      continue;
    }
    out += escapeChar(char);
  }
  return out;
}

export function compileGlob(glob: string): CompiledGlob {
  let source = glob.trim();
  const raw = source;
  let positive = true;
  if (source.startsWith("!")) {
    positive = false;
    source = source.slice(1).trim();
  }
  if (source.startsWith("./")) source = source.slice(2);
  if (source.startsWith("/")) source = source.slice(1);
  return {
    positive,
    source,
    raw,
    re: new RegExp("^" + globBody(source) + "$"),
  };
}

/**
 * Gitignore-style list: later patterns win. A leading `!` unsets a previous match.
 * Returns the raw pattern that included the path, or null.
 */
export function matchGlobs(patterns: string[], file: string): string | null {
  let matched: string | null = null;
  for (const pattern of patterns) {
    const compiled = compileGlob(pattern);
    if (!compiled.source) continue;
    if (!compiled.re.test(file)) continue;
    matched = compiled.positive ? compiled.raw : null;
  }
  return matched;
}

/**
 * Try the repo-relative path, then the path relative to `scope`.
 * Nested rule files often write globs against their own tree.
 */
export function matchScoped(patterns: string[], repoPath: string, scope: string): string | null {
  const full = matchGlobs(patterns, repoPath);
  if (full) return full;
  if (!scope) return null;
  if (repoPath !== scope && !repoPath.startsWith(scope + "/")) return null;
  const relative = repoPath.slice(scope.length).replace(/^\//, "");
  if (!relative || relative === repoPath) return null;
  return matchGlobs(patterns, relative);
}
