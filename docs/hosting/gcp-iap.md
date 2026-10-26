---
title: "Google Cloud with IAP"
description: "The Terraform module builds the whole box in a Google Cloud project behind IAP."
---

The Terraform module in `deploy/gcp` builds the whole box in a GCP project of its own.

## 1. What you get

- **Identity mode** `iap`. Google Cloud IAP is the door. Only Google accounts on the module's
  `allowed_emails` list get past it, and IAP signs each request it lets through.
- **The box** is a private VM on Container-Optimized OS with no public address. It runs the
  workbench image with the data disk mounted at `/var/lib/workbench` (the container's `/data`).
- **Two host names on one HTTPS load balancer.** `app_domain` goes to the app door through IAP.
  `hooks_domain` goes to the hooks door, which answers only `POST /hooks/...` and needs no sign-in,
  because GitHub and Jira cannot sign in.
- **Persistence.** A separate persistent disk that Terraform refuses to delete, with a daily
  snapshot kept for 14 days by default. Secrets live in Secret Manager, named `<name>-<SECRET>`.
- **Egress** goes through Cloud NAT. SSH works only through IAP TCP forwarding.

## 2. Security

What the door verifies. IAP signs every request it forwards with an ES256 JWT. The app checks the
signature against Google's keys, the issuer, and the audience, which is this box's own backend
service. A request that went around IAP, or one meant for another IAP app, has no valid token and
gets a 401. The audience reaches the VM through project metadata at boot.

What can reach the box. Only Google's load balancer and health-check ranges, on ports 8080 (app)
and 8081 (hooks). The VM has no external address. Port 22 is open only to IAP's TCP forwarding range.

How secrets are stored. In Secret Manager. The VM's service account may manage only secrets whose
names start with the box's prefix. No value ever goes into config.json or git, and no API returns a
value after the response that created it.

What people on the list can do. Everyone IAP lets in can open a terminal on the box, and that shell
can read every token on it: the deploy key, MCP sign-ins, Claude Code's sign-in and, through the
VM's service account, the box's secrets. Give people the viewer role (Settings › People) when they
should only watch.

What stays outside the app on purpose. The allow list. It lives in Terraform (`allowed_emails`) so
nobody can add themselves from inside the box. Roles live in the app's Settings and default to
member for anyone listed in Terraform but not in Settings.

Threats, briefly:

- **IAP misconfigured or turned off.** The app still refuses every request without a valid IAP
  token for its own audience. Nothing is open by accident.
- **A hooks secret leaks.** Someone can send fake events to that source, which can start runs.
  Rotate it on the Secrets page (the old value stops at once) and paste the new one into the sender.
- **The data disk is lost.** Restore it from the latest snapshot (section 6). The box's config repo's
  remote holds config and skills even if every snapshot is gone.
- **A team member's laptop is stolen.** Remove them from `allowed_emails` and apply. Their terminal
  tokens are revoked at the next nightly check, and the door refuses them at once.

## 3. Users

- **Add or remove people** in `allowed_emails`, then `terraform apply`. That list is the only way in.
- **Roles** (admin, member, viewer) are set in Settings › People by an admin. Anyone on the
  Terraform list but not in Settings is a member.
- **Accounts outside your Google Workspace.** The Google-managed OAuth client only admits accounts
  in your organisation. For outside accounts, configure the OAuth consent screen as External, create
  an OAuth client, and pass it as `iap_oauth2_client_id` and `iap_oauth2_client_secret`.
- **How long a sign-in lasts** is IAP's session, set in the IAP settings of the project (one hour
  by default, then a silent refresh). Terminal websockets reconnect after IAP's hourly cut.
- **Terminal tokens.** Each person gets a Zellij token named after their email. Removing someone, or
  making them a viewer, revokes their typing token within seconds of the change in Settings, and
  every night against the Terraform list.
- **Read-only terminals.** Make the person a viewer. They get a watch-only token and cannot type.

## 4. Provision

You need a GCP project, Terraform 1.6 or newer, `gcloud` signed in with Owner on the project, and
the image in a registry the VM can pull from (Artifact Registry in the same project is simplest).

