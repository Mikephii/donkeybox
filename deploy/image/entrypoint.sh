#!/usr/bin/env bash
# Prepares the /data volume and starts the supervisor as the workbench user.
# Layout: /data/home (the user's home: Claude Code sign-in, MCP tokens, Zellij data), /data/workspace
# (the team's git repo), /data/internal (the workbench's own: database, runs, keys, secrets, logs), /data/tools
# (programs installed with `wb tools install` or `npm -g`).
set -euo pipefail
if [ "$(id -u)" = 0 ]; then
  # A fresh volume from a host (Fly, a VM disk) is often owned by root.
  if [ "$(stat -c %u /data)" != 1000 ]; then chown workbench:workbench /data; fi
  for d in home internal workspace tools tools/bin; do
    mkdir -p "/data/$d"
    [ "$(stat -c %u "/data/$d")" = 1000 ] || chown -R workbench:workbench "/data/$d"
  done
  exec setpriv --reuid=1000 --regid=1000 --init-groups --inh-caps=-all "$0" "$@"
fi
mkdir -p /data/home /data/internal /data/workspace /data/tools/bin
# A stock Debian home for the box user (the volume's home is made here, not by useradd -m): bash's
# usual prompt and aliases. People's own changes to these files are never overwritten.
for f in .bashrc .profile .bash_logout; do [ -e "/data/home/$f" ] || cp "/etc/skel/$f" "/data/home/$f"; done
# Git commits in terminals need an identity; people can change it with git config --global.
[ -f /data/home/.gitconfig ] || printf '[user]\n\tname = Workbench\n\temail = workbench@workbench.local\n[init]\n\tdefaultBranch = main\n' > /data/home/.gitconfig
cd /opt/workbench
exec node packages/app/src/supervisor.ts "$@"
