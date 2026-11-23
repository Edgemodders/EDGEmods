#!/usr/bin/env bash
# EDGEmods: install or update the website on this server (docs/deploy.md). MIT, written for EDGEmods.
#
#   sudo ./deploy/setup-edgemods.sh            install, or update to this checkout's commit, and restart
#   sudo ./deploy/setup-edgemods.sh --dry-run  say what it would do, change nothing
#
# Re-runnable: a second run with the same commit changes nothing but restarts the service and checks it again; a run
# after `git pull` deploys the new commit. It stops at the first thing that fails and names it. If the new build does
# not answer, the previous one is put back.
#
# What it touches, and nothing else:
#   the user edgemods                       a system account, no shell, no home
#   /opt/edgemods/releases/<commit>         the built app, root-owned, read-only to the service
#   /opt/edgemods/current                   a link to the release that runs
#   /etc/edgemods.env                       the settings, from deploy/edgemods.env.example the first time only
#   /var/lib/edgemods                       site.db, index.db, the image cache (the service's own)
#   /etc/systemd/system/edgemods.service    from deploy/systemd/edgemods.service
#   /etc/nginx/edgemods/                    the downloads snippet, which the site block includes (add-domain.sh)
# It never edits another service's files, nginx.conf or any other site's block.
set -euo pipefail

DRY=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a (try --help)" >&2; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=/opt/edgemods
ENV_FILE=/etc/edgemods.env
DATA=/var/lib/edgemods
UNIT=/etc/systemd/system/edgemods.service
SNIPPETS=/etc/nginx/edgemods
NODE=/usr/bin/node
SVC_USER=edgemods
KEEP_RELEASES=3
WORKSPACES=(packages/format packages/checks packages/indexer packages/server)

