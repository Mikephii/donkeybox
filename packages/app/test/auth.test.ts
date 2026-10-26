import Database from "better-sqlite3";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { settingsSchema, type Settings } from "../src/engine/config.ts";
import { openDb } from "../src/engine/db.ts";
import { createAuth, inCidrs, sign, type AuthOptions } from "../src/lib/auth.ts";
import { SupportAccess } from "../src/lib/support.ts";

const KEY = randomBytes(32);
const base = (o: Omit<Partial<AuthOptions>, "settings" | "secret"> & { settings?: unknown; secrets?: Record<string, string> }): AuthOptions => ({
  mode: "dev", devEmail: "dev@localhost", audience: "", production: false, sessionKey: KEY, log: () => {},
  ...o,
  settings: () => settingsSchema.parse(o.settings ?? {}) as Settings,
  secret: (n) => o.secrets?.[n],
});

describe("dev mode", () => {
  it("is refused in production", () => {
    expect(() => createAuth(base({ mode: "dev", production: true }))).toThrow(/refused/);
  });
  it("honours the per-tab override from the header and the cookie", async () => {
    const id = createAuth(base({ mode: "dev" }));
    expect(await id({})).toMatchObject({ email: "dev@localhost", role: "admin", via: "dev" });
    expect((await id({ "x-wb-as": "alice" }))!.email).toBe("alice@localhost");
    expect((await id({ cookie: "x=1; wb-dev-as=bob%40example.com" }))!.email).toBe("bob@example.com");
  });
  it("refuses unknown modes", () => {
    expect(() => createAuth(base({ mode: "saml" as any }))).toThrow(/AUTH_MODE/);
  });
});

describe("iap mode", () => {
  it("accepts only a valid IAP assertion for the configured audience and issuer", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" };
    const id = createAuth(base({ mode: "iap", audience: "/projects/1/global/backendServices/2", production: true, jwks: createLocalJWKSet({ keys: [jwk] }), settings: { access: { users: [{ email: "alice@example.com", role: "admin" }] } } }));
    const tok = (aud: string, iss = "https://cloud.google.com/iap", key = privateKey) =>
      new SignJWT({ email: "alice@example.com" }).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime("5m").sign(key);
    expect(await id({ "x-goog-iap-jwt-assertion": await tok("/projects/1/global/backendServices/2") })).toEqual({ email: "alice@example.com", name: "Alice", role: "admin", via: "iap" });
    expect(await id({ "x-goog-iap-jwt-assertion": await tok("/projects/9/other") })).toBeNull();
    expect(await id({ "x-goog-iap-jwt-assertion": await tok("/projects/1/global/backendServices/2", "https://evil") })).toBeNull();
    const other = await generateKeyPair("ES256");
    expect(await id({ "x-goog-iap-jwt-assertion": await tok("/projects/1/global/backendServices/2", undefined, other.privateKey) })).toBeNull();
    expect(await id({})).toBeNull();
    expect(await id({ "x-wb-as": "mallory", "x-forwarded-email": "alice@example.com" })).toBeNull();
  });
});

