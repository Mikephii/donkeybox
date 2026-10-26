/**
 * Guard patterns follow Claude Code permission-rule syntax:
 *   "mcp__jira__delete_issue"      any call of that tool
 *   "Bash(jira * delete*)"         Bash whose command matches the glob
 *   "Bash(jira:*)"                 Claude's prefix form, same as "jira*"
 *   "Write(/etc/**)"               file tools match on file_path
 * Tool names may themselves use * (e.g. "mcp__jira__*").
 */
export function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") i++;
      re += ".*";
    } else if (c === "?") re += ".";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "s");
}

export function toolSubject(tool: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  if (tool === "Bash" && typeof i.command === "string") return i.command;
  for (const k of ["file_path", "path", "url", "pattern"]) if (typeof i[k] === "string") return i[k] as string;
  return JSON.stringify(i);
}

export function matchesGuard(pattern: string, tool: string, input?: Record<string, unknown>): boolean {
  const m = pattern.match(/^([^()]+)(?:\((.*)\))?$/s);
  if (!m) return false;
  const [, toolPat, argPat] = m;
  if (!globToRegex(toolPat!.trim()).test(tool)) return false;
  if (argPat === undefined) return true;
  const arg = argPat.endsWith(":*") ? `${argPat.slice(0, -2)}*` : argPat;
  return globToRegex(arg).test(toolSubject(tool, input));
}

export function firstGuardMatch(patterns: string[], tool: string, input?: Record<string, unknown>): string | null {
  return patterns.find((p) => matchesGuard(p, tool, input)) ?? null;
}
