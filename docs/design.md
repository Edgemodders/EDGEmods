# EDGE<span class="y">mods</span> design

EDGEmods is a mod website for Cyberpunk 2077 that hosts no mod files. Every mod lives in its author's own GitHub repository. EDGEmods is a **registry**: a list of those repositories, checked on the way in, and a website that builds a searchable catalogue and a page for each mod from what is in its repository. A VS Code extension, also called EDGEmods, browses and installs mods, and publishes and manages a modder's own mods. The other EDGE tools read the same registry.

**Status: draft 0.2, 2026-10-17.** Sections marked **Decided** were agreed with the owner in chat on 2026-10-17. Sections marked **Proposed** are not decided yet. The research behind this page is in [R0 research](research.html). On 2026-10-17 the owner started the build: R1, the metadata format, is drafted as code and reviewed as it is built.

## The idea, as the owner put it (Decided)

| # | Goal | In practice |
|---|---|---|
| 1 | The mod lifecycle is key. A mod made in REDcode is published to EDGEmods from REDcode, by a project button or a command, which opens a form for the mod's details | Name, short description, version, a markdown page for the mod, files, requirements and more. The form's fields are designed later |
| 2 | Publishing creates a GitHub repository for the mod and pushes the mod's files, including structured files the website uses | A metadata JSON file and a `README.md` at least; the full layout is part of the design |
| 3 | EDGEmods has a main repository with the registry. Publishing opens a pull request on it that adds the mod repository's URL | The modder signs in to GitHub; the pull request is opened from their computer |
| 4 | A CI workflow on that pull request checks that the mod repository has the required files and that they conform | What exactly is checked is part of the design |
| 5 | If the checks pass, the pull request merges automatically. The registry on `main` is the source of truth; the website builds its searchable database from the listed mods' metadata | A mod that fails never enters the database |
| 6 | The website looks like part of the EDGE family | The house style of REDnode, EDGEdeck, EDGEwave and the rest |
| 7 | Browse new and recently updated mods. Each mod has a card: image, name, short description, downloads, likes, size, version, tags and type (visual, gameplay, modding resource and so on). Search, sort, filter and facets, such as all new gameplay mods | More card fields will come |
| 8 | A merge to `main` starts a second workflow, on the owner's own machine, that rebuilds the website's index: a `node:sqlite` database backed up to S3 with Litestream | |
| 9 | The website runs behind a Node service that reads the database | Designed in a later step |
| 10 | Users register and sign in with Auth0. The sign-in from the owner's TheLostRealms application is the template | See "Accounts" below |

## Mission

EDGE brings modding to everyone, especially non-coders: easy, fun and fast. Sharing a mod today means a hosting site's upload forms, a page written in its markup, and screenshots uploaded one by one, repeated for each version. With EDGEmods, the mod's repository already is its page, and publishing a new version is one action in the editor.

| Rule | In practice |
|---|---|
| The author owns everything | Files, text, images and history stay in the author's repository. Leaving EDGEmods loses nothing |
| One action to publish | From a REDcode project: describe, add files and images, push, release, register |
| The page comes from the repository | No second copy of the description to keep in step |
| Everything the UI does, an assistant can do | Each feature ships in the UI and the MCP server together |
| Open and inspectable | The registry is a public list in a public repository |

## The mod lifecycle (Decided)

| Step | Who | What happens |
|---|---|---|
| Make | The modder, in REDcode | A WolvenKit project, packed by REDcode |
| Publish | The modder, in the EDGEmods extension | REDcode's project button opens the EDGEmods publishing form in the editor. The form creates the GitHub repository, pushes the mod's files, makes a release with a version tag, and opens the registry pull request |
| Check | EDGEmods CI | The merge checks run on the pull request (see "The registry and its checks") |
| Merge | EDGEmods CI | Automatic when every check passes. The owner spot-reviews afterwards |
| Index | The owner's machine | The merge to `main` starts the rebuild of the website's database |
| Update | The modder, in the EDGEmods extension | Update a mod, replace files, change the version, and other admin tasks, from the extension's explorer of the modder's published mods. A new version is a new release in the mod's repository |

