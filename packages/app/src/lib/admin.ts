import { groupSchema, ruleSchema, serviceSchema, sourceSchema, type ConfigStore, type Rule } from "../engine/config.ts";
import { SkillError, SkillStore, starterSkill } from "./skills.ts";
import { nextRun, rulesForGroup, sourceEmits, sourcesForRules, workflowSummary, WORKFLOW_ID } from "./workflows.ts";

export class AdminError extends Error {
  status: number;
  details: string[];
  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const unwrap = (r: { ok: true } | { ok: false; errors: string[] }) => {
  if (!r.ok) throw new AdminError(422, "config is invalid", r.errors);
};

/** Checks one item against its schema first, so errors point at the field the person edited. */
function check<T>(schema: { safeParse: (v: unknown) => any }, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  // Messages are "<what>.<field path>: problem" so a form can place each one next to its field.
  if (!r.success) throw new AdminError(422, `${what} is invalid`, r.error.issues.map((i: any) => `${[what, ...i.path].join(".")}: ${i.message}`));
  return value as T;
}

export interface CreateWorkflow {
  id: string;
  group: Record<string, unknown>;
  /** true: write a starter skill named after the workflow (unless one exists). A string: write that content. */
  skill?: boolean | string;
  rule?: { on: string; prompt: string; mode?: "interactive" | "print"; filter?: Record<string, unknown> } | null;
}

/**
 * Workflow, rule, source and skill changes, shared by the browser API and the admin tools.
 * The workspace's config.json stays the source of truth and every write validates the whole file.
 */
export interface Author {
  name: string;
  email: string;
}

export class Admin {
  config: ConfigStore;
  skills: SkillStore;
  openCounts: () => Record<string, number>;
  /** Who the current (synchronous) change is for; becomes the commit author. */
  private author: Author | undefined;
  constructor(config: ConfigStore, skills: SkillStore, openCounts: () => Record<string, number>) {
    this.config = config;
    this.skills = skills;
    this.openCounts = openCounts;
  }

  /** Runs one change on behalf of a person, so the workspace commit names them. */
  as<T>(author: Author | undefined, fn: (admin: Admin) => T): T {
    const prev = this.author;
    this.author = author;
    try {
      return fn(this);
    } finally {
      this.author = prev;
    }
  }

  private save(fn: (raw: Record<string, any>) => Record<string, any>, message: string, paths?: string[], exact = false) {
    unwrap(this.config.update(fn, { message, author: this.author, paths, exact }));
  }

  listWorkflows() {
    const c = this.config.get();
    const open = this.openCounts();
    return Object.entries(c.groups).map(([id, g]) => ({ ...workflowSummary(c, id, g, open[id] ?? 0), skillExists: g.skill ? this.skills.exists(g.skill) : false }));
  }

  getWorkflow(id: string) {
    const c = this.config.get();
    const group = c.groups[id];
    if (!group) throw new AdminError(404, `no workflow ${id}`);
    const raw = (this.config.raw().groups as Record<string, unknown>)[id];
    const rules = rulesForGroup(c, id);
    const skillName = group.skill ?? null;
    let skill: { name: string; exists: boolean; content: string | null } | null = null;
    if (skillName) {
      const exists = this.skills.exists(skillName);
      skill = { name: skillName, exists, content: exists ? this.skills.read(skillName) : null };
    }
    return {
      id,
      group: raw,
      rules,
      sources: sourcesForRules(c, rules).map((s) => ({ ...s, emits: sourceEmits(s.source), nextRun: nextRun(s.source) })),
      skill,
      open: this.openCounts()[id] ?? 0,
    };
  }

