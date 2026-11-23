#!/usr/bin/env bash
# EDGEmods: back up site.db to S3 with Litestream (docs/deploy.md, step 5). MIT, written for EDGEmods.
#
#   sudo BUCKET=<bucket> ./deploy/setup-litestream.sh            set it up, or check it again
#   sudo BUCKET=<bucket> ./deploy/setup-litestream.sh --dry-run  say what it would do, change nothing
#
# The bucket and its access are the owner's to make first (docs/deploy.md, step 5): versioned, private, encrypted,
# reached through the server's instance role. This script does not make them.
#
# Only site.db: index.db is rebuilt from the registry and needs no backup. Its own unit (litestream-edgemods) and
# config (/etc/litestream-edgemods.yml); TheLostRealms' litestream.service and /etc/litestream.yml are not touched.
# Litestream itself must already be installed at the pinned version, as TheLostRealms installs it.
#
# Nothing is enabled until one sync has reached the bucket, and afterwards it looks in the bucket for the backup:
# a running unit is not proof of a backup.
set -euo pipefail

VERSION=0.5.17
BUCKET="${BUCKET:-}"
DRY=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a (try --help)" >&2; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB=/var/lib/edgemods/site.db
CONFIG=/etc/litestream-edgemods.yml
UNIT=/etc/systemd/system/litestream-edgemods.service
LS=/usr/bin/litestream
SVC_USER=edgemods
PREFIX=site.db

say()  { printf '  ok  %s\n' "$*"; }
note() { printf '  ..  %s\n' "$*"; }
warn() { printf '  !!  %s\n' "$*" >&2; }
die()  { printf '\n  STOPPED: %s\n\n' "$*" >&2; exit 1; }

echo "EDGEmods backup$([ "$DRY" -eq 1 ] && printf ' (dry run: nothing changes)')"

# ---- preflight ---------------------------------------------------------------------------------------------------
[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || die "give the bucket's name: sudo BUCKET=<bucket> $0"
if [ "$(id -u)" -ne 0 ]; then
  [ "$DRY" -eq 1 ] && warn "not root: fine for a dry run, but the real run needs sudo" || die "run it with sudo"
fi
[ -x "$LS" ] || die "Litestream is not installed at $LS. Install $VERSION from its release rpm (litestream-$VERSION-linux-x86_64.rpm), checking its SHA-256, as TheLostRealms' setup does"
have="$("$LS" version 2>/dev/null | tr -d 'v[:space:]')"
[ "$have" = "$VERSION" ] || die "Litestream here is ${have:-unknown}; EDGEmods is set up for $VERSION, the same as TheLostRealms. Change the pin in this script on purpose, having read the release notes"
id "$SVC_USER" >/dev/null 2>&1 || die "there is no $SVC_USER user: run sudo ./deploy/setup-edgemods.sh first"
[ -f "$DB" ] || die "$DB does not exist yet: the service makes it at its first start (sudo ./deploy/setup-edgemods.sh)"
# Litestream streams the write-ahead log, so the database must be in WAL mode: bytes 18 and 19 of the header are 2.
mode="$(od -An -tu1 -j18 -N2 "$DB" | tr -s ' ' | sed 's/^ //')"
[ "$mode" = "2 2" ] || die "$DB is not in WAL mode (header bytes 18-19: $mode); the service sets it when it opens the file"
runuser -u "$SVC_USER" -- test -r "$DB" || die "$SVC_USER cannot read $DB"
runuser -u "$SVC_USER" -- test -w "$(dirname "$DB")" || die "$SVC_USER cannot write $(dirname "$DB"), where Litestream keeps its folder"
say "Litestream $have, $DB in WAL mode"

# ---- config and unit ---------------------------------------------------------------------------------------------
want="$(cat <<YML
# Written by deploy/setup-litestream.sh (EDGEmods); re-run it rather than editing this file.
# The credentials come from the instance role, through the metadata service.
dbs:
  - path: $DB
    replica:
      url: s3://$BUCKET/$PREFIX
YML
)"
if [ -f "$CONFIG" ] && [ "$(cat "$CONFIG")" = "$want" ]; then
  say "$CONFIG is current"
elif [ "$DRY" -eq 1 ]; then
  note "would write $CONFIG (s3://$BUCKET/$PREFIX)"
else
  printf '%s\n' "$want" > "$CONFIG"
  chmod 0644 "$CONFIG"
  say "$CONFIG written"
fi
if cmp -s "$REPO/deploy/systemd/litestream-edgemods.service" "$UNIT"; then
  say "$UNIT is current"
elif [ "$DRY" -eq 1 ]; then
  note "would install $UNIT"
else
  install -m 0644 "$REPO/deploy/systemd/litestream-edgemods.service" "$UNIT"
  systemctl daemon-reload
  say "$UNIT installed"
fi

if [ "$DRY" -eq 1 ]; then
  note "would stop litestream-edgemods, sync once as $SVC_USER, then enable it and look in the bucket"
  exit 0
fi

# ---- prove one sync, then enable ---------------------------------------------------------------------------------
systemctl stop litestream-edgemods 2>/dev/null || true
note "one sync to s3://$BUCKET/$PREFIX, before anything is enabled"
runuser -u "$SVC_USER" -- "$LS" replicate -config "$CONFIG" -once || die "the sync failed; the error above comes from AWS. Usually:
     no credentials        the instance has no role, or its metadata service is off
     AccessDenied          the role's policy does not name this bucket (docs/deploy.md, step 5)
     bucket region         the bucket does not exist in this account
   Nothing was enabled."
systemctl enable --now litestream-edgemods >/dev/null 2>&1 || die "could not enable litestream-edgemods"
say "litestream-edgemods enabled and running"

# ---- look in the bucket ------------------------------------------------------------------------------------------
# `litestream ltx` with a replica URL, and no -config (it refuses both). It exits 0 on an empty replica, so count
# the rows after the header.
out="$("$LS" ltx "s3://$BUCKET/$PREFIX" 2>&1 || true)"
if [ -n "$(printf '%s\n' "$out" | sed -n '2,$p')" ]; then
  say "the bucket holds site.db's backup:"
  printf '%s\n' "$out" | sed 's/^/      /'
else
  printf '%s\n' "$out" | sed 's/^/      /'
  die "no backup files in s3://$BUCKET/$PREFIX yet; journalctl -u litestream-edgemods -n 50 says why"
fi

cat <<NEXT

Done. Try a restore once now, while nothing is wrong (Litestream will not restore over a file that exists):

    sudo -u $SVC_USER $LS restore -o /tmp/site-restore-check.db s3://$BUCKET/$PREFIX
    ls -l /tmp/site-restore-check.db && sudo rm /tmp/site-restore-check.db

NEXT
