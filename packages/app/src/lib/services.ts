export interface ServiceStatus {
  id: string;
  title: string;
  kind: "core" | "workspace" | "external";
  state: "running" | "starting" | "stopped" | "crashed" | "up" | "down" | "off" | "not installed" | "unknown";
  pid?: number;
  since?: string;
  restarts?: number;
  canRestart: boolean;
  detail?: string;
}

/** The supervisor owns every process on the box; the app asks it. Same interface locally and in the container. */
export interface ServiceBackend {
  list(): Promise<ServiceStatus[]>;
  restart(id: string): Promise<void>;
  logs(id: string, lines: number): Promise<string>;
}

export class SupervisorBackend implements ServiceBackend {
  base: string;
  constructor(port: number) {
    this.base = `http://127.0.0.1:${port}`;
  }
  async list() {
    try {
      const r = await fetch(`${this.base}/services`, { signal: AbortSignal.timeout(3000) });
      return (await r.json()) as ServiceStatus[];
    } catch {
      return [];
    }
  }
  async restart(id: string) {
    const r = await fetch(`${this.base}/services/${encodeURIComponent(id)}/restart`, { method: "POST" });
    if (!r.ok) throw new Error(await r.text());
  }
  async logs(id: string, lines: number) {
    const r = await fetch(`${this.base}/services/${encodeURIComponent(id)}/logs?lines=${lines}`).catch(() => null);
    if (!r || !r.ok) return `${id}: no logs collected for this service.`;
    return r.text();
  }
}
