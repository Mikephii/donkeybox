// The release manifest read from an image label over the registry API, with recorded GHCR-shaped
// responses (anonymous token, multi-arch index, per-platform manifest, config blob).
import { describe, expect, it } from "vitest";
import { parseImageRef, parseManifestLabel, readImageManifest, registryLabels, RELEASE_LABEL } from "../../cli/src/image-manifest.ts";

const MANIFEST = { version: "0.5.0", schemaVersion: 4, compatFloor: 1, minUpgradeFrom: "0.3.0", capabilities: ["drain"] };

function ghcr(opts: { label?: boolean } = {}) {
  const calls: string[] = [];
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const auth = new Headers(init?.headers).get("authorization");
    if (url.startsWith("https://ghcr.io/token")) {
      expect(url).toContain("scope=repository%3Aexample%2Fdonkeybox%3Apull");
      return json({ token: "anon" });
    }
    if (auth !== "Bearer anon")
      return json({ errors: [{ code: "UNAUTHORIZED" }] }, 401, {
        "www-authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:example/donkeybox:pull"',
      });
    if (url === "https://ghcr.io/v2/example/donkeybox/manifests/0.5.0")
      return json({
        mediaType: "application/vnd.oci.image.index.v1+json",
        manifests: [
          { digest: "sha256:arm", platform: { os: "linux", architecture: "arm64" } },
          { digest: "sha256:amd", platform: { os: "linux", architecture: "amd64" } },
          { digest: "sha256:att", platform: { os: "unknown", architecture: "unknown" } },
        ],
      });
    if (url === "https://ghcr.io/v2/example/donkeybox/manifests/sha256:amd") return json({ config: { digest: "sha256:cfg-amd" } });
    if (url === "https://ghcr.io/v2/example/donkeybox/manifests/sha256:arm") return json({ config: { digest: "sha256:cfg-arm" } });
    if (url.endsWith("/blobs/sha256:cfg-amd") || url.endsWith("/blobs/sha256:cfg-arm"))
      return json({ architecture: url.endsWith("arm") ? "arm64" : "amd64", config: { Labels: opts.label === false ? {} : { [RELEASE_LABEL]: JSON.stringify(MANIFEST) } } });
    return json({ errors: [{ code: "MANIFEST_UNKNOWN" }] }, 404);
  }) as typeof fetch;
  return { f, calls };
}

describe("image references", () => {
  it("splits registry, repository and reference the way Docker does", () => {
    expect(parseImageRef("ghcr.io/example/donkeybox:0.5.0")).toEqual({ registry: "ghcr.io", repository: "example/donkeybox", reference: "0.5.0" });
    expect(parseImageRef("ghcr.io/example/donkeybox")).toMatchObject({ reference: "latest" });
    expect(parseImageRef("ghcr.io/example/donkeybox@sha256:abc")).toMatchObject({ reference: "sha256:abc" });
    expect(parseImageRef("workbench:0.4.0")).toEqual({ registry: "registry-1.docker.io", repository: "library/workbench", reference: "0.4.0" });
    expect(parseImageRef("localhost:5000/wb:1")).toEqual({ registry: "localhost:5000", repository: "wb", reference: "1" });
  });
  it("reads the label as JSON and ignores anything else", () => {
    expect(parseManifestLabel({ [RELEASE_LABEL]: JSON.stringify(MANIFEST) })).toEqual(MANIFEST);
    expect(parseManifestLabel({ [RELEASE_LABEL]: "" })).toBeNull();
    expect(parseManifestLabel({ [RELEASE_LABEL]: "{nope" })).toBeNull();
    expect(parseManifestLabel(null)).toBeNull();
  });
});

describe("registry labels", () => {
  it("follows the anonymous token challenge and picks linux/amd64 from a multi-arch index", async () => {
    const { f, calls } = ghcr();
    const labels = await registryLabels("ghcr.io/example/donkeybox:0.5.0", { fetch: f });
    expect(parseManifestLabel(labels)).toEqual(MANIFEST);
    expect(calls.some((c) => c.endsWith("/manifests/sha256:amd"))).toBe(true);
    expect(calls.filter((c) => c.startsWith("https://ghcr.io/token"))).toHaveLength(1);
  });
  it("picks another platform when asked", async () => {
    const { f, calls } = ghcr();
    await registryLabels("ghcr.io/example/donkeybox:0.5.0", { fetch: f, platform: "linux/arm64" });
    expect(calls.some((c) => c.endsWith("/manifests/sha256:arm"))).toBe(true);
  });
  it("returns null for an unknown tag and for an image without the label", async () => {
    expect(await readImageManifest("ghcr.io/example/donkeybox:9.9.9", { fetch: ghcr().f, local: false })).toBeNull();
    expect(await readImageManifest("ghcr.io/example/donkeybox:0.5.0", { fetch: ghcr({ label: false }).f, local: false })).toBeNull();
  });
});
