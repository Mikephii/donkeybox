/** Resolve a dotted path like "payload.pr.number" against a context object. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Interpolate {{a.b}} placeholders. Missing values render as empty strings.
 * Objects render as compact JSON so prompts never show [object Object].
 */
export function render(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, path: string) => {
    const v = getPath(ctx, path);
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  });
}

/** "$.a.b" JSONPath-lite used by declarative source maps. Plain strings are literals. */
export function pick(body: unknown, expr: string): unknown {
  if (!expr.startsWith("$")) return expr;
  const path = expr.replace(/^\$\.?/, "");
  return path === "" ? body : getPath(body, path);
}
