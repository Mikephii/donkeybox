import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { settingsSchema } from "../src/engine/config.ts";
import { caddyfile } from "../src/lib/caddyfile.ts";

const ports = { appDoor: 8080, hooksDoor: 0, app: 8000, hooks: 9000, yjs: 1234, zellijWeb: 8082, codeServer: 8443, vite: null, blocked: [8001, 8002, 8009] };
const CADDY = resolve(import.meta.dirname, "../../../.tools/bin/caddy");
/** Runs Caddy's own parser over the generated file, so a typo fails the test, not the box. */
function adapt(text: string) {
  if (!existsSync(CADDY)) return;
  const f = join(mkdtempSync(join(tmpdir(), "wb-caddy-")), "Caddyfile");
  writeFileSync(f, text);
  execFileSync(CADDY, ["adapt", "--config", f, "--adapter", "caddyfile"], { stdio: "pipe" });
}

describe("door configuration", () => {
  it("public door: every backend route asks /auth/check, identity headers from clients are dropped, internals are not previewable", () => {
    const c = caddyfile(settingsSchema.parse({}), "proxy", ports, { codeServer: true });
    adapt(c);
    for (const route of ["handle_path /term/*", "handle /yjs*", "handle @preview", "handle_path /devtools/*", "handle_path /code/*"]) {
      const block = c.slice(c.indexOf(route), c.indexOf("}", c.indexOf("uri /auth/check", c.indexOf(route))));
      expect(block).toContain("forward_auth");
    }
    expect(c).toContain("request_header -X-Wb-Email");
    expect(c).toContain("request_header -X-Wb-Role");
    expect(c).toMatch(/@blocked path_regexp \^\/p\/\(8001\|8002\|8009\|8000\|9000\|1234\|8082\|8443\)/);
    expect(c).not.toContain("@outside");
  });

  it("with the editor not running, /code answers 503 rather than falling through to the app", () => {
    const c = caddyfile(settingsSchema.parse({}), "proxy", ports, { codeServer: false });
    adapt(c);
    expect(c).toContain('handle /code* {\n\t\trespond "The editor is not running." 503');
    expect(c).not.toContain("reverse_proxy 127.0.0.1:8443");
  });

  it("private door refuses addresses outside the private networks but keeps /hooks open; both adds the proxy's addresses", () => {
    const priv = caddyfile(settingsSchema.parse({ doors: { appAccess: "private", privateCidrs: ["fdaa::/16"] } }), "proxy", ports, { codeServer: false });
    adapt(priv);
    expect(priv).toMatch(/@outside \{\n\t\tnot remote_ip fdaa::\/16\n\t\tnot path \/hooks\/\*/);
    const both = caddyfile(settingsSchema.parse({ doors: { appAccess: "both", privateCidrs: ["10.0.0.0/8"] }, auth: { proxy: { trustedCidrs: ["172.18.0.0/16"] } } }), "proxy", ports, { codeServer: false });
    adapt(both);
    expect(both).toContain("not remote_ip 10.0.0.0/8 172.18.0.0/16");
  });

  it("serves app and hooks host names separately when a hooks door port is set", () => {
    const c = caddyfile(settingsSchema.parse({ doors: { appHosts: ["box.example.com"], hooksHosts: ["hooks.example.com"] } }), "oidc", { ...ports, hooksDoor: 8081 }, { codeServer: false });
    adapt(c);
    expect(c).toContain("http://box.example.com:8080 {");
    expect(c).toContain("http://hooks.example.com:8081 {");
    const hooks = c.slice(c.indexOf("http://hooks.example.com"));
    expect(hooks).toContain("method POST");
    expect(hooks).toContain("max_size 2MB");
    expect(hooks).toContain("respond 404");
    expect(c.slice(0, c.indexOf("http://hooks.example.com"))).not.toContain("handle /hooks/*");
  });
});

describe("door address", () => {
  it("binds both doors to the given address, or every interface when none is given", () => {
    const local = caddyfile(settingsSchema.parse({}), "proxy", { ...ports, hooksDoor: 8081, bind: "127.0.0.1 ::1" }, { codeServer: false });
    adapt(local);
    expect(local.match(/\tbind 127\.0\.0\.1 ::1\n/g)).toHaveLength(2);
    expect(caddyfile(settingsSchema.parse({}), "proxy", ports, { codeServer: false })).not.toContain("bind ");
  });
});
