import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { iapEmail, iapKeys } from "./gcp/iap.ts";
import type { Settings } from "../engine/config.ts";
import type { SupportAccess } from "./support.ts";

/**
 * Who is calling, and what they may do. Every request (API, the door's /auth/check, Yjs and terminals
 * through the door) goes through identify(). AUTH_MODE picks how the person is proven:
 *   dev    anyone, as DEV_USER_EMAIL or ?as=; refused in production
 *   iap    Google IAP's signed header (the allow list lives in Terraform)
 *   proxy  an email header from a sign-in proxy, trusted only with the proxy's shared secret or from
 *          its network (Cloudflare Access, oauth2-proxy, Pomerium, Tailscale)
 *   oidc   the box's own sign-in with any OIDC issuer, then a signed session cookie
 * Roles come from settings.access (admin, member, viewer), a support grant, or WB_BOOTSTRAP_ADMIN.
 */
export type Role = "admin" | "member" | "viewer";
export type AuthMode = "dev" | "iap" | "proxy" | "oidc";
export interface Identity {
  email: string;
  name: string;
  role: Role;
  via: AuthMode | "support";
}
type Headers = Record<string, string | string[] | undefined>;

export const SESSION_COOKIE = "wb-session";
const OIDC_COOKIE = "wb-oidc";
export const PROXY_SECRET_HEADER = "x-workbench-proxy-secret";
/** Set by the door (Caddy) to the client's address; trusted only when the request comes from the door on loopback. */
export const PEER_HEADER = "x-wb-peer";

export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.split(/[._-]/).filter(Boolean).map((p) => p[0]!.toUpperCase() + p.slice(1)).join(" ") || email;
}

const first = (headers: Headers, k: string) => {
  const v = headers[k.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};
const cookieOf = (headers: Headers, name: string) => {
  const m = first(headers, "cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]!) : undefined;
};
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ───────────── addresses ─────────────

function ipToBigInt(ip: string): { v: bigint; bits: number } | null {
  if (ip.startsWith("::ffff:") && ip.includes(".")) ip = ip.slice(7);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const p = ip.split(".").map(Number);
    if (p.some((x) => x > 255)) return null;
    return { v: p.reduce((a, x) => (a << 8n) | BigInt(x), 0n), bits: 32 };
  }
  if (!ip.includes(":")) return null;
  const [head, tail] = ip.split("::") as [string, string | undefined];
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  if (groups.length !== 8) return null;
  return { v: groups.reduce((a, g) => (a << 16n) | BigInt(parseInt(g || "0", 16)), 0n), bits: 128 };
}
/** True when ip is inside any of the CIDR ranges (IPv4 and IPv6). */
export function inCidrs(ip: string | undefined, cidrs: string[]): boolean {
  if (!ip) return false;
  const a = ipToBigInt(ip.trim());
  if (!a) return false;
  return cidrs.some((c) => {
    const [net, lenS] = c.split("/") as [string, string | undefined];
    const n = ipToBigInt(net);
    if (!n || n.bits !== a.bits) return false;
    const len = lenS === undefined ? n.bits : Number(lenS);
    const shift = BigInt(n.bits - len);
    return a.v >> shift === n.v >> shift;
  });
}
const isLoopback = (ip: string | undefined) => !!ip && (ip === "::1" || ip.startsWith("127.") || ip === "::ffff:127.0.0.1");

// ───────────── signed values (session and sign-in cookies) ─────────────

export function sign(key: Buffer, value: object): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}
export function unsign<T>(key: Buffer, token: string | undefined): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac || !safeEqual(mac, createHmac("sha256", key).update(body).digest("base64url"))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

// ───────────── roles ─────────────

export interface RoleOptions {
  mode: AuthMode;
  settings: () => Settings;
  bootstrapAdmin?: string;
  support?: SupportAccess | null;
}
/**
 * The role for a proven email, or null when this box does not let them in.
 * Listed people get their role; a listed domain gets the default role. Dev mode makes everyone else
 * an admin. In iap (where the gate is Terraform's list) and in proxy mode with an empty list (the
 * proxy's own policy is the gate), everyone else gets the default role. OIDC with an empty list
 * admits only the bootstrap admin.
 */
export function roleFor(email: string, o: RoleOptions): { role: Role; via?: "support" } | null {
  const a = o.settings().access;
  const e = email.toLowerCase();
  if (o.bootstrapAdmin && e === o.bootstrapAdmin.toLowerCase()) return { role: "admin" };
  const listed = a.users.find((u) => u.email.toLowerCase() === e);
  if (listed) return { role: listed.role };
  const domain = e.split("@")[1] ?? "";
  if (a.domains.some((d) => d.toLowerCase().replace(/^@/, "") === domain)) return { role: a.defaultRole };
  const grant = o.support?.active(email);
  if (grant) {
    o.support!.used(grant);
    return { role: grant.role, via: "support" };
  }
  const empty = !a.users.length && !a.domains.length;
  // Dev mode is one person on a laptop: anyone not listed (including ?as= personas) is an admin.
  if (o.mode === "dev") return { role: "admin" };
  if (o.mode === "iap" || (o.mode === "proxy" && empty)) return { role: a.defaultRole };
  return null;
}

