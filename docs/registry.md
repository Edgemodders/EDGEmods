# The registry and its merge checks

The registry is the list of mods on EDGEmods: one small file per mod in [`registry/`](https://github.com/Edgemodders/EDGEmods/tree/main/registry). Publishing a mod opens a pull request that adds its file. The merge checks look at the mod's repository and release, report in plain words on the pull request, and merge it by themselves when every check passes.

**Status: R2, built 2026-10-17, for the owner's review.** The checks run; merging by themselves waits for the EDGEmods GitHub App (see "Setup" below). The code is in [`packages/checks`](https://github.com/Edgemodders/EDGEmods/tree/main/packages/checks) and the workflow in [`.github/workflows/registry.yml`](https://github.com/Edgemodders/EDGEmods/blob/main/.github/workflows/registry.yml).

## A registry file

`registry/<github-login>/<mod-id>.json`:

```json
{
  "schemaVersion": 1,
  "repo": "https://github.com/octocat/better-car-radio",
  "repoId": 123456789,
  "ownerId": 583231
}
```

One file per mod, so two modders publishing at once never conflict. The numeric ids survive renames, and tie the file to the account that owns the repository.

## The checks

A chain of steps. Each passes or fails with reasons; once one fails, the rest wait, so the modder sees the first thing to fix. Problems are errors; advice (warnings) never stops a mod.

| Step | Passes when |
|---|---|
| The pull request | It is open and adds exactly one file, `registry/<login>/<mod-id>.json`, in the folder of the person who opened it. The file is valid, and its `ownerId` is that person's GitHub id. Removing or editing registry files is for admins; new versions need no pull request |
| The mod's repository | It exists, is public, not archived, and belongs to the person who opened the pull request (a personal account for now). Its `repoId` matches. The account and repository are not on the private blocklist. The mod id is not used by anyone else, and the repository is not registered under another id. A fork, or an id one letter away from another, is advice for the admins' spot review |
| edgemods.json | It is on the default branch, passes the [format's](manifest.html) checks, has the same id as the registry file, and names the repository's owner as `author.github` |
| The release | A published release is tagged `v<version>`, has every file `edgemods.json` lists (same names, not empty, under 2 GiB), and its tagged commit has `edgemods.json` for that same id and version |
| The mod page and images | At the release's tag: the page and every image exist with exactly the same capitals, the images are real PNG, JPEG or WebP files, the card is 2:1, and no file is too large for git |
| The downloads | Each listed file is downloaded and hashed (SHA-256), and its contents listed without extracting anything. It fails for paths that climb out of the folder or are absolute, names with text-reversing characters, password-protected files, an empty archive, or anything the malware scanner finds. Game plugins (`.dll`, `.asi`) and programs are allowed; they are listed, and the mod page will say the mod runs code |

The report on the pull request lists every step, the problems and advice, and a table of what each download contains, with its scan result and hash. Text from the mod's repository is escaped so it cannot become markup or mention anyone.

### Safety of the workflow

| Rule | Why |
|---|---|
| `pull_request_target`, which runs without waiting for approval | Every new modder is a first-time contributor, whose plain `pull_request` workflows would wait for an admin |
| The pull request's code is never checked out or run | `pull_request_target` has write access and secrets |
| The mod's files are read as data: parsed, measured, hashed, listed | Nothing from a mod runs on the runner. ClamAV and 7-Zip read the downloads; neither runs them |
| Values from the pull request reach the shell only through environment variables | No script injection |
| The merge names the exact commit that was checked (`--match-head-commit`) | A push after the checks cannot slip in |
| Least permissions: read contents, write pull request comments; the App token only for the merge | |

## Setup (the owner, on GitHub)

Until these are done, the checks run and report, and the report says the pull request will merge once the App is set up.

| Step | Where | What |
|---|---|---|
| 1. Create the EDGEmods GitHub App | github.com/organizations/Edgemodders/settings/apps/new (the organization's settings, so the App belongs to Edgemodders, not a personal account) | Name "EDGEmods registry". Untick Webhook "Active". Repository permissions: Contents read and write, Pull requests read and write, Metadata read. "Where can this GitHub App be installed?": Only on this account. Create it |
| 2. Install it on EDGEmods only | The App's page > Install App > Edgemodders > Install | Choose "Only select repositories" and pick EDGEmods. The repository is chosen here, not on the create form |
| 3. Give the workflow the App | EDGEmods > Settings > Secrets and variables > Actions | Variable `EDGEMODS_APP_ID` (the App ID shown on the App's page). Secret `EDGEMODS_APP_PRIVATE_KEY`: on the App's page, Private keys > Generate a private key, then paste the whole downloaded `.pem` file |
| 4. Allow it to merge (only if `main` has rules) | EDGEmods > Settings > Rules > Rulesets | Skip this when there are no rulesets (true on 2026-10-17). If one is added later that requires pull requests or reviews on `main`, add the App to its bypass list. Do not create a ruleset just for this |
| 5. Later, with the server (R3) | The same Actions settings | Variable `EDGEMODS_API_URL` and secret `EDGEMODS_REGISTRY_SECRET` connect the private blocklist. Until then the report says "Blocklist: not connected yet" |

## Run the checks by hand

```powershell
npm run build
$env:GITHUB_TOKEN = gh auth token
node packages/checks/bin/registry-check.mjs --repo Edgemodders/EDGEmods --pr 12 --report report.md
```

ClamAV (`clamscan`) and 7-Zip (`7z`) must be installed for the downloads step; on Windows that step fails with "ClamAV is not installed", and the earlier steps still run.

## Open points

| Point | Notes |
|---|---|
| Organization-owned mods | Refused for now: the checks cannot see who in an organization may publish |
| VirusTotal | ClamAV runs now. VirusTotal's terms for this use still need reading; it could be added as a second scanner |
| An end-to-end test | Needs a real test mod repository and a real pull request: the owner's go-ahead first, since both are public |
