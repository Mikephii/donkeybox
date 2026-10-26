// Reads a release manifest from an image without running it: the `org.donkeybox.release` label, from
// the local Docker engine when it has the image, otherwise from the registry over the OCI distribution
// API (anonymous pull, which GHCR and Docker Hub allow for public images). Only Node built-ins, so an
// unpacked release tarball runs it.
//   node packages/cli/src/wb.ts manifest IMAGE
import { spawnSync } from "node:child_process";

export const RELEASE_LABEL = "org.donkeybox.release";

export interface ImageRef {
  registry: string;
  repository: string;
  reference: string;
}

/** Splits `ghcr.io/org/name:tag`, `org/name@sha256:...` or `name` the way Docker does. */
export function parseImageRef(image: string): ImageRef {
  let rest = image;
  let registry = "registry-1.docker.io";
  const slash = rest.indexOf("/");
  if (slash > 0) {
    const first = rest.slice(0, slash);
    if (first.includes(".") || first.includes(":") || first === "localhost") {
      registry = first === "docker.io" ? "registry-1.docker.io" : first;
      rest = rest.slice(slash + 1);
    }
  }
  let reference = "latest";
  const at = rest.indexOf("@");
  if (at >= 0) {
    reference = rest.slice(at + 1);
    rest = rest.slice(0, at);
  } else {
    const colon = rest.lastIndexOf(":");
    if (colon > rest.lastIndexOf("/")) {
      reference = rest.slice(colon + 1);
      rest = rest.slice(0, colon);
    }
  }
  if (registry === "registry-1.docker.io" && !rest.includes("/")) rest = `library/${rest}`;
  return { registry, repository: rest, reference };
}

export function parseManifestLabel(labels: Record<string, string> | null | undefined): unknown | null {
  const raw = labels?.[RELEASE_LABEL];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The label from the local Docker engine, or null when Docker or the image is not there. */
export function localLabels(image: string): Record<string, string> | null {
  const r = spawnSync("docker", ["image", "inspect", "--format", "{{json .Config.Labels}}", image], { encoding: "utf8" });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout) ?? null;
  } catch {
    return null;
  }
}

const ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

type Fetch = typeof fetch;

/** The image config's labels from the registry, for the given platform (default linux/amd64). */
export async function registryLabels(image: string, opts: { fetch?: Fetch; platform?: string } = {}): Promise<Record<string, string> | null> {
  const f = opts.fetch ?? fetch;
  const [os, arch] = (opts.platform ?? "linux/amd64").split("/");
  const ref = parseImageRef(image);
  const base = `https://${ref.registry}/v2/${ref.repository}`;
  let auth: string | undefined;

  const get = async (url: string, accept: string): Promise<Response> => {
    let r = await f(url, { headers: { accept, ...(auth ? { authorization: auth } : {}) } });
    if (r.status === 401 && !auth) {
      const challenge = r.headers.get("www-authenticate") ?? "";
      const realm = /realm="([^"]+)"/.exec(challenge)?.[1];
      if (!realm) return r;
      const service = /service="([^"]+)"/.exec(challenge)?.[1];
      const scope = /scope="([^"]+)"/.exec(challenge)?.[1] ?? `repository:${ref.repository}:pull`;
      const q = new URLSearchParams({ scope, ...(service ? { service } : {}) });
      const t = await f(`${realm}?${q}`);
      if (!t.ok) return r;
      const body = (await t.json()) as { token?: string; access_token?: string };
      auth = `Bearer ${body.token ?? body.access_token}`;
      r = await f(url, { headers: { accept, authorization: auth } });
    }
    return r;
  };

  let r = await get(`${base}/manifests/${ref.reference}`, ACCEPT);
  if (!r.ok) return null;
  let manifest = (await r.json()) as any;
  if (Array.isArray(manifest.manifests)) {
    const pick =
      manifest.manifests.find((m: any) => m.platform?.os === os && m.platform?.architecture === arch) ??
      manifest.manifests.find((m: any) => m.platform?.os !== "unknown");
    if (!pick) return null;
    r = await get(`${base}/manifests/${pick.digest}`, ACCEPT);
    if (!r.ok) return null;
    manifest = await r.json();
  }
  const digest = manifest.config?.digest;
  if (!digest) return null;
  r = await get(`${base}/blobs/${digest}`, "application/json");
  if (!r.ok) return null;
  const config = (await r.json()) as any;
  return config.config?.Labels ?? null;
}

/** Local Docker first (fast, works offline for images built here), then the registry. */
export async function readImageManifest(image: string, opts: { fetch?: Fetch; platform?: string; local?: boolean } = {}): Promise<unknown | null> {
  if (opts.local !== false) {
    const local = parseManifestLabel(localLabels(image));
    if (local) return local;
  }
  try {
    return parseManifestLabel(await registryLabels(image, opts));
  } catch {
    return null;
  }
}
