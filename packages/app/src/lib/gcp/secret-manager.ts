import type { SecretBackend, SecretMeta } from "../secrets.ts";

/**
 * Google Secret Manager over REST (no SDK). The access token comes from the VM's metadata server,
 * or WB_GCP_ACCESS_TOKEN when set. Secrets are named <prefix><NAME> and labelled managed-by=workbench.
 */
export class GcpSecretBackend implements SecretBackend {
  readonly kind = "gcp" as const;
  readonly o: { project: string; prefix?: string; endpoint?: string; metadataUrl?: string; token?: () => Promise<string>; fetch?: typeof fetch };
  constructor(o: GcpSecretBackend["o"]) {
    this.o = o;
  }
  private get f() {
    return this.o.fetch ?? fetch;
  }
  private get base() {
    return `${this.o.endpoint ?? "https://secretmanager.googleapis.com"}/v1/projects/${this.o.project}`;
  }
  private get prefix() {
    return this.o.prefix ?? "workbench-";
  }
  private cached: { token: string; until: number } | null = null;
  private async token() {
    if (this.o.token) return this.o.token();
    if (process.env.WB_GCP_ACCESS_TOKEN) return process.env.WB_GCP_ACCESS_TOKEN;
    if (this.cached && this.cached.until > Date.now()) return this.cached.token;
    const r = await this.f(this.o.metadataUrl ?? "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
    if (!r.ok) throw new Error(`metadata token: HTTP ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.cached = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
    return j.access_token;
  }
  private async call(method: string, path: string, body?: unknown) {
    const r = await this.f(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.token()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`secret manager ${method} ${path.replace(/:access$/, "")}: HTTP ${r.status}`);
    return r.status === 204 ? {} : r.json();
  }
  async load() {
    const out = new Map<string, SecretMeta & { value: string }>();
    let page = "";
    do {
      const j = (await this.call("GET", `/secrets?filter=${encodeURIComponent("labels.managed-by=workbench")}&pageSize=250${page ? `&pageToken=${page}` : ""}`)) as {
        secrets?: { name: string; createTime: string; labels?: Record<string, string> }[];
        nextPageToken?: string;
      };
      for (const s of j.secrets ?? []) {
        const id = s.name.split("/").pop()!;
        if (!id.startsWith(this.prefix)) continue;
        const name = id.slice(this.prefix.length);
        try {
          const v = (await this.call("GET", `/secrets/${id}/versions/latest:access`)) as { payload: { data: string } };
          const updated = s.labels?.["updated-at"] ? new Date(Number(s.labels["updated-at"]) * 1000).toISOString() : s.createTime;
          out.set(name, { name, value: Buffer.from(v.payload.data, "base64").toString("utf8"), createdAt: s.createTime, updatedAt: updated });
        } catch {
          // A secret with no enabled version is listed nowhere; the page shows it as missing.
        }
      }
      page = j.nextPageToken ?? "";
    } while (page);
    return out;
  }
  async put(name: string, value: string, existing: boolean) {
    const id = `${this.prefix}${name}`;
    const stamp = String(Math.floor(Date.now() / 1000));
    if (!existing) await this.call("POST", `/secrets?secretId=${id}`, { replication: { automatic: {} }, labels: { "managed-by": "workbench", "updated-at": stamp } });
    else await this.call("PATCH", `/secrets/${id}?updateMask=labels`, { labels: { "managed-by": "workbench", "updated-at": stamp } });
    await this.call("POST", `/secrets/${id}:addVersion`, { payload: { data: Buffer.from(value, "utf8").toString("base64") } });
  }
  async remove(name: string) {
    await this.call("DELETE", `/secrets/${this.prefix}${name}`);
  }
}