  createWorkflow(input: CreateWorkflow) {
    const { id } = input;
    if (!WORKFLOW_ID.test(id ?? "")) throw new AdminError(422, "invalid id", ["id: 2-41 characters, lowercase letters, digits and dashes, starting with a letter or digit"]);
    if (this.config.get().groups[id]) throw new AdminError(409, `workflow ${id} already exists`);
    const group = { ...input.group } as Record<string, unknown>;
    if (input.skill && !group.skill) group.skill = id;
    check(groupSchema, group, "group");
    const ruleId = input.rule ? this.freeRuleId(id) : null;
    const rule = input.rule ? { id: ruleId!, group: id, title: undefined, ...input.rule } : null;
    if (rule) check(ruleSchema, rule, "rule");

    // Skill first, so a config failure can roll it back. Never overwrite an existing skill.
    let wroteSkill: string | null = null;
    if (input.skill) {
      const name = String(group.skill);
      if (!this.skills.exists(name)) {
        const content = typeof input.skill === "string" ? input.skill : starterSkill(name, String(group.title ?? id), group.description as string | undefined);
        try {
          this.skills.write(name, content, { quiet: true });
        } catch (e) {
          if (e instanceof SkillError) throw new AdminError(422, e.message, [`skill: ${e.message}`]);
          throw e;
        }
        wroteSkill = name;
      }
    }
    try {
      this.save((raw) => {
        raw.groups = { ...(raw.groups ?? {}), [id]: group };
        if (rule) raw.rules = [...(raw.rules ?? []), JSON.parse(JSON.stringify(rule))];
        return raw;
      }, `Create workflow ${id}`, wroteSkill ? [this.skillPath(wroteSkill)] : []);
    } catch (e) {
      if (wroteSkill) this.skills.removeQuietly(wroteSkill);
      throw e;
    }
    return this.getWorkflow(id);
  }

  /** Replace a workflow's settings. With create=true (admin tools) a missing workflow is created. */
  putWorkflow(id: string, group: Record<string, unknown>, create = false) {
    if (!this.config.get().groups[id]) {
      if (!create) throw new AdminError(404, `no workflow ${id}`);
      return this.createWorkflow({ id, group });
    }
    check(groupSchema, group, "group");
    this.save((raw) => ({ ...raw, groups: { ...raw.groups, [id]: group } }), `Update workflow ${id}`);
    return this.getWorkflow(id);
  }

  /** Replace the rules that start this workflow; other workflows' rules are untouched. */
  setWorkflowRules(id: string, rules: Rule[]) {
    if (!this.config.get().groups[id]) throw new AdminError(404, `no workflow ${id}`);
    if (!Array.isArray(rules)) throw new AdminError(422, "rules must be a list");
    const mine = rules.map((r, i) => check<Rule>(ruleSchema, { ...r, group: id }, `rules.${i}`));
    const ids = mine.map((r) => r.id);
    const clash = this.config.get().rules.filter((r) => r.group !== id && ids.includes(r.id)).map((r) => r.id);
    if (clash.length) throw new AdminError(422, "rule ids must be unique", clash.map((c) => `rules: id "${c}" is already used by another workflow`));
    this.save((raw) => ({ ...raw, rules: [...(raw.rules ?? []).filter((r: Rule) => r.group !== id), ...mine] }), `Update rules for ${id}`);
    return this.getWorkflow(id);
  }

  deleteWorkflow(id: string, opts: { deleteSkill?: boolean } = {}) {
    const c = this.config.get();
    const group = c.groups[id];
    if (!group) throw new AdminError(404, `no workflow ${id}`);
    const refs = rulesForGroup(c, id);
    if (refs.length) throw new AdminError(409, `${refs.length} rule(s) still start this workflow: ${refs.map((r) => r.id).join(", ")}. Remove them first.`, refs.map((r) => r.id));
    const skill = group.skill;
    const sharedSkill = skill && Object.entries(c.groups).some(([gid, g]) => gid !== id && g.skill === skill);
    const deleteSkill = !!(opts.deleteSkill && skill && !sharedSkill && this.skills.exists(skill));
    if (deleteSkill) this.skills.removeQuietly(skill!);
    this.save((raw) => {
      const groups = { ...raw.groups };
      delete groups[id];
      return { ...raw, groups };
    }, `Delete workflow ${id}`, deleteSkill ? [this.skillPath(skill!)] : []);
    return { deleted: id, skillDeleted: deleteSkill };
  }