describe("proxy mode", () => {
  const settings = { auth: { proxy: { emailHeader: "X-Forwarded-Email", secret: "PROXY_SECRET" } } };
  const secrets = { PROXY_SECRET: "s3cret-from-the-store" };

  it("trusts the email header only with the proxy's shared secret", async () => {
    const id = createAuth(base({ mode: "proxy", settings, secrets }));
    expect(await id({ "x-forwarded-email": "ann@acme.dev", "x-workbench-proxy-secret": "s3cret-from-the-store" }, "127.0.0.1")).toMatchObject({ email: "ann@acme.dev", via: "proxy" });
    expect(await id({ "x-forwarded-email": "ann@acme.dev" }, "127.0.0.1")).toBeNull();
    expect(await id({ "x-forwarded-email": "ann@acme.dev", "x-workbench-proxy-secret": "s3cret-from-the-stor" }, "127.0.0.1")).toBeNull();
    expect(await id({ "x-forwarded-email": "ann@acme.dev", "x-workbench-proxy-secret": "" }, "127.0.0.1")).toBeNull();
    expect(await id({ "x-workbench-proxy-secret": "s3cret-from-the-store" }, "127.0.0.1")).toBeNull();
    expect(await id({ "x-forwarded-email": "not-an-email", "x-workbench-proxy-secret": "s3cret-from-the-store" }, "127.0.0.1")).toBeNull();
    expect(await id({ "x-forwarded-email": "a@x.dev, b@x.dev", "x-workbench-proxy-secret": "s3cret-from-the-store" }, "127.0.0.1")).toBeNull();
  });

  it("refuses everyone when no secret value exists and no network is trusted", async () => {
    const id = createAuth(base({ mode: "proxy", settings, secrets: {} }));
    expect(await id({ "x-forwarded-email": "ann@acme.dev", "x-workbench-proxy-secret": "" }, "127.0.0.1")).toBeNull();
    expect(await id({ "x-forwarded-email": "ann@acme.dev", "x-workbench-proxy-secret": "undefined" }, "127.0.0.1")).toBeNull();
  });

  it("trusts a network range using the door's peer header, which a client cannot forge from outside", async () => {
    const id = createAuth(base({ mode: "proxy", settings: { auth: { proxy: { secret: "", trustedCidrs: ["172.18.0.0/16", "fdaa::/16"] } } } }));
    // Through the door (TCP peer is loopback): the door's X-Wb-Peer header is the client address.
    expect(await id({ "x-forwarded-email": "ann@acme.dev", "x-wb-peer": "172.18.0.5" }, "127.0.0.1")).toMatchObject({ email: "ann@acme.dev" });
    expect(await id({ "x-forwarded-email": "ann@acme.dev", "x-wb-peer": "fdaa:0:1::3" }, "::1")).toMatchObject({ email: "ann@acme.dev" });
    expect(await id({ "x-forwarded-email": "ann@acme.dev", "x-wb-peer": "8.8.8.8" }, "127.0.0.1")).toBeNull();
    // Straight to the app from elsewhere: a forged X-Wb-Peer is ignored, the real peer counts.
    expect(await id({ "x-forwarded-email": "ann@acme.dev", "x-wb-peer": "172.18.0.5" }, "203.0.113.9")).toBeNull();
    expect(await id({ "x-forwarded-email": "ann@acme.dev" }, "172.18.0.9")).toMatchObject({ email: "ann@acme.dev" });
  });

  it("uses a configurable email header (Cloudflare Access, Tailscale, Pomerium) and strips IAP's prefix", async () => {
    const cf = createAuth(base({ mode: "proxy", secrets, settings: { auth: { proxy: { emailHeader: "Cf-Access-Authenticated-User-Email", secret: "PROXY_SECRET" } } } }));
    expect((await cf({ "cf-access-authenticated-user-email": "ann@acme.dev", "x-workbench-proxy-secret": secrets.PROXY_SECRET }))!.email).toBe("ann@acme.dev");
    expect(await cf({ "x-forwarded-email": "ann@acme.dev", "x-workbench-proxy-secret": secrets.PROXY_SECRET })).toBeNull();
    const g = createAuth(base({ mode: "proxy", secrets, settings }));
    expect((await g({ "x-forwarded-email": "accounts.google.com:ann@acme.dev", "x-workbench-proxy-secret": secrets.PROXY_SECRET }))!.email).toBe("ann@acme.dev");
  });

  it("applies the allow list once one is set: listed people, listed domains, nobody else", async () => {
    const id = createAuth(base({ mode: "proxy", secrets, settings: { ...settings, access: { users: [{ email: "boss@acme.dev", role: "admin" }, { email: "watch@else.dev", role: "viewer" }], domains: ["acme.dev"], defaultRole: "member" } } }));
    const h = (email: string) => ({ "x-forwarded-email": email, "x-workbench-proxy-secret": secrets.PROXY_SECRET });
    expect((await id(h("BOSS@acme.dev")))!.role).toBe("admin");
    expect((await id(h("watch@else.dev")))!.role).toBe("viewer");
    expect((await id(h("new@acme.dev")))!.role).toBe("member");
    expect(await id(h("someone@evil.dev"))).toBeNull();
    expect(await id(h("someone@notacme.dev"))).toBeNull();
  });

  it("admits a support grant until it expires or is revoked", async () => {
    const support = new SupportAccess(openDb(":memory:"));
    const id = createAuth(base({ mode: "proxy", secrets, support, settings: { ...settings, access: { users: [{ email: "boss@acme.dev", role: "admin" }] } } }));
    const h = { "x-forwarded-email": "help@host.dev", "x-workbench-proxy-secret": secrets.PROXY_SECRET };
    expect(await id(h)).toBeNull();
    const g = support.grant({ email: "help@host.dev", minutes: 10, reason: "ticket 1" }, "host");
    expect(await id(h)).toMatchObject({ role: "viewer", via: "support" });
    support.revoke(g.id);
    expect(await id(h)).toBeNull();
  });
});