// ───────────── OIDC ─────────────

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

export class OidcClient {
  private disc: { at: number; doc: OidcDiscovery } | null = null;
  private jwks = new Map<string, JWTVerifyGetKey>();
  private fetchImpl: typeof fetch;
  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }
  async discover(issuer: string): Promise<OidcDiscovery> {
    if (this.disc && this.disc.doc.issuer === issuer.replace(/\/$/, "") && Date.now() - this.disc.at < 3600_000) return this.disc.doc;
    const r = await this.fetchImpl(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`OIDC discovery failed: HTTP ${r.status}`);
    const doc = (await r.json()) as OidcDiscovery;
    if (doc.issuer.replace(/\/$/, "") !== issuer.replace(/\/$/, "")) throw new Error("OIDC discovery returned a different issuer");
    this.disc = { at: Date.now(), doc };
    return doc;
  }
  keys(uri: string): JWTVerifyGetKey {
    if (!this.jwks.has(uri)) this.jwks.set(uri, createRemoteJWKSet(new URL(uri)));
    return this.jwks.get(uri)!;
  }
  async exchange(o: { issuer: string; clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string }) {
    const d = await this.discover(o.issuer);
    const body = new URLSearchParams({ grant_type: "authorization_code", code: o.code, redirect_uri: o.redirectUri, code_verifier: o.verifier, client_id: o.clientId, client_secret: o.clientSecret });
    const r = await this.fetchImpl(d.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
    if (!r.ok) throw new Error(`the identity provider refused the sign-in code (HTTP ${r.status})`);
    const j = (await r.json()) as { id_token?: string };
    if (!j.id_token) throw new Error("the identity provider sent no id_token");
    return { idToken: j.id_token, discovery: d };
  }
}

export interface AuthOptions {
  mode: AuthMode;
  devEmail: string;
  /** IAP audience (/projects/N/global/backendServices/M or /projects/N/apps/P). */
  audience: string;
  jwks?: JWTVerifyGetKey;
  production: boolean;
  settings: () => Settings;
  secret: (name: string) => string | undefined;
  bootstrapAdmin?: string;
  support?: SupportAccess | null;
  /** Signs session and sign-in cookies (kept in the data folder). */
  sessionKey: Buffer;
  oidc?: OidcClient;
  /** Overrides how OIDC id tokens are checked (tests). */
  oidcKeys?: JWTVerifyGetKey;
  log?: (m: string) => void;
}

export interface Session {
  email: string;
  name: string;
  exp: number;
}

