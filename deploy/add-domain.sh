#!/usr/bin/env bash
# EDGEmods: serve the website at a domain through this server's nginx, with HTTPS (docs/deploy.md, step 4). MIT,
# written for EDGEmods.
#
#   sudo ./deploy/add-domain.sh                    edgemods.ai and www.edgemods.ai
#   sudo ./deploy/add-domain.sh --name example.org another name (its www too)
#   sudo ./deploy/add-domain.sh --dry-run          say what it would do, change nothing
#
# DNS first: the name and its www must already point at this server, or Let's Encrypt's check fails, and repeated
# failures are rate-limited. The script checks that before asking for a certificate.
#
# One file only: /etc/nginx/conf.d/<name>.conf, from deploy/nginx/edgemods.ai.conf. Nothing else in nginx is
# edited. nginx -t runs before every reload; a file this script wrote is taken away again if the test fails. A
# block for the name that the script did not write stops it (it will not put HTTPS on someone else's site).
# Re-running after it worked only checks it again.
set -euo pipefail

NAME=edgemods.ai
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --name) NAME="${2:-}"; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF_DIR=/etc/nginx/conf.d
CONF="$CONF_DIR/$NAME.conf"
TEMPLATE="$REPO/deploy/nginx/edgemods.ai.conf"
SNIPPET=/etc/nginx/edgemods/edgemods-downloads.conf
MARKER='Written by deploy/add-domain.sh (EDGEmods).'

say()  { printf '  ok  %s\n' "$*"; }
note() { printf '  ..  %s\n' "$*"; }
warn() { printf '  !!  %s\n' "$*" >&2; }
die()  { printf '\n  STOPPED: %s\n\n' "$*" >&2; exit 1; }

echo "EDGEmods domain: $NAME$([ "$DRY" -eq 1 ] && printf ' (dry run: nothing changes)')"

# ---- preflight ---------------------------------------------------------------------------------------------------
# Lower-case DNS labels only: the name goes into an nginx file and to certbot.
[[ "$NAME" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || die "$NAME is not a domain name (lower case, no www.)"
[[ "$NAME" == www.* ]] && die "give the name without www.; the www name is added and sent to it"
if [ "$(id -u)" -ne 0 ]; then
  [ "$DRY" -eq 1 ] && warn "not root: fine for a dry run, but the real run needs sudo" || die "run it with sudo"
fi
command -v nginx >/dev/null || die "nginx is not installed"
command -v certbot >/dev/null || die "certbot is not installed (with its nginx plugin)"
command -v curl >/dev/null || die "curl is not installed"
[ -d "$CONF_DIR" ] || die "$CONF_DIR does not exist; this script expects nginx's conf.d layout"
[ -f "$SNIPPET" ] || die "$SNIPPET is missing: run sudo ./deploy/setup-edgemods.sh first"

PORT="$(sed -n 's/^EDGEMODS_PORT=//p' /etc/edgemods.env 2>/dev/null | tail -1 | tr -d '\r')"
[ -n "$PORT" ] || PORT="$(sed -n 's/.*EDGEMODS_PORT ?? \([0-9]\{2,5\}\).*/\1/p' "$REPO/packages/server/src/config.ts" | head -1)"
[[ "$PORT" =~ ^[0-9]{2,5}$ ]] || die "could not read EDGEmods' port"
curl -fsS --max-time 3 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 \
  || die "EDGEmods does not answer on 127.0.0.1:$PORT/healthz: run sudo ./deploy/setup-edgemods.sh first"
say "EDGEmods answers on 127.0.0.1:$PORT"

# ---- DNS ---------------------------------------------------------------------------------------------------------
HERE="$(curl -fsS --max-time 4 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)"
[ -n "$HERE" ] || die "could not learn this server's public address (checkip.amazonaws.com)"
for n in "$NAME" "www.$NAME"; do
  ips="$(getent ahostsv4 "$n" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
  [ -n "$ips" ] || die "$n does not resolve yet. Point an A record for it at $HERE, wait for it to show, then re-run"
  [[ " $ips" == *" $HERE "* ]] || die "$n points at $ips, not at this server ($HERE). Fix the A record, then re-run"
done
say "$NAME and www.$NAME point at this server ($HERE)"

# ---- the site block ----------------------------------------------------------------------------------------------
existing="$(grep -rlE "server_name([^;]*[[:space:]])?(www\.)?${NAME//./\\.}([[:space:]][^;]*)?;" "$CONF_DIR" 2>/dev/null | grep -v "^$CONF\$" || true)"
[ -z "$existing" ] || die "another file already serves $NAME: $existing. Move it aside or fold it into $CONF by hand"
if [ -f "$CONF" ]; then
  grep -qF "$MARKER" "$CONF" || die "$CONF exists and was not written by this script; it is left alone"
  say "$CONF is there (written by this script earlier)"
else
  if [ "$DRY" -eq 1 ]; then
    note "would write $CONF from deploy/nginx/edgemods.ai.conf (port $PORT), test nginx and reload it"
  else
    sed -e "s/__NAME__/$NAME/g" -e "s/__PORT__/$PORT/g" "$TEMPLATE" > "$CONF"
    if ! nginx -t >/dev/null 2>&1; then
      err="$(nginx -t 2>&1 | tail -3)"
      rm -f "$CONF"
      die "nginx -t failed with the new block, so it was taken away again: $err"
    fi
    systemctl reload nginx
    say "$CONF written, nginx reloaded"
  fi
fi

# ---- the certificate ---------------------------------------------------------------------------------------------
LIVE="/etc/letsencrypt/live/$NAME"
if [ -d "$LIVE" ] && grep -q 'ssl_certificate' "$CONF" 2>/dev/null; then
  say "the certificate for $NAME is there, and the block uses it"
elif [ "$DRY" -eq 1 ]; then
  note "would run certbot --nginx -d $NAME -d www.$NAME --redirect"
else
  # Interactive on purpose: certbot asks for an email and the terms the first time on a machine.
  certbot --nginx -d "$NAME" -d "www.$NAME" --redirect || die "certbot failed; its output above says why ($CONF is kept, serving HTTP)"
  nginx -t >/dev/null 2>&1 || die "nginx -t fails after certbot's edit: $(nginx -t 2>&1 | tail -3)"
  systemctl reload nginx
  say "certificate for $NAME and www.$NAME"
fi
systemctl list-timers 2>/dev/null | grep -q certbot || grep -rqs 'certbot' /etc/cron.d /etc/crontab 2>/dev/null \
  || warn "no certbot renewal is scheduled (a timer or cron): the certificate ends in 90 days unless one is"

# ---- check from outside ------------------------------------------------------------------------------------------
if [ "$DRY" -eq 0 ]; then
  body="$(curl -fsS --max-time 10 "https://$NAME/healthz" 2>/dev/null || true)"
  case "$body" in *'"ok":true'*) say "https://$NAME/healthz answers: $body" ;; *) die "https://$NAME/healthz does not answer as it should (got: ${body:-nothing})" ;; esac
  loc="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 "https://www.$NAME/" 2>/dev/null || true)"
  [[ "$loc" == "301 https://$NAME/"* ]] && say "www.$NAME goes to $NAME" || warn "https://www.$NAME/ answered $loc, not a 301 to https://$NAME/"
fi
echo
echo "Done$([ "$DRY" -eq 1 ] && printf ' (dry run)'): https://$NAME"
