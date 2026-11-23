# Deploy

How to put the EDGEmods website on the server at https://edgemods.ai, and how to update it. It is written to be followed step by step, by a person or by the Claude session that looks after the server. Written 2026-11-22 for R3h. **The scripts have not run on the server yet**; the first install is their test, so read what each step prints.

The plan behind it is in [the design](design.html#hosting) ("Hosting" and "Runners"). In short: EDGEmods runs on the same server as TheLostRealms, beside it and never inside it. It has its own user, folder, settings, service, nginx file, backup unit and S3 bucket, and changes nothing of TheLostRealms'.

## What goes where

| Thing | Where | Made by |
|---|---|---|
| The code, one folder per commit | `/opt/edgemods/releases/<commit>`, and `/opt/edgemods/current` pointing at the one that runs. Owned by root; the service can read it but not change it | `setup-edgemods.sh` |
| The settings | `/etc/edgemods.env`, root:edgemods, mode 0640 | `setup-edgemods.sh` copies `deploy/edgemods.env.example` the first time; you fill it |
| The data | `/var/lib/edgemods`: `site.db` (accounts, likes, downloads, moderation, check results), `index.db` (the mods, rebuilt from the registry), `images/` (a cache) | The service |
| The service | `edgemods.service`, user `edgemods`, listening on `127.0.0.1:8800` only | `setup-edgemods.sh`, from `deploy/systemd/` |
| nginx | `/etc/nginx/conf.d/edgemods.ai.conf` (the site) and `/etc/nginx/edgemods/edgemods-downloads.conf` (free downloads at a set speed) | `add-domain.sh` and `setup-edgemods.sh` |
| Backups | `litestream-edgemods.service` and `/etc/litestream-edgemods.yml`, `site.db` only, to EDGEmods' own bucket | `setup-litestream.sh` |
| New indexes | `.github/workflows/index.yml` in this repository, which sends a fresh `index.db` to the site | GitHub Actions |

Ports on the server: EDGEmods uses 8800; TheLostRealms uses 8787 and 8790 to 8794.

## Before you start: the owner's part

These need the owner's accounts or decisions. A session on the server cannot do them.

| What | Details |
|---|---|
| DNS | `A` records for `edgemods.ai` and `www.edgemods.ai`, pointing at the server's public address. Add them first: Let's Encrypt checks them, and limits retries after failures |
| Auth0, production | The production tenant, as in [Auth0 setup](auth0-setup.html#later-the-live-site-r3h). Callbacks: `https://edgemods.ai/auth/callback` for the website, `https://edgemods.ai/auth/vscode` for the VS Code application |
| Privacy and terms pages | Google's consent screen asks for both, and a site with accounts needs them. EDGEmods has neither yet: their text is the owner's |
| The bucket | A new S3 bucket for EDGEmods' backups: versioned, private (block all public access), encrypted. The policy for the server's role is in step 5 |
| Secrets | Two random values: `EDGEMODS_CHECKS_SECRET` and `EDGEMODS_INDEX_SECRET`, each made with `openssl rand -base64 48`. Each goes in two places: `/etc/edgemods.env` on the server, and the EDGEmods repository's Actions secrets. Also `EDGEMODS_SESSION_SECRET`, on the server only |
| A GitHub token for the server | Optional: a fine-grained token with public read only, for `EDGEMODS_GITHUB_TOKEN`. Without one, GitHub allows the server 60 reads an hour |

Secrets go straight into the file on the server, or into GitHub's settings page. Never put them in a chat, an issue, a commit or a log.

## 1. Check the server

```sh
node -v                        # 22.13 or newer (node:sqlite); the service runs /usr/bin/node
command -v nginx certbot git curl
litestream version             # v0.5.17, as TheLostRealms installed it
sudo ss -ltnp | grep 8800      # nothing should answer here yet
```

| If | Do |
|---|---|
| Node is older than 22.13, or not at `/usr/bin/node` | Install a newer Node there first. TheLostRealms' services use `/usr/bin/node` too, so check with the owner before changing it |
| Something already listens on 8800 | Stop. Set `EDGEMODS_PORT` to a free port in `/etc/edgemods.env` after step 3, and tell the owner |

## 2. Get the code

Clone into the home folder of the account you log in with, not into `/opt` (the script builds from the clone and installs into `/opt`):

```sh
cd ~
git clone https://github.com/Edgemodders/EDGEmods.git
cd EDGEmods
```

## 3. Install the service

```sh
sudo ./deploy/setup-edgemods.sh --dry-run    # what it would do
sudo ./deploy/setup-edgemods.sh
```

The first run:

1. checks the server;
2. makes the `edgemods` user;
3. builds the commit you have checked out in a temporary folder, as your account, and copies it to `/opt/edgemods/releases/<commit>`;
4. copies the settings example to `/etc/edgemods.env`;
5. installs the unit and the nginx snippet;
6. builds the first `index.db` from the registry, reading the mods' repositories on GitHub;
7. starts the service and checks `http://127.0.0.1:8800/healthz`.

Each line starting `ok` is a step done. `STOPPED` names what failed, and nothing after it ran.

Then fill the settings. The owner, or whoever the owner gives the values to, types them in on the server:

```sh
sudo nano /etc/edgemods.env
sudo systemctl restart edgemods
journalctl -u edgemods -n 20 --no-pager
```

The log should say `Sign-in: on, with <tenant>; come back to https://edgemods.ai/auth/callback`. Each setting that is missing is named under it. Every setting is described in the file itself.

**Check:** `curl -s http://127.0.0.1:8800/healthz` answers `{"ok":true,...}`. `mods` may be 0: a release shows only once a passing check result has reached the site (step 7).

## 4. The domain and HTTPS

```sh
sudo ./deploy/add-domain.sh --dry-run
sudo ./deploy/add-domain.sh
```

It checks that `edgemods.ai` and `www.edgemods.ai` point at this server. Then it writes `/etc/nginx/conf.d/edgemods.ai.conf` from `deploy/nginx/edgemods.ai.conf` and tests nginx; if the test fails, it removes the file. Then it asks certbot for the certificate (certbot asks for an email the first time on a machine), and checks `https://edgemods.ai/healthz` from outside.

It edits no other nginx file. If another file already serves `edgemods.ai`, it stops and names it.

**Check:** `https://edgemods.ai` shows the home page; `https://www.edgemods.ai` goes to it; signing in works.

**Also check** (the downloads snippet has never run on a server):

- Download a file while signed in. It should arrive at about `EDGEMODS_FREE_SPEED` MB a second.
- `sudo ls /var/lib/nginx/tmp/proxy` (or the distribution's proxy temp folder) stays empty during a download.
- If downloads fail, look at the resolver and CA bundle lines in `/etc/nginx/edgemods/edgemods-downloads.conf`, then `sudo tail /var/log/nginx/error.log`.

## 5. Backups

Add this statement to the server's instance role, with the bucket's name in place of `<bucket>`. It lets the server write backups but never destroy old versions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "EdgemodsLitestream", "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::<bucket>", "arn:aws:s3:::<bucket>/*"] },
    { "Sid": "EdgemodsLitestreamKeepHistory", "Effect": "Deny",
      "Action": ["s3:DeleteObjectVersion", "s3:PutBucketVersioning", "s3:PutLifecycleConfiguration", "s3:DeleteBucket"],
      "Resource": ["arn:aws:s3:::<bucket>", "arn:aws:s3:::<bucket>/*"] }
  ]
}
```

Then:

```sh
sudo BUCKET=<bucket> ./deploy/setup-litestream.sh --dry-run
sudo BUCKET=<bucket> ./deploy/setup-litestream.sh
```

It writes `/etc/litestream-edgemods.yml` and the `litestream-edgemods` unit. Before enabling anything, it syncs once as the `edgemods` user. After enabling, it looks in the bucket for the backup files; a running unit alone proves nothing. TheLostRealms' `litestream.service` and `/etc/litestream.yml` are not touched.

**Check:** the script ends with `Done` and lists files in the bucket. Then try the restore it prints, once, now.

## 6. New indexes from GitHub

The site rebuilds nothing by itself. `.github/workflows/index.yml` builds a fresh `index.db` on GitHub's runner, every hour, after each publish and when started by hand. It sends the index to `https://edgemods.ai/api/v1/admin/index`, signed with `EDGEMODS_INDEX_SECRET`. The site checks the index opens, is the right format, and has at least half the mods that show now. Then it swaps it in. Otherwise it keeps the old one and logs why.

