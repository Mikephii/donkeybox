---
title: "Updating a box"
description: "Swap the image, keep the volume: wb update, the steps by hand, and the control plane contract."
---

An update swaps the workbench image and keeps the `/data` volume. This guide covers `wb update`, the
same steps by hand, and the contract a hosted control plane follows to update many boxes.

## What an update touches

Only the workbench: the image (`/opt/workbench`), its database and internal folder
(`/data/internal`), and the format of the box's config repo (`/data/workspace`).

What people install inside the box is theirs to keep current, Claude Code included. Programs in
`/data/tools`, packages in the box user's home, MCP servers and anything cloned into the box stay
exactly as they were. The workbench never pins, updates or checks their versions.

## The release manifest

Every release has one. It sits beside the tarball as `dist/workbench-<version>.release.json`, inside
the image at `/opt/workbench/release.json`, and a running box reports its own at `GET /v1/info`.

```json
{
  "version": "0.4.0",
  "schemaVersion": 4,
  "compatFloor": 1,
  "minUpgradeFrom": "0.3.0",
  "capabilities": ["drain", "backup", "update-record", "self-restore", "compat-floor"]
}
```

| Field | Meaning |
|---|---|
| `schemaVersion` | The database schema this release writes. |
| `compatFloor` | The oldest schema version that can still read data this release has migrated. |
| `minUpgradeFrom` | The oldest release that may update straight to this one. Older boxes go through an intermediate release first. |
| `capabilities` | What the release can do for an update. A box on a release without one of them is handled by what it can do, never by guessing from its version. |

`GET /v1/info` adds `data`: the schema and floor of the database the box is running on, and whether
that data came from a newer build.

## The rules that keep a rollback cheap

**Migrations only add.** New tables, new columns with defaults, new indexes. The previous release
keeps working on the new data, because the database records its compat floor beside its schema
version and a build runs on newer data whenever its own schema is at or above that floor. Putting
the old image back is then the whole rollback.

**Removing or renaming takes two releases.** The first release stops using the old column or table.
The next one drops it, with a migration marked breaking that raises the floor to its own version. A
test fails if a migration drops or renames something without the marker, or raises the floor without
saying why.

**Config keeps what it does not know.** When a build saves `config.json`, it keeps every key it does
not understand, at every level. When a build starts on a config it cannot fully read, it runs with
the parts it can read and shows the rest as errors instead of starting empty.

**A build below the floor refuses to start.** It exits with code 3 and says which schema it found
and which it needs. It never guesses at data it cannot read.

## With `wb update`

`wb update` needs Node 22.18 or newer and the new release's folder (the unpacked tarball, for the
driver scripts and the manifest; nothing to install). Run it where the driver can work: on the
compose host itself, or on your computer for Google Cloud and Fly. Boxes on releases before 0.4.0
can be updated too, with fewer steps (see below).

```sh
export WB_MANAGEMENT_TOKEN=...          # the box's management token
export WB_MANAGEMENT_URL=http://127.0.0.1:8002
node workbench-0.5.0/packages/cli/src/wb.ts update --to 0.5.0 --via compose
```

From the release's own folder, the manifest is found at `release.json`; from a product checkout, at
`dist/workbench-<version>.release.json`.

| Platform | `--via` | Reach the management API | Driver settings |
|---|---|---|---|
| [Compose](self-hosted-proxy.md), [AWS](aws.md) | `compose` | published on the host's `127.0.0.1:8002`; over SSH, `ssh -L 8002:127.0.0.1:8002 host` | `WB_COMPOSE_DIR`: the folder with `docker-compose.yml` and `.env` |
| [Google Cloud](gcp-iap.md) | `gcp` | `gcloud compute start-iap-tunnel <name>-vm 8002 --local-host-port=localhost:8002 --zone <zone>` | `WB_TF_DIR`, `WB_TF_VARS_FILE`, `WB_TF_IMAGE_VAR`, `WB_GCP_DISK`, `WB_GCP_ZONE`, `WB_TF_AUTO_APPROVE` |
| [Fly](fly.md) | `fly` | `fly proxy 8002:8002 -a <app>` | `FLY_APP`, `FLY_CONFIG` |

Options: `--image REF` when the new image is not the old one with a new tag, `--manifest FILE` when
the manifest is not in `dist/` and the driver cannot read it from the image, `--timeout SECONDS`
(600) for the new version to report healthy, `--drain-timeout SECONDS` (900) for live runs to
finish, and `--dry-run` to check everything and change nothing. `--driver SCRIPT` uses your own
driver instead of one of the three.

Each driver pins the new image in the deployment's own file (`.env`, the tfvars file, `fly.toml`)
before applying it, so that file always says what runs. The previous file is kept beside it as
`*.before-update`.

### What it does

1. **Reads** `/v1/info` and `/v1/update`. If the box already runs the target with an update in
   progress, it only checks health and finishes.
2. **Checks** the target's manifest. It stops before changing anything when the box runs a build
   that is not a release, when the box's release is older than the target's `minUpgradeFrom`, when
   the box's data needs a newer schema than the target has, or when the target changes the database
   in a way the running build could not be put back on and that build cannot restore itself.