describe("cidr matching", () => {
  it("handles IPv4, IPv6, mapped addresses and junk", () => {
    expect(inCidrs("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(inCidrs("::ffff:10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(inCidrs("11.1.2.3", ["10.0.0.0/8"])).toBe(false);
    expect(inCidrs("fdaa:1::1", ["fdaa::/16"])).toBe(true);
    expect(inCidrs("fdab::1", ["fdaa::/16"])).toBe(false);
    expect(inCidrs("10.0.0.1", ["fdaa::/16"])).toBe(false);
    expect(inCidrs("not-an-ip", ["0.0.0.0/0"])).toBe(false);
    expect(inCidrs(undefined, ["0.0.0.0/0"])).toBe(false);
  });
});

describe("oidc mode", () => {
  // A local issuer: discovery, JWKS and a token endpoint that returns whatever id_token the test chose.
  let srv: Server;
  let issuer = "";
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let nextClaims: Record<string, unknown> = {};
  let nextKey: CryptoKey | null = null;
  let lastToken: URLSearchParams | null = null;
  beforeAll(async () => {
    keys = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    srv = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const send = (j: unknown) => (res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(j)));
        if (req.url === "/.well-known/openid-configuration") return send({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
        if (req.url === "/jwks") return send({ keys: [jwk] });
        if (req.url === "/token") {
          lastToken = new URLSearchParams(body);
          const t = await new SignJWT(nextClaims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuedAt().setExpirationTime("5m").sign(nextKey ?? keys.privateKey);
          return send({ id_token: t, access_token: "a", token_type: "Bearer" });
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    issuer = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  });
  afterAll(() => srv.close());

  const oidcAuth = (access: unknown = { users: [{ email: "ann@acme.dev", role: "admin" }], domains: ["acme.dev"] }) =>
    createAuth(base({ mode: "oidc", secrets: { OIDC_CLIENT_SECRET: "client-secret" }, settings: { access, auth: { oidc: { issuer, clientId: "wb-client" } } } }));
  /** Runs loginStart, then a callback carrying the state and the sign-in cookie, as a browser would. */
  async function signIn(id: ReturnType<typeof oidcAuth>, claims: (nonce: string) => Record<string, unknown>, tamper: { state?: string; cookie?: string } = {}) {
    const start = await id.loginStart("https://box.example.com/auth/callback", "/runs");
    const u = new URL(start.url);
    expect(u.origin + u.pathname).toBe(`${issuer}/authorize`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("client_id")).toBe("wb-client");
    nextClaims = { iss: issuer, aud: "wb-client", ...claims(u.searchParams.get("nonce")!) };
    return id.loginFinish({ code: "c1", state: tamper.state ?? u.searchParams.get("state")! }, { cookie: `wb-oidc=${encodeURIComponent(tamper.cookie ?? start.cookie.value)}` });
  }

  it("signs a listed person in with PKCE, sets a session cookie, and identifies them from it", async () => {
    const id = oidcAuth();
    const r = await signIn(id, (nonce) => ({ email: "ann@acme.dev", email_verified: true, name: "Ann Smith", nonce }));
    expect(r.next).toBe("/runs");
    expect(lastToken!.get("code_verifier")).toBeTruthy();
    expect(lastToken!.get("client_secret")).toBe("client-secret");
    const me = await id({ cookie: `wb-session=${encodeURIComponent(r.session.value)}` });
    expect(me).toEqual({ email: "ann@acme.dev", name: "Ann Smith", role: "admin", via: "oidc" });
    // A domain match gets the default role.
    const r2 = await signIn(id, (nonce) => ({ email: "bo@acme.dev", nonce }));
    expect((await id({ cookie: `wb-session=${encodeURIComponent(r2.session.value)}` }))!.role).toBe("member");
  });

  it("refuses forged or mismatched sign-ins", async () => {
    const id = oidcAuth();
    await expect(signIn(id, (nonce) => ({ email: "ann@acme.dev", nonce }), { state: "forged" })).rejects.toThrow(/state/);
    await expect(signIn(id, (nonce) => ({ email: "ann@acme.dev", nonce }), { cookie: sign(randomBytes(32), { state: "x" }) })).rejects.toThrow(/took too long|another browser/);
    await expect(signIn(id, () => ({ email: "ann@acme.dev", nonce: "wrong" }))).rejects.toThrow(/nonce/);
    await expect(signIn(id, (nonce) => ({ email: "ann@acme.dev", nonce, aud: "someone-else" }))).rejects.toThrow();
    await expect(signIn(id, (nonce) => ({ email: "ann@acme.dev", nonce, iss: "https://evil.example" }))).rejects.toThrow();
    await expect(signIn(id, (nonce) => ({ email: "ann@acme.dev", email_verified: false, nonce }))).rejects.toThrow(/not verified/);
    await expect(signIn(id, (nonce) => ({ email: "eve@evil.dev", nonce }))).rejects.toThrow(/not on this box's list/);
    await expect(signIn(id, (nonce) => ({ nonce }))).rejects.toThrow(/email/);
    nextKey = (await generateKeyPair("RS256")).privateKey;
    await expect(signIn(id, (nonce) => ({ email: "ann@acme.dev", nonce }))).rejects.toThrow();
    nextKey = null;
    await expect(id.loginFinish({ error: "access_denied" }, {})).rejects.toThrow(/access_denied/);
  });

  it("refuses tampered, foreign and expired session cookies, and people removed from the list", async () => {
    const id = oidcAuth();
    const r = await signIn(id, (nonce) => ({ email: "ann@acme.dev", nonce }));
    const [body, mac] = r.session.value.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ email: "boss@acme.dev", name: "x", exp: 9e9 })).toString("base64url");
    expect(await id({ cookie: `wb-session=${forgedBody}.${mac}` })).toBeNull();
    expect(await id({ cookie: `wb-session=${sign(randomBytes(32), { email: "ann@acme.dev", exp: 9e9 })}` })).toBeNull();
    expect(await id({ cookie: `wb-session=${sign(KEY, { email: "ann@acme.dev", name: "Ann", exp: Math.floor(Date.now() / 1000) - 1 })}` })).toBeNull();
    expect(await id({ cookie: `wb-session=${body}` })).toBeNull();
    expect(await id({ "x-forwarded-email": "ann@acme.dev", "x-wb-as": "ann" })).toBeNull();
    const removed = oidcAuth({ users: [{ email: "other@x.dev", role: "admin" }] });
    expect(await removed({ cookie: `wb-session=${encodeURIComponent(r.session.value)}` })).toBeNull();
  });

  it("with an empty list admits only the bootstrap admin", async () => {
    const open = oidcAuth({});
    await expect(signIn(open, (nonce) => ({ email: "anyone@gmail.com", nonce }))).rejects.toThrow(/not on this box's list/);
    const boot = createAuth(base({ mode: "oidc", bootstrapAdmin: "first@acme.dev", secrets: { OIDC_CLIENT_SECRET: "client-secret" }, settings: { auth: { oidc: { issuer, clientId: "wb-client" } } } }));
    const r = await signIn(boot as any, (nonce) => ({ email: "first@acme.dev", nonce }));
    expect(r.identity.role).toBe("admin");
  });

  it("explains a missing client secret instead of starting a sign-in", async () => {
    const id = createAuth(base({ mode: "oidc", secrets: {}, settings: { auth: { oidc: { issuer, clientId: "wb-client" } } } }));
    await expect(id.loginStart("https://x/auth/callback", "/")).rejects.toThrow(/OIDC_CLIENT_SECRET is not set/);
  });
});

describe("terminal tokens follow access", () => {
  it("revokes tokens of people no longer let in, and typing tokens of people who became viewers", async () => {
    const { TermLogin } = await import("../src/lib/term-login.ts");
    const revokedNames: string[] = [];
    const tokens = ["ann@acme.dev", "gone@acme.dev", "vic@acme.dev", "vic@acme.dev (watch)", "token_7"];
    const zj = { listTokens: async () => tokens, revokeToken: async (n: string) => void revokedNames.push(n) };
    const db = openDb(":memory:");
    const t = new TermLogin(db, zj as any, "/nonexistent", "http://127.0.0.1:1");
    const roles: Record<string, string> = { "ann@acme.dev": "member", "vic@acme.dev": "viewer" };
    const out = await t.reconcile((email, readOnly) => !!roles[email] && (readOnly || roles[email] !== "viewer"));
    expect(out).toEqual(["gone@acme.dev", "vic@acme.dev"]);
    expect(revokedNames).toEqual(["gone@acme.dev", "vic@acme.dev"]);
  });

  it("makes one token when a person opens several terminals at once", async () => {
    const { TermLogin } = await import("../src/lib/term-login.ts");
    const dir = mkdtempSync(join(tmpdir(), "wb-tokens-"));
    const tokensDb = join(dir, "tokens.db");
    const z = new Database(tokensDb);
    z.exec("create table tokens (name text unique)");
    let made = 0;
    const zj = {
      listTokens: async () => (z.prepare("select name from tokens").all() as { name: string }[]).map((r) => r.name),
      createToken: async () => {
        await new Promise((r) => setTimeout(r, 20));
        const name = `token_${++made}`;
        z.prepare("insert into tokens (name) values (?)").run(name);
        return { name, token: `secret-${made}` };
      },
    };
    const t = new TermLogin(openDb(":memory:"), zj as any, tokensDb, "http://127.0.0.1:1");
    const got = await Promise.all([t.tokenFor("sam@acme.dev"), t.tokenFor("sam@acme.dev"), t.tokenFor("sam@acme.dev")]);
    expect(made).toBe(1);
    expect(new Set(got)).toEqual(new Set(["secret-1"]));
    expect(await zj.listTokens()).toEqual(["sam@acme.dev"]);
  });
});