In the EDGEmods repository on GitHub, Settings, Secrets and variables, Actions (the owner):

| Kind | Name | Value |
|---|---|---|
| Secret | `EDGEMODS_INDEX_SECRET` | The same value as in `/etc/edgemods.env` |
| Variable | `EDGEMODS_SITE` | `https://edgemods.ai`. The workflow does nothing until this is set |
| Variable, optional | `EDGEMODS_INDEX_RUNS_ON` | Leave unset: the rebuild runs on GitHub's runner (the owner, 2026-11-22). `["self-hosted","edgemods"]` would use a runner on the server, which is not set up |

**Check:** in Actions, run **Index rebuild** by hand. Its last step says `edgemods.ai took the index`, and `journalctl -u edgemods | grep Index` on the server shows the swap.

An index can also be put in by hand: copy it to `/var/lib/edgemods/index.db.new`, run `sudo -u edgemods mv /var/lib/edgemods/index.db.new /var/lib/edgemods/index.db`, then `sudo systemctl reload edgemods`. Use `mv`: copying straight over the open file can break it.

## 7. Connect the merge checks

With the site live, the merge checks for each publish ask the site's private blocklist. Before the merge, they record the passing result on the site. A release shows on the website only once a passing result is recorded.

In the same Actions settings (the owner):

