import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/** Skill names double as slash commands and folder names, so they are kept boring. */
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface SkillInfo {
  name: string;
  description: string;
  size: number;
  updated: string;
}

export class SkillError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Parses the YAML-ish frontmatter Claude Code skills use: name and description on single lines. */
export function frontmatter(content: string): Record<string, string> | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

export function starterSkill(name: string, title: string, description?: string): string {
  return `---
name: ${name}
description: ${description?.trim() || `${title}. Use for work in the ${name} group.`}
---

# ${title}

Explain what this workflow does and the arguments that follow the slash command, for example:

- \`/${name} <task>\`: do the task, then end your turn with a short summary.
- When you need a decision, call the workbench \`create_request\` tool with a clear title and a
  markdown body, and end your turn. The group's buttons decide what happens next.
- Each button sends a prompt back to you (see the workflow's actions). Handle each one here.
`;
}

/**
 * Reads and writes <skillsDir>/<name>/SKILL.md and nothing else. Every path is resolved and
 * checked to stay inside the skills folder, symlinks inside it are refused, and writes are atomic.
 */
export class SkillStore {
  private dirFn: () => string;
  /** Called after every write or delete with the folder that changed (the workspace commits it). */
  onWrite: ((info: { message: string; path: string; author?: { name: string; email: string } }) => void) | null = null;
  constructor(dir: string | (() => string)) {
    this.dirFn = typeof dir === "string" ? () => dir : dir;
  }

  get dir(): string {
    return resolve(this.dirFn());
  }

  private root(): string {
    mkdirSync(this.dir, { recursive: true });
    return realpathSync(this.dir);
  }

  private pathFor(name: string): { folder: string; file: string } {
    if (typeof name !== "string" || !SKILL_NAME.test(name)) throw new SkillError(`invalid skill name "${name}": use lowercase letters, digits and dashes`);
    const root = this.root();
    const folder = resolve(root, name);
    if (!folder.startsWith(root + sep)) throw new SkillError("skill path escapes the skills folder");
    if (existsSync(folder) && lstatSync(folder).isSymbolicLink()) throw new SkillError("skill folder is a symlink; refusing");
    const file = join(folder, "SKILL.md");
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new SkillError("SKILL.md is a symlink; refusing");
    return { folder, file };
  }

  exists(name: string): boolean {
    try {
      return existsSync(this.pathFor(name).file);
    } catch {
      return false;
    }
  }

  list(): SkillInfo[] {
    const root = this.root();
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && SKILL_NAME.test(d.name) && existsSync(join(root, d.name, "SKILL.md")))
      .map((d) => {
        const file = join(root, d.name, "SKILL.md");
        const content = readFileSync(file, "utf8");
        const st = statSync(file);
        return { name: d.name, description: frontmatter(content)?.description ?? "", size: st.size, updated: st.mtime.toISOString() };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  read(name: string): string {
    const { file } = this.pathFor(name);
    if (!existsSync(file)) throw new SkillError(`no skill ${name}`, 404);
    return readFileSync(file, "utf8");
  }

  /** Validates frontmatter (name must match the folder, description required) before writing. */
  writeAs(name: string, content: string, author?: { name: string; email: string }) {
    this.write(name, content, { author });
  }
  deleteAs(name: string, author?: { name: string; email: string }) {
    this.delete(name, { author });
  }
  /** Removes a skill without its own commit (it is part of a larger change that commits it). */
  removeQuietly(name: string) {
    this.delete(name, { quiet: true });
  }

  write(name: string, content: string, opts: { quiet?: boolean; author?: { name: string; email: string } } = {}): void {
    const { folder, file } = this.pathFor(name);
    if (typeof content !== "string" || !content.trim()) throw new SkillError("skill content is empty");
    if (content.length > 200_000) throw new SkillError("skill is larger than 200 KB");
    const fm = frontmatter(content);
    if (!fm) throw new SkillError("skill must start with frontmatter: ---, name: ..., description: ..., ---");
    if (fm.name !== name) throw new SkillError(`frontmatter name "${fm.name ?? ""}" must match the skill name "${name}"`);
    if (!fm.description) throw new SkillError("frontmatter needs a description; Claude uses it to decide when the skill applies");
    const existed = existsSync(file);
    mkdirSync(folder, { recursive: true });
    const tmp = join(folder, `.SKILL.md.${process.pid}.tmp`);
    writeFileSync(tmp, content.endsWith("\n") ? content : content + "\n");
    renameSync(tmp, file);
    if (!opts.quiet) this.onWrite?.({ message: `${existed ? "Update" : "Create"} skill ${name}`, path: folder, author: opts.author });
  }

  delete(name: string, opts: { quiet?: boolean; author?: { name: string; email: string } } = {}): void {
    const { folder, file } = this.pathFor(name);
    if (!existsSync(file)) throw new SkillError(`no skill ${name}`, 404);
    rmSync(folder, { recursive: true });
    if (!opts.quiet) this.onWrite?.({ message: `Delete skill ${name}`, path: folder, author: opts.author });
  }
}
