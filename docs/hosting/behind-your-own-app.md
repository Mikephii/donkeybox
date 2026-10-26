---
title: "Behind your own app"
description: "Put the workbench behind your own product's login, as a proxy or an OIDC client."
---

You already run a product with its own login (Supabase Auth, Auth0, Clerk, or your own sessions)
and want the workbench inside it: a link in your admin area, or the workbench in an iframe. Your
login becomes the workbench's door.

## 1. What you get

Two supported shapes. Pick one.

- **Your backend is the proxy** (`proxy` mode). Your server checks your session, then forwards the
  request to the workbench with the person's email and a shared secret. The workbench is reachable
  only from your server.
- **The workbench signs in with your provider** (`oidc` mode). Supabase Auth, Auth0 and Clerk can
  act as OIDC providers. The workbench runs its own sign-in against them, at its own address, and
  people who are already signed in to your provider go straight through.

Either way the box runs from the image (or the compose file without its oauth2-proxy), webhooks
arrive at the hooks door on port 8081, and everything persists on the `/data` volume.

## 2. Security

Never let the browser talk to the workbench with your app's token. The workbench cannot verify
your app's tokens, and it should not have to: a token for your product is a token for your product,
and accepting it would let any part of your product, or anyone who steals a token from it, act on
the workbench. Keep the two apart. Either your server vouches for the person (shape 1), or the
workbench checks your provider's ID token itself (shape 2).

What the door verifies.

- **Shape 1.** The workbench believes `X-Forwarded-Email` (or the header you choose) only when the
  request carries `X-Workbench-Proxy-Secret` matching the `PROXY_SECRET` value in its secrets store,
  or comes from your server's address in `auth.proxy.trustedCidrs`. Your server must strip any
  `X-Forwarded-Email` the browser sent before setting its own.
- **Shape 2.** The workbench checks the ID token's signature, issuer, audience and nonce, refuses
  unverified emails, and keeps its own signed session cookie.

What can reach the box. Shape 1: only your server, on a private network. Shape 2: the internet on
443, where every request needs the workbench's session. In both, the hooks door is public and
answers only signed `POST /hooks/...`.

How secrets are stored. In the volume's secrets file, mode 600, never in config or git.

Who gets in. Your product may have thousands of users. The workbench's own Settings › People list
decides who gets in to the box and as what, whatever your app allows. In `oidc` mode an empty list
admits only the bootstrap admin. Everyone who gets in can open a shell on the box, so keep the
list to people you would give server access to, and make the rest viewers.

Threats, briefly:

- **Your server forwards the browser's own email header.** Then anyone could claim to be anyone.
  Overwrite the header on every request, and test that a forged one from the browser is ignored.
- **The proxy secret leaks.** Rotate it (Secrets page or `POST /v1/door-secret/rotate` on the
  management API) and update your server.
- **An iframe is framed by a hostile page.** Serve the workbench on a host only your app frames,
  and set your own `Content-Security-Policy: frame-ancestors` at your edge.

## 3. Users

- **Your login decides who can try.** The workbench's People list decides who gets in and with
  which role. Add a whole domain to let your staff in as members.
- **Sync it from your side** with the management API: `PUT /v1/access` with
  `{ "users": [{ "email": "...", "role": "admin" }], "domains": ["yourco.com"] }`.
- **Sign-ins last** as long as your session (shape 1) or `auth.oidc.sessionHours` (shape 2).
- **Terminal tokens** are revoked within seconds of someone being removed or made a viewer.
- **Read-only terminals** come with the viewer role.

## 4. Provision

**Shape 1, your backend as the proxy.** Run the image on a private network your server can reach:

```sh
docker run -d --name workbench -v workbench-data:/data \
  -e AUTH_MODE=proxy -e WB_HOOKS_DOOR_PORT=8081 -e WB_BOOTSTRAP_ADMIN=you@yourco.com \
  -e WB_SEED_PUBLIC_APP_URL=https://app.yourco.com/workbench -e WB_SEED_PUBLIC_HOOKS_URL=https://hooks.yourco.com \
  -p 10.0.0.5:8080:8080 -p 8081:8081 ghcr.io/mikephii/donkeybox:0.5.0
```

Generate `PROXY_SECRET` on the box (`docker exec -u workbench workbench wb secrets generate PROXY_SECRET`)
and give it to your server. Then forward the workbench's paths, keeping websockets:

```js
// Node, with http-proxy-middleware, after your own auth middleware has set req.user.
app.use("/", requireStaff, createProxyMiddleware({
  target: "http://10.0.0.5:8080",
  ws: true,
  on: {
    proxyReq: (proxyReq, req) => {
      proxyReq.removeHeader("x-forwarded-email");
      proxyReq.setHeader("x-forwarded-email", req.user.email);
      proxyReq.setHeader("x-workbench-proxy-secret", process.env.WORKBENCH_PROXY_SECRET);
    },
  },
}));
```

The workbench expects to be served at the root of a host (`/api`, `/term`, `/yjs`, `/p`), so give
it its own host name, such as `workbench.yourco.com`, rather than a path inside your app.

**Shape 2, OIDC against your provider.** Register an OAuth client at your provider with the
redirect URL `https://workbench.yourco.com/auth/callback`, then run the image with:

```sh
-e AUTH_MODE=oidc -e OIDC_CLIENT_SECRET=<secret> \
-e WB_SEED_SETTINGS='{"auth":{"oidc":{"issuer":"https://<your-project>.supabase.co/auth/v1","clientId":"<id>"}},"access":{"domains":["yourco.com"]}}'
```

Issuer examples: Auth0 `https://<tenant>.auth0.com/`, Clerk `https://<app>.clerk.accounts.dev`,
Supabase `https://<project>.supabase.co/auth/v1` with its OAuth server turned on. Put TLS in front
(your load balancer or the compose file's `tls` profile).

## 5. First boot

Open the workbench through your app and sign in. Then follow the Setup page: sign Claude Code in
from a terminal (with a key or seat permitted for shared use),
generate a webhook secret, send a test delivery, create a workflow, and give the box's config repo a remote.

## 6. Updating, backing up and restoring

**Update.** Your product's control plane follows [the contract in updating.md](updating.md#the-contract-for-a-control-plane):
drain, back up, record the update, swap the image, check `/v1/health`, and put the old image back if
it fails. On one host with compose, `wb update --via compose` does the same.

**Back up and restore.** Back up the `workbench-data` volume as in
[self-hosted-proxy.md](self-hosted-proxy.md#6-updating-backing-up-and-restoring), and push the
box's config repo a remote in Settings.

## 7. Checklist

- [ ] The browser never sends your app's token to the workbench.
- [ ] Shape 1: only your server can reach port 8080, and it overwrites `X-Forwarded-Email` on every request.
- [ ] Shape 1: a request with a forged email and no secret gets 401.
- [ ] Shape 2: the redirect URL is registered exactly, and an empty People list admits only the bootstrap admin.
- [ ] Settings › People lists only people who should have a shell on the box; others are viewers or absent.
- [ ] The workbench has its own host name, with TLS.
- [ ] Claude Code is signed in with a key or seat permitted for shared use.
- [ ] Each webhook source has a generated secret and a test delivery was accepted.
- [ ] The volume is backed up, and the box's config repo has a remote of its own.

Last walked through: not yet verified on a fresh host (product 0.3.0). Both modes are covered by
unit tests with forged and valid inputs; neither shape has been run against a real product.
