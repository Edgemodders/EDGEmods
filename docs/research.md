# R0 research

Research for EDGEmods' design, done on 2026-10-17 by the first EDGEmods session. It records what was checked so later sessions do not redo it. **[V]** means checked at the source given; **[U]** means unverified (memory, a secondary source, or an inference). Decisions are in the [design](design.html), not here.

## Registries over repositories they do not host

| Registry | How entries are added | Automated checks | Auto-merge | Human review | Updates | Removal |
|---|---|---|---|---|---|---|
| Obsidian plugins | Was a pull request appending to `community-plugins.json`. Now submitted at community.obsidian.md with a linked GitHub account "so the directory can verify repository ownership" [V](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) | `manifest.json` at HEAD; a release tagged exactly `x.y.z` with `main.js` and `manifest.json` | No | Code review | A new release; the app reads the manifest version [V](https://github.com/obsidianmd/obsidian-releases) | Not documented [U] |
| Julia General | A bot (Registrator) opens the pull request. One directory per package | Name rules, a similarity check against existing names (distance 3 or more), license, the package loads, no skipped versions | **Yes**, only for the bot's pull requests. Waits 3 days for new packages, 15 minutes for new versions | Any comment blocks the merge | Each version is a pull request, merged automatically | Permanent; versions are yanked, never deleted [V](https://juliaregistries.github.io/RegistryCI.jl/stable/guidelines/) |
| winget-pkgs | A pull request adding one folder per version | Schema, URL reputation, hash, several antivirus engines, install and uninstall in a sandbox | Partly: approved automatically when nothing is found | Moderators | A pull request per version | Policy labels [V](https://learn.microsoft.com/en-us/windows/package-manager/package/repository) |
| Homebrew core | A pull request adding one file per formula | Builds on macOS and Linux | No | Maintainers; a notability rule (stars, forks, age) | A bot opens bump pull requests every 3 hours | Legal or safety removals [V](https://docs.brew.sh/Package-Acceptance-Policy) |
| Scoop buckets | A pull request adding one JSON manifest per app | JSON format, required license and description, hashes, auto-update fields | No | Maintainers | A job rewrites manifests hourly or daily [V](https://github.com/ScoopInstaller/GithubActions) | A bot handles broken downloads |
| Flathub | A pull request to a submission branch | Test builds | No | Volunteers; approved apps get their own repository | No review for updates | [V](https://docs.flathub.org/docs/for-app-authors/submission) |
| Raycast | `npm run publish` opens the pull request for the author: the closest to publishing from REDcode | A local build | No | Human review, published on merge | Publish again | [V](https://developers.raycast.com/basics/publish-an-extension) |
| Open VSX | Upload with a token; namespaces are claimed | Secrets, known-bad hashes, similar names | Clean uploads publish | Only flagged uploads | Upload again | [V](https://github.com/EclipseFdn/open-vsx.org/wiki/Publishing-Extensions) |
| pkg.go.dev | No submission; indexes from the module proxy | Limited display without a redistributable license | n/a | None | Automatic | Retraction, or a request that hides docs [V](https://pkg.go.dev/about) |

What modders expect from mod sites:

| Site | Notes |
|---|---|
| Thunderstore | A zip with `manifest.json` (name, semver `version_number`, description of 250 characters or fewer, dependencies as `Team-Package-Version`), a 256 × 256 `icon.png` and `README.md` [V](https://wiki.thunderstore.io/mods/creating-a-package). Malware has slipped through uploads [V, secondary](https://www.malwarebytes.com/blog/detections/thunderstore-io) |
| Nexus Mods | Every upload goes through VirusTotal; files flagged by several engines are held for moderators [V, secondary, 2017](https://www.nexusmods.com/trinitytrigger/news/12378). A Requirements tab lists dependencies [V](https://www.nexusmods.com/news/3400). Endorsing may require a download first [U] |

Lessons:

- One file per entry (Julia, winget, Homebrew, Scoop) avoids merge conflicts between pull requests that would otherwise all edit the end of one list.
- Every large registry keeps a scanner or a person in front of new entries; Julia automates fully but waits 3 days for new names.
- Bad entries are yanked or hidden, not deleted, and new names are checked for similarity to existing ones.
- Obsidian, the largest list-file registry, moved toward account-linked ownership checks.

## GitHub mechanics

### CI on pull requests from forks

Sources [V]: [events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [secure use](https://docs.github.com/en/actions/reference/security/secure-use), [pull_request_target change, 2025](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/).

| Trigger | Behavior |
|---|---|
| `pull_request` from a fork | Read-only `GITHUB_TOKEN`, no secrets: cannot merge. By default, workflows from first-time contributors wait for a maintainer's approval, and every new modder is a first-time contributor |
| `pull_request_target` | Runs the default branch's workflow, without the approval wait, with write permissions and secrets. Safe only if it never checks out or runs the pull request's code. `actions/checkout` v7 refuses to check out fork code in this trigger [V](https://github.com/actions/checkout/releases) |

The safe pattern: `pull_request_target`, no checkout, minimal `permissions`; read the pull request's changed files through the API; fetch the mod repository's files as data; validate against a JSON schema; never pass fetched values to a shell except through environment variables.

| Fact | Status |
|---|---|
| Auto-merge needs the repository setting, a required check or review, and someone with write access to enable it | [V](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request) |
| A privileged job or a GitHub App can merge fork pull requests | [U] |
| A merge made with `GITHUB_TOKEN` does not start other workflows, so a rebuild on `main` needs a GitHub App token or `workflow_dispatch` | [U] |
| Whether `pull_request_target` check runs satisfy required status checks | [U] |
| Ownership: no official pattern. Compare the pull request's author with the repository's `owner.login`, and store the numeric repository id against renames and repo-jacking | [U] |

### Sign-in from VS Code

| Fact | Status |
|---|---|
| VS Code's built-in `github` provider passes any requested scopes through | [V](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/github-authentication/src/github.ts) |
| Creating a public repository needs `public_repo` or `repo` | [V](https://docs.github.com/en/rest/repos/repos) |
| `public_repo` covers pushing, releases, forking and opening a pull request on public repositories | [U] |
| Pushing `.github/workflows/*` needs `workflow` | [V](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps) |

### Limits

| Item | Limit |
|---|---|
| File in git | Warning over 50 MiB, blocked over 100 MiB [V](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) |
| Repository | Ideally under 1 GB, under 5 GB strongly recommended |
| Release assets | Each under 2 GiB, up to 1000 per release, no total or bandwidth limit [V](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) |
| REST API | 5,000 per hour per user; `GITHUB_TOKEN` 1,000 per hour per repository; GitHub App 5,000 to 12,500. A 304 conditional response is free [V](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) |
| GraphQL | 5,000 points per hour per user; about 100 repositories per query [V](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api) |

### Counts

| Fact | Status |
|---|---|
| Release assets have a `download_count` | [V](https://docs.github.com/en/rest/releases/assets) |
| It counts every fetch, bots and indexers included, not unique people | [U] |
| Repositories have `stargazers_count`; from July 2026, stargazer lists are limited to admins and collaborators | [V](https://docs.github.com/en/rest/activity/starring) |

## Legal

| Source | What it says |
|---|---|
| [CD Projekt RED Fan Content Guidelines](https://www.cdprojektred.com/en/fan-content) [V] | Mods are welcome "so long as it doesn't breach the relevant game's EULA". No commercial use; reasonable donations are fine, paywalls are not. Authors own their original content and grant CD Projekt RED a broad licence. Game content stays CD Projekt RED's |
| [Cyberpunk 2077 EULA](https://cdn1.epicgames.com/eulatracking-download/cp2077/en/v1/r2/ebdad01b0f2e8388d23b5750ca18a3ac.pdf) (2020) [V] | 7c: do not copy, distribute or publish the game except as authorised. 7d: do not modify, distribute, reverse engineer or decompile, unless the law allows it. Section 8 points mods to the Fan Content Guidelines |
| [REDmod EULA](https://cdn1.epicgames.com/eulatracking-download/redmod/en/v1/r2/bfa2a0e549d6deaaf540f12d85b71493.pdf) (2022) [V] | Mods are for use with the game and non-commercial. CD Projekt RED does not claim ownership of mods. Mods must not infringe anyone's IP. CD Projekt RED may block mods that break the rules |
| [GitHub Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) [V] | No delivering malicious executables, no infringing content; excessive bandwidth may be throttled. No rule specific to game mods or `.dll` files was found [U] |

## TheLostRealms' Auth0 code

The owner's other application (local checkout `E:\Development\TheLostRealms\thelostrealms`) has a worked-out Auth0 sign-in, read on 2026-10-17.

| Part | How it works |
|---|---|
| Website sign-in (`Server/identity.js`) | The server redirects to Auth0's Universal Login (authorization code with PKCE, a public client, no secret). State, nonce and verifier ride in a signed 15-minute cookie. On callback the server verifies the ID token and sets a signed, HttpOnly, SameSite=Lax session cookie holding the profile and Auth0's access token, for 7 days, not revocable |
| Gated API (`Server/access-token.js`) | A dependency-free RS256 verifier: checks issuer, audience, expiry, caches the tenant's keys for 10 minutes, fails closed. Takes the token from a Bearer header (desktop clients) or the session cookie (the page), with a same-origin check on writes through the cookie |
| Client (`text_adventure.html`) | No Auth0 SDK. A full-page redirect to sign in; same-origin `fetch` with the cookie; a 401 shows "sign in again" |
| Roles | Email allow-lists, verified emails only |
| Local data | `node:sqlite` with WAL, keyed by the Auth0 `sub`; Litestream replicates it to S3 |
| Native clients | Designed, not built (`Designs/native-app-login.html`): system browser with a loopback PKCE redirect, refresh-token rotation, Device Code as a fallback |
| Licenses | `Server/` and the client are Business Source License 1.1. `Registry/` is Apache-2.0 and has an equivalent sign-in (`admin-login.js`: PKCE exchange, RS256 ID-token check, opaque revocable sessions) |

## House style

The EDGE look is defined by the CSS of [REDnode's design page](https://edgemodders.github.io/REDnode/design.html); EDGEweb's `docs/assets/css/site.css` extends it with buttons, tool cards and status pills. EDGEdeck's library webview (`src/modsPage.ts`) has a search box and facet chips.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#08090d` | Page background |
| `--panel` / `--panel-2` | `#10131b` / `#151925` | Panels; table headers |
| `--line` | `#262c3d` | Borders and rules |
| `--fg` / `--dim` | `#e3e6ee` / `#8a93a8` | Text; muted text |
| `--yellow` | `#fcee0a` | Primary: focus, active, highlighted word in titles |
| `--cyan` | `#19f3ff` | Secondary: links, eyebrows |
| `--red` / `--green` | `#ff2a52` / `#5dffa1` | Warnings; OK |

Fonts from Google Fonts: Chakra Petch (display), Rajdhani (body), JetBrains Mono (labels). Cut corners by `clip-path` instead of rounded corners; uppercase mono labels; a faint cyan grid background; a sticky status bar. Dark only on the web; no glow or scanlines.

## Search

With a Node service and SQLite, search and facets can run in SQLite (full-text search with FTS5, if Node's `node:sqlite` build includes it [U]). For a browser-side index, Orama has built-in facets, MiniSearch is small but leaves facet counts to you, and Lunr has been unmaintained since 2020.