3. **Drains.** New runs wait in the queue and everyone sees a banner. It waits for live runs to
   finish, or for the drain timeout; runs still going are then interrupted by the restart and can be
   resumed from their pages.
4. **Backs up** the database, the config repo and `secrets.json` into
   `/data/internal/backups/<time>-v<version>`.
5. **Records the update** on the box (`/data/internal/update.json`), naming the backup.
6. **Snapshots** the volume where the platform has snapshots (Google Cloud, Fly).
7. **Swaps** the image and waits for `/v1/health` to report the new version.
8. **Finishes**: the record moves into its backup folder.

If the new version is not healthy in time, it **puts the old image back**. When the old build cannot
read what the new one migrated (the target's floor is above the old schema), the old build restores
its own backup as it starts: the database always, and `config.json` and `secrets.json` only if it
cannot read them. The database it replaced is kept in the backup folder under `replaced-<time>`.

Every step is logged to the terminal and to `~/.workbench/updates/<date>-<version>.log`. Rerunning
the same command after a failure picks up where the box is.

| Exit code | Meaning |
|---|---|
| 0 | Updated, or already on that version |
| 1 | Stopped before changing anything (the reason is printed) |
| 2 | The new version failed and the old one is running again |
| 3 | Neither version came up. Restore the volume snapshot taken in step 6. |

### From a box on 0.3.0

0.3.0 cannot drain, back up or record an update. `wb update` still swaps the image and puts it back
on failure, and it refuses any target that changes the database schema. 0.4.0 keeps schema 4, so
0.3.0 to 0.4.0 is always safe; go through 0.4.0 before anything that needs more.

## By hand

On a laptop or any box without a driver:

```sh
wb admin drain          # in a terminal on the box; queued runs wait, live runs carry on
wb admin backup         # prints the backup's folder
# stop the box, switch to the new release (image, or unpack the tarball and pnpm run setup), start it
```

`wb admin undrain` ends a drain without updating. A restart always ends it. To roll back, start the
old release again. If it refuses with exit code 3, copy `workbench.db` from the backup folder over
`data/workbench.db` (with the box stopped) and start it again.

## The contract for a control plane

A hosted control plane runs the same steps through the management API (port 8002, bearer
`WB_MANAGEMENT_TOKEN`, private network only) and its own way of swapping images.

| Step | Call | Proceed when |
|---|---|---|
| Read | `GET /v1/info`, `GET /v1/update` | `version` and `capabilities` known; no other update in progress |
| Check | (the target's manifest) | the checks in step 2 above pass |
| Drain | `POST /v1/drain {"timeoutSeconds": 900, "by": "..."}`, then poll `GET /v1/drain` | `ready` is true (`reason` is `idle` or `timeout`) |
| Back up | `POST /v1/backup` | 201, returns `path` |
| Record | `POST /v1/update/begin {"to": {"version", "schemaVersion", "compatFloor"}, "backup": path, "by": "..."}` | 200 (a rerun with the same target returns the same record; another target while one is in progress is 409) |
| Swap | your platform | issued |
| Verify | poll `GET /v1/health` | `ok` and `version` equals the target, within the timeout |
| Finish | `POST /v1/update/finish {"note": "..."}` | always, after success or after a rollback |
| Abort before the swap | `POST /v1/undrain` | |

On a failed verify, swap the old image back and poll `/v1/health` for the old version.
`GET /v1/update` then shows `restored` (the old build put its backup back) or `rolled-back` (none
was needed).

Other calls a control plane uses, outside updates:

| Call | What it is for |
|---|---|
| `GET /v1/health` | `lastActivity` and `liveRuns`, to decide when an idle box may stop |
| `PUT /v1/access {"users": [{"email", "role"}], "domains": []}` | the People list, replaced as a whole |
| `PATCH /v1/settings {...}` | any settings, merged; the box id never changes |
| `GET /v1/schedules` | schedule sources (`source`, `title`, `schedule`, `type`), the scheduler `mode` and the name of its secret, for a host that runs them: it calls `POST /hooks/_schedule/<source>` on the hooks door at each time, with the header `X-Workbench-Schedule-Secret` and optionally `X-Scheduled-For` (0.5.0 and later, capability `schedules`) |
| `GET /v1/usage`, `POST /v1/support`, `POST /v1/door-secret/rotate` | usage, support access, the proxy door's secret |

Roll out in waves. Update your own boxes first, then a small share of customer boxes, then the
rest, and stop the rollout on the first rollback. Keep each box's previous image available in the
registry until its update is finished.

## Checklist

- [ ] The box's management token is set (24 characters or more) and port 8002 is reachable only by
      you: loopback, an IAP tunnel or Fly's private network.
- [ ] `wb update --to <version> --via <platform> --dry-run` prints the checks and changes nothing.
- [ ] The platform keeps volume snapshots (Google Cloud, Fly, AWS) or you back up the volume yourself.
- [ ] After an update, `GET /v1/info` reports the new version and `data.newerThanBuild` is false.
- [ ] Walked on a fresh host: compose locally on Docker Desktop (0.3.0 to 0.4.0, and a failing
      release rolled back with its backup restored). Google Cloud and Fly: not yet verified on a
      fresh host.