export function createAuth(o: AuthOptions) {
  if (o.mode === "dev" && o.production) throw new Error("AUTH_MODE=dev is refused when NODE_ENV=production");
  if (o.mode === "iap" && !o.audience) throw new Error("AUTH_MODE=iap needs IAP_AUDIENCE");
  if (!["dev", "iap", "proxy", "oidc"].includes(o.mode)) throw new Error(`AUTH_MODE must be dev, iap, proxy or oidc, not ${o.mode}`);
  if (o.mode === "dev") (o.log ?? console.warn)(`\n  ⚠  DEV AUTH MODE: every request is treated as ${o.devEmail} (or ?as=). Never expose this.\n`);
  const keys = o.jwks ?? (o.mode === "iap" ? iapKeys() : undefined);
  const oidc = o.oidc ?? new OidcClient();
  const roles: RoleOptions = { mode: o.mode, settings: o.settings, bootstrapAdmin: o.bootstrapAdmin, support: o.support };
  const withRole = (email: string, name?: string): Identity | null => {
    const r = roleFor(email, roles);
    return r ? { email, name: name || nameFromEmail(email), role: r.role, via: r.via ?? o.mode } : null;
  };

  /** The proven email, before roles. peer is the TCP peer of the request (the door on loopback, normally). */
  async function prove(headers: Headers, peer?: string): Promise<{ email: string; name?: string } | null> {
    if (o.mode === "dev") {
      // ?as= in a tab sets x-wb-as on API calls and a wb-dev-as cookie for iframes and sockets.
      const as = (first(headers, "x-wb-as") ?? cookieOf(headers, "wb-dev-as"))?.trim();
      return { email: as ? (as.includes("@") ? as : `${as}@localhost`) : o.devEmail };
    }
    if (o.mode === "iap") {
      const email = await iapEmail(first(headers, "x-goog-iap-jwt-assertion"), keys!, o.audience);
      return email ? { email } : null;
    }
    if (o.mode === "proxy") {
      const p = o.settings().auth.proxy;
      const want = p.secret ? o.secret(p.secret) : undefined;
      const got = first(headers, PROXY_SECRET_HEADER);
      const secretOk = !!want && !!got && safeEqual(got, want);
      // The client address comes from the door's own header, and only when the request came from the door.
      const client = isLoopback(peer) ? first(headers, PEER_HEADER) ?? peer : peer;
      const networkOk = p.trustedCidrs.length > 0 && inCidrs(client, p.trustedCidrs);
      if (!secretOk && !networkOk) return null;
      const email = first(headers, p.emailHeader)?.trim().replace(/^accounts\.google\.com:/, "");
      if (!email || !/^[^\s@,]+@[^\s@,]+$/.test(email)) return null;
      return { email, name: p.nameHeader ? first(headers, p.nameHeader)?.trim() : undefined };
    }
    // oidc: the box's own session cookie
    const s = unsign<Session>(o.sessionKey, cookieOf(headers, SESSION_COOKIE));
    if (!s || typeof s.exp !== "number" || s.exp < Date.now() / 1000) return null;
    return { email: s.email, name: s.name };
  }

  async function identify(headers: Headers, peer?: string): Promise<Identity | null> {
    const p = await prove(headers, peer);
    return p ? withRole(p.email, p.name) : null;
  }

  // ── OIDC sign-in flow (only meaningful in oidc mode) ──
  function oidcSettings() {
    const c = o.settings().auth.oidc;
    if (!c.issuer || !c.clientId) throw new Error("OIDC is not set up: Settings › Doors and sign-in needs an issuer and client id");
    const secret = o.secret(c.clientSecret);
    if (!secret) throw new Error(`OIDC client secret ${c.clientSecret} is not set on the Secrets page`);
    return { ...c, issuer: c.issuer, clientId: c.clientId, clientSecretValue: secret };
  }

  /** Starts a sign-in: returns where to send the browser and the short-lived cookie that ties the callback to it. */
  async function loginStart(redirectUri: string, next: string) {
    const c = oidcSettings();
    const d = await oidc.discover(c.issuer);
    const state = randomBytes(16).toString("base64url");
    const nonce = randomBytes(16).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = new URL(d.authorization_endpoint);
    for (const [k, v] of Object.entries({ response_type: "code", client_id: c.clientId, redirect_uri: redirectUri, scope: c.scopes, state, nonce, code_challenge: challenge, code_challenge_method: "S256" }))
      url.searchParams.set(k, v);
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    const cookie = sign(o.sessionKey, { state, nonce, verifier, next: safeNext, redirectUri, exp: Math.floor(Date.now() / 1000) + 600 });
    return { url: url.toString(), cookie: { name: OIDC_COOKIE, value: cookie, maxAge: 600 } };
  }

  /** Finishes a sign-in. Returns the session cookie and where to go, or throws with a reason to show. */
  async function loginFinish(query: { code?: string; state?: string; error?: string; error_description?: string }, headers: Headers) {
    if (query.error) throw new Error(`the identity provider said: ${query.error_description ?? query.error}`);
    const pending = unsign<{ state: string; nonce: string; verifier: string; next: string; redirectUri: string; exp: number }>(o.sessionKey, cookieOf(headers, OIDC_COOKIE));
    if (!pending || pending.exp < Date.now() / 1000) throw new Error("the sign-in took too long or started in another browser; try again");
    if (!query.state || !safeEqual(query.state, pending.state)) throw new Error("the sign-in state does not match; try again");
    if (!query.code) throw new Error("no sign-in code came back");
    const c = oidcSettings();
    const { idToken, discovery } = await oidc.exchange({ issuer: c.issuer, clientId: c.clientId, clientSecret: c.clientSecretValue, code: query.code, verifier: pending.verifier, redirectUri: pending.redirectUri });
    const { payload } = await jwtVerify(idToken, o.oidcKeys ?? oidc.keys(discovery.jwks_uri), { issuer: discovery.issuer, audience: c.clientId });
    if (payload.nonce !== pending.nonce) throw new Error("the sign-in nonce does not match; try again");
    const email = String(payload.email ?? "");
    if (!email) throw new Error("the identity provider did not share an email address (add the email scope)");
    if (payload.email_verified === false) throw new Error(`${email} is not verified with the identity provider`);
    const id = withRole(email, typeof payload.name === "string" ? payload.name : undefined);
    if (!id) throw new Error(`${email} is not on this box's list; ask an admin to add you in Settings › People`);
    const exp = Math.floor(Date.now() / 1000) + c.sessionHours * 3600;
    return { identity: id, next: pending.next, session: { name: SESSION_COOKIE, value: sign(o.sessionKey, { email, name: id.name, exp } satisfies Session), maxAge: c.sessionHours * 3600 }, clear: OIDC_COOKIE };
  }

  return Object.assign(identify, { mode: o.mode, loginStart, loginFinish, roleFor: (email: string) => roleFor(email, roles) });
}
export type Identify = ReturnType<typeof createAuth>;