```sh
cp -r deploy/gcp/examples/minimal my-box && cd my-box
# edit main.tf: project_id, image, app_domain, hooks_domain, allowed_emails, bootstrap_admin
terraform init
terraform apply
```

Then create two DNS A records, `app_domain` and `hooks_domain`, pointing at the `lb_ip` output.
The managed certificate turns active 15 to 60 minutes after DNS resolves.

Variables worth knowing: `machine_type` (default `e2-standard-4`), `data_disk_size_gb` (100),
`snapshot_retention_days` (14), and `extra_env` for things like
`WB_MANAGEMENT_TOKEN`.

## 5. First boot

Open `https://<app_domain>`. The Setup page in the sidebar walks through the rest:

1. **Sign Claude Code in.** Open a terminal, run `wb tools install claude-code` if the Setup page
   says it is missing, then `claude` and `/login`. Use a key or seat permitted for shared use.
2. **Clone the code you work on** in a terminal, with your own credentials. The workbench does not
   manage code repos; a workflow can start its runs in any folder you name.
3. **Generate a webhook secret** on a source and paste the URL and secret into the sender.
4. **Send a test delivery** from the Sources page.
5. **Create a workflow** and run it once.
6. **Give the box's config a remote** in Settings › Box config repo if Terraform did not: a repo of
   its own for the box's settings and skills, never your code.

The public addresses are already filled in from Terraform; check them in Settings › General.

## 6. Updating, backing up and restoring

**Update.** Open an IAP tunnel to the management API
(`gcloud compute start-iap-tunnel <name>-vm 8002 --local-host-port=localhost:8002 --zone <zone>`),
then run `wb update --to <version> --via gcp` from the Terraform folder. The driver pins the new
image in your tfvars file, snapshots the data disk (with `WB_GCP_DISK=<name>-data` and
`WB_GCP_ZONE`), and applies; the VM is replaced and the data disk reattached. If the new version is
not healthy in time, the old image goes back and restores its own backup when it has to. Bump the
module `ref` in a separate change. See [updating.md](updating.md).

**Back up.** Snapshots run daily. Take one by hand before risky changes:

```sh
gcloud compute disks snapshot <name>-data --zone <zone> --snapshot-names <name>-before-update
```

**Restore a lost or broken disk.**

```sh
gcloud compute instances stop <name>-vm --zone <zone>
gcloud compute instances detach-disk <name>-vm --disk <name>-data --zone <zone>
gcloud compute disks create <name>-data-restored --zone <zone> --source-snapshot <snapshot>
```

Then import the restored disk into Terraform in place of the old one
(`terraform state rm module.workbench.google_compute_disk.data` and
`terraform import module.workbench.google_compute_disk.data projects/<p>/zones/<z>/disks/<name>-data-restored`,
with `name` adjusted to match) and apply. The VM attaches it and starts.

**Restore a lost project.** Create a new project, restore the disk from a snapshot copied to
another project or from a cross-region snapshot, apply the module into the new project, and import
the disk as above. Without any snapshot, apply fresh and restore the box's config from its remote:
config, skills and scripts come back; sign-ins, secrets and history do not.

## 7. Checklist

- [ ] The project holds nothing but this box.
- [ ] `allowed_emails` lists only people you would give a shell on the box.
- [ ] Both domains resolve to `lb_ip` and the certificate is active.
- [ ] Opening the app domain in a private window asks for a Google sign-in.
- [ ] `curl https://<hooks_domain>/api/me` returns 404, and `curl https://<app_domain>/api/me` without a sign-in is refused.
- [ ] The Setup page shows the data disk as mounted.
- [ ] Claude Code is signed in with a key or seat permitted for shared use.
- [ ] Settings › People has at least one admin, and watch-only people are viewers.
- [ ] Every webhook source has a generated secret and a test delivery was accepted.
- [ ] The box's config repo has a remote of its own and the last push succeeded.
- [ ] A snapshot exists for today.

Last walked through: not yet verified on a fresh host (product 0.3.0). The module passes
`terraform validate` with Google provider 7.46.1; it has not been applied.
