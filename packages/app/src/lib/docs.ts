/**
 * Documents: markdown files on the box that a Document window shows, rendered and kept up to date.
 * A skill run by hand writes its result to a file and opens it next to the person's terminal
 * (`wb open FILE`), so a proposal reads as a page instead of terminal text.
 * Only .md files under the workspace, the home folder or /tmp, up to 1 MB.
 */
import { realpathSync, statSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

export const DOC_MAX_BYTES = 1024 * 1024;

export class DocError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function docRoots(workspace?: string): string[] {
  const roots = [workspace, process.env.HOME || homedir(), "/tmp", tmpdir()].filter((r): r is string => !!r);
  return [...new Set(roots.map((r) => safeReal(r)).filter((r): r is string => !!r))];
}

function safeReal(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

const inside = (root: string, p: string) => {
  const r = relative(root, p);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

/** The real path of a document someone may open, or a DocError saying why not. */
export function resolveDoc(path: string, roots: string[]): string {
  if (!path || typeof path !== "string") throw new DocError(400, "path is required");
  if (!/\.(md|markdown)$/i.test(path)) throw new DocError(400, "only markdown files (.md) open as documents");
  const real = safeReal(resolve(path));
  if (!real) throw new DocError(404, `no file ${path}`);
  if (!roots.some((r) => inside(r, real))) throw new DocError(403, "documents must be in the workspace, the home folder or /tmp");
  const st = statSync(real);
  if (!st.isFile()) throw new DocError(400, `${path} is not a file`);
  if (st.size > DOC_MAX_BYTES) throw new DocError(413, `${path} is larger than 1 MB`);
  return real;
}

export function readDoc(path: string, roots: string[]) {
  const real = resolveDoc(path, roots);
  const st = statSync(real);
  return { path: real, content: readFileSync(real, "utf8"), mtime: st.mtime.toISOString(), size: st.size };
}