Publishing lives in the EDGEmods extension, not in REDcode; REDcode only adds the button that opens it. The form's full set of actions is designed later.

### Publishing, step by step (Decided, the owner, 2026-10-17)

| # | Where | What happens |
|---|---|---|
| 1 | REDcode | The modder builds the mod and clicks REDcode's Publish button |
| 2 | REDcode → EDGEmods | REDcode calls the EDGEmods extension (which has its own activity bar icon) to start publishing |
| 3 | The EDGEmods form | The form opens with defaults from the REDcode project: name, version, files and so on. The modder fills in the rest |
| 4 | GitHub sign-in, once | EDGEmods asks the modder to sign in with GitHub and approve its access, **before** anything is created |
| 5 | The extension | Creates the repository and fills it: `edgemods.json`, the README, images, Issues and Discussions turned on, EDGEmods' webhook, the release with its files, then the registry pull request |

One approval is enough (proposed, from GitHub's documentation): GitHub's sign-in permissions (OAuth scopes) apply to the whole account, not to one repository, so `public_repo`, approved before the repository exists, also covers its Issues, Discussions and releases afterwards, and `write:repo_hook` covers the webhook. A second approval would only be needed with per-repository access (a GitHub App), which EDGEmods does not use on mod repositories. Details in "Talking about a mod".

## The registry and its checks

**Decided:**

- The registry lives in this repository. Publishing adds a mod by a pull request that adds the mod repository's URL.
- The merge checks are a chain of steps; each can pass, fail, or add tags. The pull request merges automatically when all pass.
- **At launch:** the structure checks and a binary and malware step.
- **Soon after:** an agent review of the repository's content. It adds tags such as NSFW to the EDGEmods database, and fails the pull request for clearly illegal content (to be defined by the owner).
- EDGEmods does not otherwise police mods. Each repository is its modder's responsibility, and CD Projekt RED or anyone else takes concerns to that repository.
- Requirements that are external links (another mod site, a file host) are not scanned for now.

**Proposed** (built in R2 as described in [the registry](registry.html), still for the owner's review):

| Topic | Proposal | Why |
|---|---|---|
| Layout | One small file per mod, `registry/<github-user>/<mod>.json`, with the repository URL, the owner and GitHub's numeric repository id | Pull requests that all edit one list conflict, and only the first can merge automatically. The numeric id survives renames |
| Trigger | `pull_request_target`, which never checks out or runs the pull request's code and reads everything from the mod repository as data | Plain `pull_request` workflows wait for a maintainer's approval for first-time contributors, which every new modder is |
| Structure checks | Exactly one added file, in the right folder; the pull request's author owns the mod repository; the metadata matches the schema; the README exists; a release with a version tag exists; sizes are within limits; the name is not too close to an existing mod's | |
| Binary and malware step | List each release file's contents without extracting anything to run; mark `.dll`, `.exe`, `.asi` and scripts so the mod page says so in plain words; record hashes; scan with ClamAV on the CI runner (built); VirusTotal could be added once its terms for this use are read | RED4ext plugins run inside the game with the player's permissions |
| Merging | A small EDGEmods GitHub App merges, and reads repositories for the indexer | A merge made with the workflow's own token would not start the rebuild on `main`; an App also has higher API limits |
| Agent review | Returns a fixed, structured answer only: pass or fail, plus tags from an agreed list. It can block a mod or add tags, never approve one by itself. No write access, no secrets | Mod READMEs are untrusted and could try to instruct it |
| Updates | No pull request for a new version. The indexer hears of each new release from the mod repository's webhook (see "Talking about a mod"), with a check on a schedule as well, and runs the same checks on anything new. A failing release hides the mod until it is fixed; the registry entry stays | The website must see new releases, which do not touch `main` |
| Removal | A repository that is deleted or taken down drops off the website on the next pass; the registry file stays as history | |

## A mod's repository

**Decided:**

- The publishing form writes a metadata JSON file and a `README.md`, which the website renders as the mod's page.
- Releases carry version tags set by the publishing process. A release can hold several files.
- Each file has a role (required, optional, choose one and so on) and a free-text note. "Choose one" covers variants that override the same thing, such as different body meshes, so one mod offers options instead of becoming many mods.
- A mod lists its requirements, for the whole mod or for one file: other EDGEmods mods, or external links.
- An EDGEmods requirement is picked in the publishing form from a search box that filters as the modder types, then one of that mod's releases (its version tag). Some requirements pin a version. The choice is in `edgemods.json`, so installing can resolve the chain (the owner, 2026-10-17).
- External links are the modder's to own: no version, not scanned.

**Proposed:** the layout and every field of `edgemods.json` are on their own page, [the format](manifest.html), built in R1 for review.

## The website

**Decided:**

- The website lives at https://edgemods.ai.
- A Node service, an Express server as in TheLostRealms, in front of a `node:sqlite` database, backed up to S3 with Litestream.
- Anyone can browse anonymously: cards, search, sort, facets, and mod pages with their releases and files.
- Downloading, and seeing where a mod comes from (its GitHub repository), need a registered account. This is a **soft gate**, a reason to register, not access control: the registry and the mod repositories are public on GitHub.
- Likes are the website's own, one per signed-in account.
- Download counts are the website's own, not GitHub's release counts, which include bots.
- The look follows the EDGE house style (see [R0 research](research.html#house-style)).

**Proposed:**

| Topic | Proposal |
|---|---|
| Downloads | Every download, from the website or the extension, goes through one endpoint, like `/download/<mod>/<version>/<file>`, which counts it and redirects to the GitHub file. Repeats from the same account are counted once per file per day |
| Images | The website serves cached copies of each mod's images and rewrites links to the repository on anonymous pages. Otherwise `raw.githubusercontent.com` addresses would show the origin. It also keeps the pages fast and sanitized |
| Sanitizing | READMEs are untrusted. Sanitize the HTML; show only the mod's own images |
| Search | In SQLite, with full-text search (FTS5, if `node:sqlite` includes it: unverified) and facet counts |
| Look | EDGEweb's `site.css` as the base: cut-corner card panels, yellow for active and primary, cyan for links, uppercase mono labels, dark only. The filter chips follow EDGEdeck's library view |

## Talking about a mod

**Decided (the owner, 2026-10-17):**

- Mods have comments on EDGEmods, and comments have likes.
- A mod page also has **Discussions** and **Issues**: simple renderings of the GitHub Discussions and Issues of the mod's repository, which EDGEmods reads and writes through the GitHub API.
- Reading GitHub fresh on each view is preferred, so EDGEmods does not keep a second copy, unless that makes pages slow; then webhooks and a local copy.
- **Modders never have to go to GitHub.** The EDGEmods extension and website do everything. The modder's GitHub sign-in authorizes what the extension needs to set up and manage the mod's repository; nothing else is installed or clicked on GitHub.

**Proposed:**

A GitHub App cannot be installed silently: GitHub has no API that creates an installation, only its own install page (checked 2026-10-17). So EDGEmods uses no App on mod repositories. The modder's sign-in is the only thing they approve, once.

| Topic | Proposal | Why |
|---|---|---|
| The sign-in | The extension signs in to GitHub through VS Code's built-in GitHub sign-in, asking once for `public_repo` (create and manage public repositories, releases, discussions, pull requests) and `write:repo_hook` (add a webhook). GitHub shows one approval page as part of signing in; after that everything is silent. The token stays in VS Code; the EDGEmods server never holds it | One approval, which every GitHub sign-in shows anyway. A server that held modders' write tokens would be a target |
| Setting up the repository | When publishing, the extension creates the repository, turns on Issues and Discussions (Discussions are off on new repositories), pushes the files, makes the release and adds EDGEmods' webhook, all through the API | The modder sees EDGEmods' form, not GitHub |
| The webhook | A repository webhook to `https://edgemods.ai/api/v1/github/webhook`, with a secret the server issues for that repository (each delivery is signed with it). Events: `issues`, `issue_comment`, `discussion`, `discussion_comment`, `release`, `repository`. GitHub sends a `ping` when it is added, so the server knows the webhook works | It replaces the App's webhooks, and the indexer hears of new releases at once instead of polling |
| No webhook | Things still work, a little staler: the cache expires after a few minutes, and the indexer also checks releases on a schedule. The mod's page in "My mods" says the webhook is missing, with a button to add it again. Not a merge check: the checks cannot see a repository's webhooks | Never block publishing over a convenience |
| Reading | Live from GitHub with EDGEmods' own token: Issues through REST, Discussions through GraphQL (GitHub has no REST API for them). A short cache in memory, dropped by the webhook. Conditional requests with ETags, which GitHub does not count against the rate limit when nothing changed. Which token (the registry App's, or another) is settled in R3 | Nothing kept on EDGEmods but a disposable cache. One token's limit (5,000 requests an hour) is shared by every mod, so caching matters; if it runs short, the local copy below |
| Speed | The mod page renders at once; the Discussions and Issues tabs load their content when opened. A cache hit is instant; a miss costs one GitHub call, typically well under a second (to measure in R3) | The slow part never blocks the page |
| If that is too slow | Keep a local copy, filled by the same webhook and a backfill when the mod is published. The webhook is needed either way, so this is a later step, not a different design | |
| Writing from the extension | With the modder's or player's VS Code GitHub sign-in, as themselves | The token is already there |
| Writing from the website | For people signed in with GitHub: post as themselves. That needs a GitHub token on the server for each such person (Auth0 can ask GitHub for `public_repo` and keep the token). To decide: accept that the server holds these tokens (encrypted, used only to post what the person writes), or let the website read only and post from the extension. People signed in with email or Google read, and talk in EDGEmods' own comments | A post made with EDGEmods' token would show as EDGEmods, not the person |
| Soft gate | Discussions and Issues are for signed-in people: they link to the repository and name its owner | The origin is behind sign-in |
| Sanitizing | GitHub's text is untrusted like a README: rendered and sanitized on the server; avatars and images through EDGEmods' cache | |
| Moderation | The modder moderates Discussions and Issues; the extension and website can show them the tools GitHub's API offers (close, lock, hide). EDGEmods' own comments are moderated by its admins and through reports | |
| The registry pull request | Publishing needs a pull request from the modder's account, so the extension silently keeps a fork of the EDGEmods repository in their account and opens the pull request from it. The fork is the one GitHub thing a curious modder might notice | GitHub only lets people without write access propose changes from a fork |

## Accounts (Decided)

| Who | Signs in with | Can |
|---|---|---|
| Anyone | Nothing | Browse |
| Player | Any Auth0 account: email, Google, GitHub | Download, like, see a mod's origin, browse and install in VS Code |
| Modder | A GitHub account through Auth0, required for publishing | All of the above, plus publish and manage their mods; the extension shows their published mods |

A modder who signs in with email or Google can browse but does not see their published mods, which belong to their GitHub account. The Auth0 tenant does not exist yet.

**Proposed**, following TheLostRealms (details in [R0 research](research.html#thelostrealms-auth0-code)):

| Part | Proposal |
|---|---|
| Website sign-in | Auth0 Universal Login, authorization code with PKCE, done by the server, as TheLostRealms does |
| Sessions | An opaque session id in an HttpOnly cookie, stored in the database so sessions can be revoked |
| API | One check that accepts the website's cookie or the extension's Bearer token (an Auth0 access token, RS256, audience checked), with a same-origin check for writes through the cookie |
| Extension sign-in | An Auth0 sign-in provider in VS Code: the system browser with a loopback PKCE redirect; the refresh token kept in VS Code's secret storage |
| Modder check | Publishing endpoints require an Auth0 user id from the GitHub connection, which carries the numeric GitHub user id. Before publishing, the extension checks that its VS Code GitHub sign-in is the same GitHub user |
| Code | Based on the Apache-2.0 sign-in in TheLostRealms' `Registry/`, with its notice kept. TheLostRealms' `Server/` files are under the Business Source License and are not copied |

## Hosting

**Decided:**

- The EDGEmods service runs on the same server as TheLostRealms, and its databases are backed up by Litestream as TheLostRealms' are, with an EDGEmods entry added to the configuration.
- It is installed and updated the same way as TheLostRealms' services: one shell script that installs or updates the service, so every service on the server is handled alike.
- EDGEmods stays separate from TheLostRealms for now, but done identically: its own install script (not part of TheLostRealms' `Deploy/install.sh`), its own Litestream unit and config, and its own S3 bucket for backups.

**Proposed:**

| Topic | Proposal | Why |
|---|---|---|
| Litestream | A `litestream-edgemods` unit with its own `/etc/litestream-edgemods.yml`, pinned to the same Litestream version (0.5.17), written by EDGEmods' own setup step, which proves a sync reached the bucket before enabling it. It replicates `site.db` only. TheLostRealms' `/etc/litestream.yml` is not touched: its script overwrites hand edits | Separate, and identical in practice |
| Bucket | A new versioned, private, encrypted bucket for EDGEmods. Access through the server's instance role, no keys on disk: a policy statement allowing Put, Get, Delete and List on that bucket, and denying `DeleteObjectVersion` and turning versioning off, as TheLostRealms' `LitestreamReplication` policy does. The owner creates the bucket and the policy | A taken server can disrupt the backup but not destroy it |
| Install script | `sudo ./deploy/setup-edgemods.sh [--dry-run]`, written fresh to TheLostRealms' conventions (its scripts are Business Source License). Re-runnable: a rerun deploys the current commit and restarts. Preflight (root, systemd, Node 22.13+ for `node:sqlite`, a full checkout); service account `edgemods`; the app copied to `/opt/edgemods`; `/etc/edgemods.env` added from the example if missing and never overwritten; data in `/var/lib/edgemods` through the unit's `StateDirectory`; a hardened `edgemods.service` with `daemon-reload` when it changes; restart and prove `/healthz` answers; stop at the first failure and name it; ports read from the code | Every service on the server is installed and updated alike |
| Deploy files | `deploy/` holds the script, the units, the env example, the Litestream config and an nginx snippet that a person includes (the live nginx config is never edited) | EDGEmods deploys without any change to TheLostRealms |

## Administration

**Decided:**

- The server's settings hold a list of admin email accounts, as in TheLostRealms.
- The server has an admin page for managing user accounts and mods: editing, removing, blocking and so on, simple at first.
- The blocklist is private. It lives in the SQLite database, where changes are transactional and take effect at once, backed up to S3 by Litestream.

**Proposed:**

| Topic | Proposal | Why |
|---|---|---|
| Two kinds of data | Two database files. `site.db`: users, sessions, likes, downloads, moderation, the blocklist, the audit log; backed up by Litestream. `index.db`: rebuilt from the registry and the repositories; no backup needed | A rebuild must not bring back a removed mod, wipe likes or touch the blocklist |
| Remove or hide a mod | A moderation status per mod (visible, hidden, blocked) that the indexer respects. Removing also opens a pull request that deletes the registry file | The registry on `main` is the source of truth; a removal only on the website would return on the next rebuild |
| Edit a mod | Admin overrides on top of the modder's metadata: tags, type, NSFW, featured. The modder's repository is never changed | The repository belongs to the modder |
| Block a user | Revokes their sessions and refuses sign-in. Blocking a modder also stops publishing: the merge checks ask the EDGEmods API whether the GitHub user or repository is blocked | The merge checks run on GitHub, not on the server |
| Admin sign-in | Verified emails on the list only; an empty list admits no one; a same-origin check on every admin action | As in TheLostRealms |
| Audit log | Every admin action, with who, what and when | Needed once there are several admins |
| Spot reviews | The admin page lists recently auto-merged mods, and later the agent review's results | The review after auto-merge |

## The EDGEmods extension (Decided)

| Feature | What it does |
|---|---|
| Browse | The same cards, search, filters and mod pages as the website, in VS Code, from the website's API |
| Install | Installs a mod with its whole chain of requirements: the server assembles the chain, the extension downloads the files and hands each mod to EDGEdeck, which installs it into the player's loadout (see below) |
| Install from the website | An Install button on the website opens the extension (proposed: a link like `vscode://edgemodders.edgemods/install?mod=…&version=…`, as Nexus' links already work with EDGEdeck) |
| My mods | An explorer of the modder's published mods, from the website's API |
| Publish and manage | The publishing form: a new mod, an update, replacing files, changing the version, and other admin tasks |

The extension lives in this repository, beside the server, and its `.vsix` is published in this repository's releases. The extension and the server have separate versions and tags, so either can ship without the other (the owner, 2026-10-17):

| Tag | Release |
|---|---|
| `extension-vX.Y.Z` | The `.vsix` attached; then the Marketplace and Open VSX |
| `server-vX.Y.Z` | The release the install script deploys (`setup-edgemods.sh --tag …`) |

**Proposed:**

| Topic | Proposal |
|---|---|
| Layout | `extensions/edgemods`, in the same npm workspace as `packages/*`, as REDcode does. Its non-UI code is in `extensions/edgemods/src/core`, with no VS Code imports, so the MCP server can bundle it. Activity bar icon: [`tools/brand/activity.svg`](https://github.com/Edgemodders/EDGEmods/blob/main/tools/brand/activity.svg) |
| Compatibility | The API is versioned (`/api/v1/…`). The server keeps older API versions while extensions still use them; the extension says plainly when it needs a newer server |

## Installing a mod and its requirements

**Decided (the owner, 2026-10-17):** when a player picks a mod to install, the EDGEmods server assembles the dependency chain from the mods' `edgemods.json` files. The EDGEmods extension orchestrates the rest: it downloads every file in the chain from the mods' GitHub releases and hands each mod to EDGEdeck, which installs each one into the loadout.

**Proposed:**

| Topic | Proposal |
|---|---|
| The plan | `GET /api/v1/mods/<id>/install-plan?version=…&files=…` returns the mods in install order, requirements first. Each has its id, name, version and files (name, role, group, size, SHA-256, download link), and says which mod or file needs it. It also returns the outside links to get by hand, and any problems. It has download links, so it needs sign-in like any download |
| Versions | A requirement without `exact` allows its release or any newer one; the plan takes the newest release every requirement in the chain allows. `exact` allows only that release |
| Conflicts | Requirements that cannot all hold (one needs exactly 1.2.0, another 1.3.0 or newer) stop the install before anything downloads, with a plain message naming who needs what |
| Which files | Of a required mod: its required files, one file of each choose-one group (the player picks; the first is suggested), and its optional files offered unticked. A file's own requirements join the chain only when that file is chosen |
| Depth | Requirements of requirements come from each chosen release's `edgemods.json`; the indexer keeps every release's. Up to 20 levels; a loop is reported, not followed |
| Already installed | The extension asks EDGEdeck what the library has, and skips a mod already there at an allowed version |
| Downloads | Each file goes through the EDGEmods download link, which counts and redirects to GitHub, and is checked against the SHA-256 the indexer recorded before it reaches EDGEdeck |
| Outside links | Shown in the plan for the player to get themselves; never fetched |
| A mod removed later | A requirement that is no longer on EDGEmods (removed, hidden, blocked) is a problem in the plan; the mod that needs it shows a warning on its page |

## How it fits with the other EDGE tools

| Tool | How |
|---|---|
| EDGEdeck | Owns installing. `EDGEdeckApi` version 1 (checked 2026-10-17) has `installProject`, `deploy` and `turnOff`, but no install from a downloaded archive. **First request issue (proposed):** install a list of downloaded mods in order, each as `{ files: [paths], source: 'edgemods', modId, version, requires: [modIds] }`, into the active loadout, so EDGEmods versions join EDGEdeck's families the way Nexus versions do; plus a way to ask which EDGEmods mods and versions the library already has |
| REDcode | Owns the project and packing (`REDcodeApi` version 1: `project()`, `pack()`). **Request issue (proposed):** a project button and command that open the EDGEmods publishing form, with a prompt to install EDGEmods when it is missing |
| GitHub | Mod repositories, releases, the webhook and the registry pull request are made with the modder's own GitHub account, through VS Code's GitHub sign-in (`public_repo` and `write:repo_hook`), so the modder never has to visit GitHub |
| EDGEweb | Owns https://edgemodders.ai, the platform's site; EDGEmods has its own domain, https://edgemods.ai. EDGEweb can link to it |
| EDGEkit, EDGEplugin | Bundle EDGEmods, and teach it to the assistant, once released |

## The MCP server (Proposed)

| Tool | Does |
|---|---|
| `mods_search` | Finds mods by words, tag, type or requirement |
| `mods_info` | One mod: summary, releases, files, requirements |
| `mods_install` | Installs a mod through EDGEdeck |
| `mods_publish` | Publishes a REDcode project as a mod, asking the user before each step that goes public |

## Phases (Proposed)

To be agreed. The format comes first, because the checks, the website and the extension all read it.

| Phase | Builds | The test proves |
|---|---|---|
| **R0 Design** | This document and the metadata format's page | The owner agrees the design |
| **R1 Format** | The metadata schema, a validator, an example mod repository | The example validates; a broken one is explained in plain words |
| **R2 Registry and checks** | The registry folder, the merge checks (structure, binary and malware), the GitHub App, auto-merge | A pull request for the example mod merges by itself; a bad one is refused with a clear reason |
| **R3 Website** | The indexer, the database and Litestream, the Express service, Auth0, browse, search, the mod page, downloads, the admin page | The example mod has a page, found by search, downloadable after sign-in |
| **R4 Browse and install** | The extension's browse view, Auth0 sign-in, install through EDGEdeck, Install links from the website | A mod found in VS Code is installed through EDGEdeck and runs in the game |
| **R5 Publish** | The publishing form, REDcode's button, the repository and release, the registry pull request, My mods, updates | A non-coder publishes a mod from REDcode and sees its page |
| **R6 Ship** | The agent review, docs, the MCP package, Open VSX and Marketplace, the EDGEkit bundle | Someone outside the team publishes a mod from the docs alone |

## Open questions

| Question | Notes |
|---|---|
| The metadata format and the publishing form's fields | Next, on their own page |
| Which malware scanner | VirusTotal's terms for this use, ClamAV, or both |
| What the agent review tags and refuses | The owner defines it before R6 |
| Nexus | Cross-posting, linked both ways? EDGEdeck already speaks to Nexus |
| Other git hosts | GitHub only for now |
| Privacy | No tracking on the website; the extension calls the network only when the user asks for something that needs it |

## Sources

| Source | What it gave |
|---|---|
| The owner, 2026-10-17 | The idea, goals 1 to 10, and every decision on this page |
| [R0 research](research.html) | Prior art, GitHub mechanics, legal, TheLostRealms' sign-in, house style |
| [EDGEdeck design](https://edgemodders.github.io/EDGEdeck/design.html) | Installing, families, the Nexus client |
| [REDcode API](https://edgemodders.github.io/REDcode/api.html) | `REDcodeApi` version 1 |