  // ── rules ──
  listRules() {
    return this.config.get().rules;
  }
  upsertRule(rule: Rule) {
    check(ruleSchema, rule, "rule");
    this.save((raw) => {
      const rules = [...(raw.rules ?? [])];
      const i = rules.findIndex((r: Rule) => r.id === rule.id);
      if (i >= 0) rules[i] = rule;
      else rules.push(rule);
      return { ...raw, rules };
    }, `Update rule ${rule.id}`);
    return this.config.get().rules.find((r) => r.id === rule.id);
  }
  deleteRule(id: string) {
    if (!this.config.get().rules.some((r) => r.id === id)) throw new AdminError(404, `no rule ${id}`);
    this.save((raw) => ({ ...raw, rules: raw.rules.filter((r: Rule) => r.id !== id) }), `Delete rule ${id}`);
    return { deleted: id };
  }
  private freeRuleId(base: string) {
    const ids = new Set(this.config.get().rules.map((r) => r.id));
    let id = base;
    for (let i = 2; ids.has(id); i++) id = `${base}-${i}`;
    return id;
  }

  // ── sources and services ──
  upsertSource(id: string, source: Record<string, unknown>) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id ?? "")) throw new AdminError(422, "invalid source id", ["id: lowercase letters, digits and dashes"]);
    check(sourceSchema, source, "source");
    this.save((raw) => ({ ...raw, sources: { ...raw.sources, [id]: source } }), `Update source ${id}`);
    return (this.config.raw().sources as Record<string, unknown>)[id];
  }
  deleteSource(id: string) {
    if (!this.config.get().sources[id]) throw new AdminError(404, `no source ${id}`);
    this.save((raw) => {
      const sources = { ...raw.sources };
      delete sources[id];
      return { ...raw, sources };
    }, `Delete source ${id}`);
    return { deleted: id };
  }
  /** Adds (or replaces) MCP servers on a workflow in one commit. */
  addMcpServers(id: string, servers: Record<string, unknown>) {
    if (!this.config.get().groups[id]) throw new AdminError(404, `no workflow ${id}`);
    const names = Object.keys(servers);
    this.save((raw) => {
      const g = { ...(raw.groups[id] as Record<string, any>) };
      g.mcpServers = { ...(g.mcpServers ?? {}), ...servers };
      return { ...raw, groups: { ...raw.groups, [id]: g } };
    }, `Import MCP server${names.length > 1 ? "s" : ""} ${names.join(", ")} into workflow ${id}`);
    return (this.config.raw().groups as Record<string, any>)[id].mcpServers;
  }

  setServices(services: unknown[]) {
    if (!Array.isArray(services)) throw new AdminError(422, "services must be a list");
    services.forEach((s, i) => check(serviceSchema, s, `service ${(s as any)?.id ?? i + 1}`));
    this.save((raw) => ({ ...raw, services }), "Update services");
    return this.config.get().services;
  }

  /** Generic section write with the person as author. `exact` when the value is the raw section as the person edited it. */
  setSection(section: string, value: unknown, message?: string, exact = false) {
    this.save((raw) => ({ ...raw, [section]: value }), message ?? `Update ${section}`, undefined, exact);
  }

  private skillPath(name: string) {
    return `${this.skills.dir}/${name}`;
  }

  // ── skills ──
  write(name: string, content: string) {
    try {
      this.skills.writeAs(name, content, this.author);
    } catch (e) {
      if (e instanceof SkillError) throw new AdminError(e.status === 404 ? 404 : 422, e.message, [e.message]);
      throw e;
    }
  }
  readSkill(name: string) {
    try {
      return { name, content: this.skills.read(name) };
    } catch (e) {
      if (e instanceof SkillError) throw new AdminError(e.status, e.message);
      throw e;
    }
  }
  deleteSkill(name: string) {
    const users = Object.entries(this.config.get().groups).filter(([, g]) => g.skill === name).map(([id]) => id);
    if (users.length) throw new AdminError(409, `skill ${name} is used by ${users.join(", ")}`);
    try {
      this.skills.deleteAs(name, this.author);
    } catch (e) {
      if (e instanceof SkillError) throw new AdminError(e.status, e.message);
      throw e;
    }
    return { deleted: name };
  }
}
