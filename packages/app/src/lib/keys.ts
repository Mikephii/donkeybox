import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

/**
 * One SSH key per box, generated on first use, used for the workspace remote and every repo with
 * deploy-key auth. The private half never leaves the data directory; the public half is shown in the
 * UI to add as a deploy key.
 */
export class DeployKey {
  dir: string;
  comment: string;
  constructor(dir: string, comment = "workbench") {
    this.dir = dir;
    this.comment = comment;
  }
  get privatePath() {
    return join(this.dir, "id_ed25519");
  }
  get knownHosts() {
    return join(this.dir, "known_hosts");
  }
  exists() {
    return existsSync(this.privatePath);
  }
  /** Creates the key if it does not exist yet; returns the public key line. */
  ensure(): string {
    if (!this.exists()) {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", this.comment, "-f", this.privatePath, "-q"]);
      chmodSync(this.privatePath, 0o600);
    }
    return readFileSync(`${this.privatePath}.pub`, "utf8").trim();
  }
  publicKey(): string | null {
    return this.exists() ? readFileSync(`${this.privatePath}.pub`, "utf8").trim() : null;
  }
  /** GIT_SSH_COMMAND for git: this key only, and hosts remembered on first contact. */
  sshCommand(): string {
    return `ssh -i ${this.privatePath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${this.knownHosts}`;
  }
}