say()  { printf '  ok  %s\n' "$*"; }
note() { printf '  ..  %s\n' "$*"; }
warn() { printf '  !!  %s\n' "$*" >&2; }
die()  { printf '\n  STOPPED: %s\n\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" -eq 1 ]; then printf '  dry %s\n' "$*"; else "$@"; fi; }
MANUAL=()

echo "EDGEmods setup$([ "$DRY" -eq 1 ] && printf ' (dry run: nothing changes)')"

# ---- preflight ---------------------------------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  [ "$DRY" -eq 1 ] && warn "not root: fine for a dry run, but the real run needs sudo" || die "run it with sudo"
fi
command -v systemctl >/dev/null || die "systemd is needed (systemctl is missing)"
for c in git tar curl runuser install cmp; do command -v "$c" >/dev/null || die "$c is not installed"; done
[ -x "$NODE" ] || die "the unit runs $NODE, and there is none. Install Node 22.13 or newer there (node:sqlite)"
command -v npm >/dev/null || die "npm is not installed (it comes with Node)"
NODE_VER="$("$NODE" -p process.versions.node)"
"$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || die "EDGEmods needs Node 22.13 or newer for node:sqlite; $NODE is $NODE_VER"
[ "$(command -v node)" = "$NODE" ] || warn "node on PATH is $(command -v node), the unit runs $NODE ($NODE_VER)"

GIT=(git -c safe.directory="$REPO" -C "$REPO")
"${GIT[@]}" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$REPO is not a git checkout: clone EDGEmods and run the script from it"
for f in package.json package-lock.json packages/server/package.json registry deploy/systemd/edgemods.service deploy/edgemods.env.example; do
  [ -e "$REPO/$f" ] || die "the checkout has no $f: it is incomplete or not EDGEmods"
done
COMMIT="$("${GIT[@]}" rev-parse --short=12 HEAD)"
[ -z "$("${GIT[@]}" status --porcelain --untracked-files=no)" ] || warn "the checkout has uncommitted changes; they are not deployed (the script deploys commit $COMMIT)"

# The port: the env file's, else the code's default (packages/server/src/config.ts).
env_value() { [ -r "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d '\r' || true; }
PORT="$(env_value EDGEMODS_PORT)"
[ -n "$PORT" ] || PORT="$(sed -n 's/.*EDGEMODS_PORT ?? \([0-9]\{2,5\}\).*/\1/p' "$REPO/packages/server/src/config.ts" | head -1)"
[[ "$PORT" =~ ^[0-9]{2,5}$ ]] || die "could not read the port from $ENV_FILE or packages/server/src/config.ts"
if command -v ss >/dev/null; then
  holder="$(ss -Hltnp "sport = :$PORT" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -1)"
  if [ -n "$holder" ] && ! systemctl is-active --quiet edgemods; then die "port $PORT is taken by $holder; EDGEmods needs it (EDGEMODS_PORT in $ENV_FILE)"; fi
fi
say "commit $COMMIT, node $NODE_VER, port $PORT"

# ---- the service account -----------------------------------------------------------------------------------------
if id "$SVC_USER" >/dev/null 2>&1; then
  say "user $SVC_USER exists"
else
  run useradd --system --home-dir "$DATA" --no-create-home --shell "$(command -v nologin || echo /sbin/nologin)" "$SVC_USER"
  say "user $SVC_USER made"
fi
run install -d -m 0750 -o "$SVC_USER" -g "$SVC_USER" "$DATA"

# ---- build the release -------------------------------------------------------------------------------------------
# Built by the person running sudo (not root, not the service), in a temporary folder, from `git archive` of the
# commit, so local edits and untracked files never ship. npm runs with --ignore-scripts: the server's dependencies
# need no install scripts. Then copied into /opt as root, so the service cannot change its own code.
REL="$APP/releases/$COMMIT"
if [ -f "$REL/.edgemods-release" ]; then
  say "release $COMMIT is built already"
elif [ "$DRY" -eq 1 ]; then
  note "would build $COMMIT into $REL (npm ci and tsc for ${WORKSPACES[*]})"
else
  BUILDER="${SUDO_USER:-root}"
  [ "$BUILDER" = root ] && warn "building as root: run the script with sudo from your own account to build as that account"
  BUILDER_HOME="$(getent passwd "$BUILDER" | cut -d: -f6)"
  STAGE="$(mktemp -d /tmp/edgemods-build.XXXXXX)"
  trap 'rm -rf "$STAGE"' EXIT
  chown "$BUILDER" "$STAGE"
  "${GIT[@]}" archive "$COMMIT" | runuser -u "$BUILDER" -- tar -x -C "$STAGE"
  ws=(); for w in "${WORKSPACES[@]}"; do ws+=(-w "$w"); done
  note "npm ci (${WORKSPACES[*]})"
  runuser -u "$BUILDER" -- env HOME="$BUILDER_HOME" bash -c 'cd "$1" && shift && npm ci --ignore-scripts --no-audit --no-fund "$@" >/dev/null' _ "$STAGE" "${ws[@]}" \
    || die "npm ci failed (run it by hand in $STAGE to see why)"
  for w in "${WORKSPACES[@]}"; do
    runuser -u "$BUILDER" -- env HOME="$BUILDER_HOME" bash -c 'cd "$1" && npm run build -w "$2" >/dev/null' _ "$STAGE" "$w" || die "the build of $w failed"
  done
  [ -f "$STAGE/packages/server/dist/index.js" ] || die "the build left no packages/server/dist/index.js"
  install -d -m 0755 "$APP" "$APP/releases"
  rm -rf "$REL.partial"
  cp -a "$STAGE" "$REL.partial"
  chown -R root:root "$REL.partial"
  chmod -R u=rwX,go=rX "$REL.partial"
  echo "$COMMIT $(date -u +%FT%TZ)" > "$REL.partial/.edgemods-release"
  mv -T "$REL.partial" "$REL"
  say "built release $COMMIT"
fi

# ---- settings ----------------------------------------------------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
  say "$ENV_FILE is there (never overwritten)"
  missing="$(comm -23 <(sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' "$REPO/deploy/edgemods.env.example" | sort -u) <(sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' "$ENV_FILE" | sort -u) | tr '\n' ' ')"
  [ -z "$missing" ] || MANUAL+=("New settings this version knows, missing from $ENV_FILE (see deploy/edgemods.env.example): $missing")
  run chown root:"$SVC_USER" "$ENV_FILE"
  run chmod 0640 "$ENV_FILE"
else
  run install -m 0640 -o root -g "$SVC_USER" "$REPO/deploy/edgemods.env.example" "$ENV_FILE"
  say "$ENV_FILE made from the example"
  MANUAL+=("Fill the secrets in $ENV_FILE (sudo nano $ENV_FILE; docs/deploy.md, step 3), then: sudo systemctl restart edgemods")
fi

# ---- the unit ----------------------------------------------------------------------------------------------------
if cmp -s "$REPO/deploy/systemd/edgemods.service" "$UNIT"; then
  say "$UNIT is current"
else
  run install -m 0644 "$REPO/deploy/systemd/edgemods.service" "$UNIT"
  run systemctl daemon-reload
  say "$UNIT installed"
fi
run systemctl enable edgemods >/dev/null 2>&1 || true

# ---- the nginx snippet -------------------------------------------------------------------------------------------
# Only EDGEmods' own folder. The site block that includes it is written by deploy/add-domain.sh.
SNIPPET="$SNIPPETS/edgemods-downloads.conf"
if cmp -s "$REPO/deploy/nginx/edgemods-downloads.conf" "$SNIPPET"; then
  say "$SNIPPET is current"
else
  run install -d -m 0755 "$SNIPPETS"
  run install -m 0644 "$REPO/deploy/nginx/edgemods-downloads.conf" "$SNIPPET"
  say "$SNIPPET installed"
  if command -v nginx >/dev/null && grep -rqs "$SNIPPET" /etc/nginx/conf.d; then
    if [ "$DRY" -eq 1 ]; then note "would test and reload nginx"
    else nginx -t >/dev/null 2>&1 || die "nginx -t fails with the new snippet: $(nginx -t 2>&1 | tail -3)"; systemctl reload nginx; say "nginx reloaded"; fi
  fi
fi

# ---- the first index ---------------------------------------------------------------------------------------------
# The service will not start without one. Later ones come from the index rebuild (docs/deploy.md, step 6).
if [ -f "$DATA/index.db" ]; then
  say "$DATA/index.db is there"
elif [ "$DRY" -eq 1 ]; then
  note "would build the first index.db from the registry"
else
  note "building the first index.db from the registry (reads the mods' repositories on GitHub)"
  runuser -u "$SVC_USER" -- env GITHUB_TOKEN="$(env_value EDGEMODS_GITHUB_TOKEN)" "$NODE" --disable-warning=ExperimentalWarning \
    "$REL/packages/indexer/bin/edgemods-index.mjs" --registry "$REL/registry" --out "$DATA/index.db" | sed 's/^/      /' \
    || die "the first index could not be built (the lines above say why)"
  say "first index.db built"
fi

# ---- switch and restart ------------------------------------------------------------------------------------------
PREV="$(readlink "$APP/current" 2>/dev/null || true)"
switch_to() { ln -sfn "$1" "$APP/current.new" && mv -T "$APP/current.new" "$APP/current"; }
healthy() {
  local i body
  for i in $(seq 1 20); do
    body="$(curl -fsS --max-time 2 "http://127.0.0.1:$PORT/healthz" 2>/dev/null || true)"
    case "$body" in *'"ok":true'*) echo "$body"; return 0 ;; esac
    sleep 1
  done
  return 1
}
if [ "$DRY" -eq 1 ]; then
  note "would point $APP/current at $REL (now: ${PREV:-nothing}), restart edgemods and check /healthz on port $PORT"
else
  switch_to "$REL"
  systemctl restart edgemods
  if body="$(healthy)"; then
    say "edgemods answers on 127.0.0.1:$PORT: $body"
  else
    journalctl -u edgemods -n 25 --no-pager >&2 || true
    if [ -n "$PREV" ] && [ "$PREV" != "$REL" ] && [ -d "$PREV" ]; then
      switch_to "$PREV"
      systemctl restart edgemods
      die "release $COMMIT did not answer on /healthz within 20 s (its log is above); put back $(basename "$PREV")"
    fi
    die "edgemods did not answer on /healthz within 20 s; its log is above (journalctl -u edgemods -n 50)"
  fi
fi

# ---- tidy --------------------------------------------------------------------------------------------------------
if [ -d "$APP/releases" ]; then
  mapfile -t old < <(ls -1dt "$APP/releases"/*/ 2>/dev/null | sed 's#/$##' | tail -n +$((KEEP_RELEASES + 1)))
  for r in "${old[@]}"; do
    [ "$r" = "$REL" ] || [ "$r" = "$PREV" ] || { run rm -rf "$r"; note "removed old release $(basename "$r")"; }
  done
fi

# ---- what is left ------------------------------------------------------------------------------------------------
grep -rqs "$SNIPPET" /etc/nginx/conf.d 2>/dev/null || MANUAL+=("No nginx site for EDGEmods yet: sudo ./deploy/add-domain.sh (docs/deploy.md, step 4)")
systemctl is-enabled --quiet litestream-edgemods 2>/dev/null || MANUAL+=("site.db is not backed up yet: sudo BUCKET=<bucket> ./deploy/setup-litestream.sh (docs/deploy.md, step 5)")
echo
if [ "${#MANUAL[@]}" -eq 0 ]; then
  echo "Done: EDGEmods $COMMIT runs."
else
  echo "Done$([ "$DRY" -eq 1 ] && printf ' (dry run)'). Still to do by hand:"
  for m in "${MANUAL[@]}"; do printf '  - %s\n' "$m"; done
fi