| Kind | Name | Value |
|---|---|---|
| Secret | `EDGEMODS_CHECKS_SECRET` | The same value as in `/etc/edgemods.env` |
| Variable | `EDGEMODS_SITE` | Already set in step 6 |

From then on, if the site cannot be reached, the checks stop instead of merging without the blocklist.

The test mod, `CyberbuildsAI/edgemods-test-mod`, merged before this existed, so the site has no result for it. To record one: in Actions, open the **Registry checks** run of pull request #1 and choose **Re-run jobs**. The result is sent before the merge step, which then fails because the pull request is already merged. That failure is expected. (Unverified: that a re-run uses today's variables and secrets. If it does not, ask the EDGEmods session for another way.)

**Check:** `curl -s https://edgemods.ai/healthz` shows `"mods":1`, and the test mod has a page.

## Updating

```sh
cd ~/EDGEmods
git pull
sudo ./deploy/setup-edgemods.sh
```

The script builds the new commit, points `/opt/edgemods/current` at it and restarts. If the new build does not answer on `/healthz` within 20 seconds, it puts back the build that ran before and shows the log. It keeps the last three builds. Your settings and data are never touched. If a new version adds a setting, the script lists it at the end.

When `deploy/nginx/edgemods-downloads.conf` changes, the script installs it and reloads nginx after `nginx -t`. The site file in `conf.d` belongs to certbot once it has added HTTPS, so the script never rewrites it. A change to `deploy/nginx/edgemods.ai.conf` is made in the live copy by hand, then `sudo nginx -t && sudo systemctl reload nginx`.

## When something is wrong

| What you see | Look at |
|---|---|
| The service does not start | `journalctl -u edgemods -n 50 --no-pager`. "There is no index" means the first index failed to build: run step 3 again and read its index lines |
| Sign-in is off | The log's lines under `Sign-in:` name each missing setting |
| 502 from nginx | `systemctl status edgemods`; that it listens on the port in `/etc/edgemods.env` |
| The site shows no mods | No passing check results yet (step 7), or the index has none (`curl -s 127.0.0.1:8800/healthz`) |
| A new index was refused | The **Index rebuild** run's last step, and `journalctl -u edgemods | grep Index` |
| Backups | `journalctl -u litestream-edgemods -n 50`; run `setup-litestream.sh` again, which checks everything again |
| Memory | The unit caps the service at 768 MB (`MemoryMax`); `systemctl status edgemods` shows what it uses |

## Not covered yet

| What | Why it matters |
|---|---|
| Release checks for updates (`release-check` in the design) | When a modder makes a new release of a mod that is already listed, nothing checks it yet, so the site keeps showing the release it has. Needed before modders depend on the live site |
| The GitHub webhook (R3g) | New releases show at the next hourly index instead of at once |
| Removing a mod through the EDGEmods App | Admins can hide or block a mod; taking its registry file out is a pull request by hand for now |
| A runner on the server (`deploy/runner/`) | The fallback if updates by the server session do not work out (the owner, 2026-11-22): it would deploy each commit. Not built |
