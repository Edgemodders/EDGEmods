# EDGE<span class="y">mods</span> design

EDGEmods is a mod website for Cyberpunk 2077 that hosts no mod files. Every mod lives in its author's own GitHub repository. EDGEmods is a **registry**: a list of those repositories, checked on the way in, and a website that builds a searchable catalogue and a page for each mod from what is in its repository. A VS Code extension, also called EDGEmods, browses and installs mods, and publishes and manages a modder's own mods. The other EDGE tools read the same registry.

**Status: draft 0.2, 2026-10-17.** Sections marked **Decided** were agreed with the owner in chat on 2026-10-17. Sections marked **Proposed** are not decided yet. The research behind this page is in [R0 research](research.html). On 2026-10-17 the owner started the build: R1, the metadata format, is drafted as code and reviewed as it is built. Built since, for review: R1, R2 (the registry and its merge checks), R3a and R3b (the indexer and the read-only website, 2026-10-23) and R3c (accounts, 2026-11-21); the [docs home](index.html) has the roadmap status.

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
| Publish | The modder, in the EDGEmods extension | REDcode's project button opens the EDGEmods publishing form in the editor. The form turns the project folder into a git repository, creates the GitHub repository and pushes the project to it, makes the first release with a version tag, and opens the registry pull request |
| Check | EDGEmods CI | The merge checks run on the pull request (see "The registry and its checks") |
| Merge | EDGEmods CI | Automatic when every check passes. The owner spot-reviews afterwards |
| Index | The owner's machine | The merge to `main` starts the rebuild of the website's database |
| Update | The modder, in VS Code and the EDGEmods extension | The modder keeps editing the project and pushes with VS Code's Source Control; others can send pull requests. When the modder is ready, Release in the extension makes the new version (see "The mod's source, builds and releases"). Other admin tasks are in the extension's explorer of the modder's published mods |

Publishing lives in the EDGEmods extension, not in REDcode; REDcode only adds the button that opens it. The form's full set of actions is designed later.

### Publishing, step by step (Decided, the owner, 2026-10-17)

| # | Where | What happens |
|---|---|---|
| 1 | REDcode | The modder builds the mod and clicks REDcode's Publish button |
| 2 | REDcode → EDGEmods | REDcode calls the EDGEmods extension (which has its own activity bar icon) to start publishing |
| 3 | The EDGEmods form | The form opens with defaults from the REDcode project: name, version, files and so on. The modder fills in the rest |
| 4 | GitHub sign-in, once | EDGEmods asks the modder to sign in with GitHub and approve its access, **before** anything is created |
| 5 | The extension | Turns the project folder into a git repository (the owner, 2026-10-18), adds `edgemods.json`, the README, images and the build workflow, creates the GitHub repository and pushes; turns on Issues and Discussions, adds EDGEmods' webhook, makes the first release with its files, then the registry pull request |

One approval is enough (proposed, from GitHub's documentation): GitHub's sign-in permissions (OAuth scopes) apply to the whole account, not to one repository, so `public_repo`, approved before the repository exists, also covers its Issues, Discussions and releases afterwards, `write:repo_hook` covers the webhook, and `workflow` covers the build workflow file. A second approval would only be needed with per-repository access (a GitHub App), which EDGEmods does not use on mod repositories. Details in "Talking about a mod".

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
| Where an update is checked | The server does not scan. It asks EDGEmods' own workflow to check the release (a `repository_dispatch` event, `release-check`, with the mod and the tag, sent with the App's token). The workflow runs the same steps as the merge checks, downloads and ClamAV included, on a GitHub-hosted runner, and sends the result to the server signed with a shared secret. Until it passes, the website keeps showing the previous release; players never see an unchecked one | One scanner setup for new mods and updates, and strangers' files never touch the server |
| Scanning in the mod's own build | The shared build workflow also runs ClamAV before it makes a release, as an early warning for the modder. It is not a merge check: the modder controls that workflow | The modder hears first; EDGEmods still checks for itself |
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

## The mod's source, builds and releases

**Decided (the owner, 2026-10-18):**

- The repository holds the mod's source: the whole REDcode project, not only the files the website reads. Release files hold the built mod.
- Publishing turns the modder's own project folder into a git repository: `git init`, the EDGEmods files added, the first commit pushed to the new GitHub repository. From then on the folder is a managed checkout.
- The author keeps editing in that folder and commits and pushes with VS Code's Source Control, as any developer would.
- Other modders can propose changes to a mod by pull request, which the author reviews and merges.
- Nothing is released automatically. A push or a merge never makes a release; the author says when a version is ready.

**Proposed:**

| Topic | Proposal | Why |
|---|---|---|
| Git | The extension works through VS Code's built-in Git extension (its API), so the folder appears in Source Control at once. Pushes are authenticated by the same VS Code GitHub sign-in. If Git is not installed, the form says so and links the installer before anything else happens | One sign-in; nothing to learn beyond VS Code's own buttons |
| What the first commit holds | The project (the `.cpmodproj` and `source/`), `edgemods.json`, `README.md`, `CHANGELOG.md`, `images/`, `LICENSE`, a `.gitignore` and the build workflow. The `.gitignore` leaves out `packed/` and REDcode's local state (`.redcode/`) | The source, without build output or one machine's state |
| A folder already in git | Kept: the extension adds the EDGEmods files as a new commit, and adds the GitHub repository as `origin` if there is none. If `origin` already points to a GitHub repository the modder owns, the form offers to publish that one | Modders who use git already keep their history |
| Large files | Before the first push, the form lists any file over 50 MB (GitHub warns) and stops on any over 100 MB (GitHub refuses it), in plain words with what to do. Git LFS is not used at first: its free allowance is small (amount unverified) | A failed push halfway through publishing is the worst first experience |
| Builds on push | A push to `main`, and every pull request, runs a build check: pack, zip, check the zip. It never makes a release. The extension shows the result beside the mod in My mods; the zip is kept as a workflow artifact for a few days, for testers | The author and contributors find out at once if a change breaks the build |
| Releasing | The author clicks Release in the extension (or on their mod page). They pick the next version (suggested from the last), check the notes, which come drafted from the commits (see "The changelog"), and confirm the requirements. The extension writes the version into `edgemods.json` and the notes into `CHANGELOG.md`, commits, and pushes the tag `v<version>`. The tag starts the release build, which packs, zips, checks and makes the GitHub release with the files attached | One deliberate action; the tag's commit holds the matching `edgemods.json`, as [the format](manifest.html) requires |
| The changelog | `CHANGELOG.md` is in the first commit, and `edgemods.json` names it. It follows the changelog convention of every Edgemodders repo (the owner, 2026-10-19): a section per release, newest first, `## 1.2.0 (2026-10-19)`, with `## Unreleased` on top, and the lines grouped **New**, **Changed**, **Fixed**, **Other**. At Release, the extension drafts the version's notes (the owner's idea, 2026-10-19): the lines already under Unreleased (an author or contributor may write them as they go), then one line for each commit since the last tag that they do not cover, its first line; a merged pull request becomes one line, its title, with credit ("thanks to @name, #12"), instead of its commits; merge commits and earlier release commits are left out. Commit lines are put in a group by their words ("fix" to Fixed, "add" or "new" to New, the rest to Changed), and the author moves or edits them in the form, because commit messages like "update" are common. The extension renames Unreleased to the version and starts a new empty one. The same text is the GitHub release's description, and "Copy for Nexus" gives it as plain lines for a mod also on Nexus. AI can tidy the draft when the author asks, never by itself | The author writes nothing from scratch but still decides what players read. Contributors get credit without doing anything. The file is in the repository, so it can be corrected like any file |
| Release notes on the website | The indexer reads `CHANGELOG.md` from the default branch and takes, for each release, the section whose heading has its version, so a corrected note shows at the next index. A release with no section (made by hand) uses the GitHub release's description. Sections for versions not yet released are not shown. Markdown, sanitized like the README | One source for the notes, with a fallback |
| Requirements at each release | The Release form shows the requirements before the tag is pushed, so they are confirmed at every release, not only at first publishing. For each EDGEmods requirement it says when a newer release is out ("Core Library 1.3.0 is out; this mod needs 1.2.0 or newer") and offers to raise it; requirements can be added, changed or removed there too. It also suggests frameworks the files show the mod uses (an `.xl` file: ArchiveXL; `r6/tweaks`: TweakXL; `r6/scripts`: redscript; Cyber Engine Tweaks' or RED4ext's folders), as suggestions the author accepts or not. They go into `edgemods.json` in the release commit, so each tag keeps its own list. Changing them between releases is an ordinary edit that counts from the next release | Requirements change as a mod grows; a release is the moment they must be right |
| The shared build | The workflow file in each mod's repository is a few lines that call one shared, reusable workflow in the EDGEmods repository, pinned to a tag like `build-v1`. A fix for a WolvenKit or game change is made once, in the shared workflow, not in every mod | Most modders cannot fix a broken workflow; a shared one is maintained by EDGE |
| Packing on GitHub | A Windows runner downloads REDbridge's release and packs the project the way REDcode does. REDcode owns packing, so this needs a command-line pack from REDcode (a request issue), not a copy of its code. **Tested 2026-10-18** with the hand-run Pack test workflow (`tools/pack-test`), a project made from scratch, and REDbridge 0.10.0 on `windows-latest`: it packs with no game folder; the whole job took about a minute (installing .NET 10 about 30 s, the pack step 8 s). Without the game, WolvenKit compresses with `kraken.dll` instead of the game's Oodle library (which is the game's and cannot go on a runner) and warns that this "could cause errors". But the game's Oodle unpacked the runner's archive to the source's exact bytes (a 4.4 MB CR2W file, compressed to 348 KB). Not yet done: loading a runner-built mod in the game | Packing is REDcode's job; works on a runner |
| If the runner cannot pack | Release builds on the author's PC with REDcode instead, then pushes the tag and uploads the files itself. Everything after the build is the same | The release flow does not depend on the runner |
| Several files | A release can have several files (choose-one variants, optional parts). Which parts of the project go into which file is set in the publishing form and kept in the repository for the build (to be designed in R5) | |
| The zip's layout | Every release file is laid out as the game folder: `archive/pc/mod/…`, `r6/scripts/…`, `r6/tweaks/…`, `bin/x64/plugins/…`. REDcode's `packed` folder already is, so the build only zips it | What EDGEdeck, Vortex and Mod Organizer 2 install as it is |
| Checking the zip | The merge checks and the indexer's release checks look at the listing they already make: a zip with nothing under a folder a mod manager knows fails, with a plain message | Catches hand-made zips |
| Built from source | The shared build adds GitHub's build attestation to each file, which proves it was built by that workflow from that commit. The mod page shows "Built from source" when it is there | Trust: the download is the repository's code |
| Permissions | Adding the workflow file needs GitHub's `workflow` scope, asked with the others at the one sign-in | GitHub refuses pushes that touch `.github/workflows/` without it |
| Contributing | "Contribute to this mod" in the extension forks the repository into the contributor's account, clones it and opens it in REDcode. "Propose change" pushes their branch and opens the pull request. The contributor needs a GitHub account | Contributors stay in VS Code too |
| Reviewing a pull request | My mods lists the pull requests on the author's mods. "Try it" checks out the branch, packs it and installs it through EDGEdeck; "Merge" merges. GitHub holds the build check of a first-time contributor's pull request until the author approves it, which the extension also offers | The author never has to visit GitHub |
| The "Updated" chip | The new release reaches EDGEmods through the repository's webhook (`release`). The indexer runs the release checks, records the version and date, and the card gets its "Updated" chip; players who have the mod see the update in the extension. A release made by a workflow does not start other workflows, but GitHub still sends the webhook | The same path for every release, however it was built |

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
| Downloads | Every download, from the website or the extension, goes through one endpoint, like `/download/<mod>/<version>/<file>`, which counts it and serves it at the account's speed (see "Subscriptions and download speed"). Repeats from the same account are counted once per file per day. **Built 2026-11-21 (R3d):** `/download/<mod>/<version>/<file>` needs a sign-in (a visitor is sent to sign in and back to the mod's Files tab), serves only files of releases that show, counts in `site.db` (`downloads`, unique per person, file and day; a deleted account's rows lose their person but stay, so counts do not drop) and serves the file as `src/downloads.ts` says: `EDGEMODS_DOWNLOADS=redirect` (a PC) sends the browser to the file on GitHub; `nginx` (the live server) hands GitHub's signed address to nginx. Cards and mod pages show the count; Browse sorts by Most downloaded. The Account page's **Downloaded mods** tab (next to Liked mods; the owner, 2026-11-21) lists each mod with the version the person got, when, and "Newer version: x" when one is out, so it doubles as an update check |
| No limit on how many | **Decided (the owner, 2026-11-21).** There is no limit on how many mods an account downloads. A monthly limit for free accounts was built and dropped the same day: one that a subscription lifts could read as a paywall on mods, which CD Projekt RED's fan content guidelines forbid. Free downloads are limited in speed only |
| Images | The website serves cached copies of each mod's images and rewrites links to the repository on anonymous pages. Otherwise `raw.githubusercontent.com` addresses would show the origin. It also keeps the pages fast and sanitized |
| Sanitizing | READMEs are untrusted. Sanitize the HTML; show only the mod's own images |
| The index | `packages/indexer` builds `index.db` (built 2026-10-23, R3a). Each repository is found by GitHub's numeric id, so renames do not matter; one that is gone, private or owned by someone else drops off. Every release whose tag (`v<version>`), `edgemods.json` and attached files agree is kept, each with its own files, requirements and notes; other tags are ignored. The mod's name, summary, page and images come from the newest release that is not a pre-release, at its tag, so the page matches the download. A mod or release with a problem is left out, and the reason is kept for the admin page and My mods. Pages and notes are rendered to sanitized HTML when indexing: a fixed list of tags, no scripts, styles or frames, images only from the mod's own repository, and links into the repository sent through `/mods/<id>/source/…` so visitors do not see it |
| Which releases show | The index holds what GitHub has; whether a release passed the release checks is in `site.db`. The website shows a release only once it has passed, so the newest checked release is what players see |
| Search | In SQLite, with full-text search (FTS5) and facet counts. `node:sqlite` includes FTS5: checked 2026-10-22 on Node 24.11.1 (SQLite 3.50.4), with the `porter unicode61` tokenizer, prefix queries and `bm25` ranking. `node:sqlite` still prints an "experimental" warning on Node 24 |
| Caching | One cache module with a small interface (get, set with an expiry, delete, delete by prefix), kept in the service's memory at launch. It holds search and facet results (cleared when the index is swapped in), GitHub reads (cleared by the webhook), rendered READMEs and rate-limit counters. Redis (the owner's suggestion, 2026-10-18; agreed it waits until it is needed) replaces the memory store behind the same interface when it pays: when the service runs as more than one process, or the cache must survive restarts. The server runs no Redis today (checked in TheLostRealms' deploy files). Measure first: with one process and the database on local disk, SQLite answers most queries in milliseconds |
| Versions | The mod page's Versions tab lists every release, newest first, as rows that open to show what changed, the files with their download links, the requirements and the game version it was tested with, and "Install this version". Each release has its own files and requirements, from its tag. A release that failed the release checks is not listed. An older version stays downloadable while its GitHub release exists; if the author deletes the release, it leaves the list |
| Look | EDGEweb's `site.css` as the base: cut-corner card panels, yellow for active and primary, cyan for links, uppercase mono labels, dark only. The filter chips follow EDGEdeck's library view. The website's stylesheet is the prototype's; its fonts are served by EDGEmods itself, so pages load nothing from other sites |
| Pages (built 2026-10-23, R3b) | Built on the server as HTML (the owner's choice, 2026-10-23), so search engines and link previews read them; `packages/server`, Express 5. Every value is escaped by the page template unless it is the indexer's sanitized HTML. Pages work without JavaScript: filters are a form, tabs and pictures are links; `site.js` only improves them. A Content-Security-Policy allows only the site's own scripts, styles, fonts and images, no inline code, and no framing |

## Talking about a mod

**Decided (the owner, 2026-10-17):**

- Mods have comments on EDGEmods, and comments have likes.
- A mod page also has **Discussions** and **Issues**: simple renderings of the GitHub Discussions and Issues of the mod's repository, which EDGEmods reads and writes through the GitHub API.
- Reading GitHub fresh on each view is preferred, so EDGEmods does not keep a second copy, unless that makes pages slow; then webhooks and a local copy.
- **Modders never have to go to GitHub.** The EDGEmods extension and website do everything. The modder's GitHub sign-in authorizes what the extension needs to set up and manage the mod's repository; nothing else is installed or clicked on GitHub.
- **People stay on the website** (the owner, 2026-10-17). It renders Discussions and Issues, and anyone signed in with a GitHub account can post in them right there, in a box like GitHub's; the post appears on GitHub under their own account. The box says plainly that posting needs a GitHub account, and offers to link one. People choose how far into open source and git they go: EDGEmods comments need any account; opening issues and taking part in discussions needs GitHub.
- **The plain GitHub sign-in, for now** (the owner, 2026-10-17): it grants access to all of the modder's public repositories, not only the mod's, as many VS Code extensions already ask. If modders push back, EDGEmods moves to narrower access (see "Open questions").

**Proposed:**

A GitHub App cannot be installed silently: GitHub has no API that creates an installation, only its own install page (checked 2026-10-17). So EDGEmods uses no App on mod repositories. The modder's sign-in is the only thing they approve, once.

| Topic | Proposal | Why |
|---|---|---|
| The sign-in | The extension signs in to GitHub through VS Code's built-in GitHub sign-in, asking once for `public_repo` (create and manage public repositories, releases, discussions, pull requests), `write:repo_hook` (add a webhook) and `workflow` (add the build workflow file). GitHub shows one approval page as part of signing in; after that everything is silent. The token stays in VS Code; the EDGEmods server never holds it | One approval, which every GitHub sign-in shows anyway. A server that held modders' write tokens would be a target |
| Setting up the repository | When publishing, the extension creates the repository, pushes the project through git, turns on Issues and Discussions (Discussions are off on new repositories), makes the release and adds EDGEmods' webhook, through git and the API | The modder sees EDGEmods' form, not GitHub |
| The webhook | A repository webhook to `https://edgemods.ai/api/v1/github/webhook`, with a secret the server issues for that repository (each delivery is signed with it). Events: `issues`, `issue_comment`, `discussion`, `discussion_comment`, `release`, `repository`. GitHub sends a `ping` when it is added, so the server knows the webhook works | It replaces the App's webhooks, and the indexer hears of new releases at once instead of polling |
| No webhook | Things still work, a little staler: the cache expires after a few minutes, and the indexer also checks releases on a schedule. The mod's page in "My mods" says the webhook is missing, with a button to add it again. Not a merge check: the checks cannot see a repository's webhooks | Never block publishing over a convenience |
| Reading | Live from GitHub with EDGEmods' own token: Issues through REST, Discussions through GraphQL (GitHub has no REST API for them). A short cache in memory, dropped by the webhook. Conditional requests with ETags, which GitHub does not count against the rate limit when nothing changed. Which token (the registry App's, or another) is settled in R3 | Nothing kept on EDGEmods but a disposable cache. One token's limit (5,000 requests an hour) is shared by every mod, so caching matters; if it runs short, the local copy below |
| Speed | The mod page renders at once; the Discussions and Issues tabs load their content when opened. A cache hit is instant; a miss costs one GitHub call, typically well under a second (to measure in R3) | The slow part never blocks the page |
| If that is too slow | Keep a local copy, filled by the same webhook and a backfill when the mod is published. The webhook is needed either way, so this is a later step, not a different design | |
| Posting from the website | The first time someone posts, the website asks them to connect GitHub for posting: a separate GitHub approval for `public_repo`, so signing in with GitHub alone never grants write access. The server keeps that token encrypted in the database with a key from the server's settings (so the Litestream backups hold no usable tokens), uses it only to post what the person writes, and deletes it when they disconnect or delete their account. A token GitHub has revoked asks them to connect again | Posts appear under the person's own GitHub account. People who never post never grant anything |
| Linking GitHub | Someone signed in with email or Google links a GitHub account to their EDGEmods account (Auth0 account linking) from the post box or their settings | Their likes, comments and downloads stay one account |
| Posting from the extension | With the person's VS Code GitHub sign-in, as themselves | The token is already there |
| What the box can do | Discussions: reply, start a discussion (with the repository's categories). Issues: comment, open an issue. Markdown with a preview, as on GitHub. The modder also gets close, lock and hide on their own mod | Simple first; more of GitHub's features as people ask |
| Soft gate | Discussions and Issues are for signed-in people: they link to the repository and name its owner | The origin is behind sign-in |
| Sanitizing | GitHub's text is untrusted like a README: rendered and sanitized on the server; avatars and images through EDGEmods' cache | |
| Moderation | The modder moderates Discussions and Issues; the extension and website can show them the tools GitHub's API offers (close, lock, hide). EDGEmods' own comments are moderated by its admins and through reports | |
| The registry pull request | Publishing needs a pull request from the modder's account, so the extension silently keeps a fork of the EDGEmods repository in their account and opens the pull request from it. The fork is the one GitHub thing a curious modder might notice | GitHub only lets people without write access propose changes from a fork |

## Subscriptions and download speed

**Decided (the owner, 2026-10-18):** the website has a paid subscription, through Stripe. Accounts without one download through a rate-limited endpoint; subscribers get full speed.

**Proposed:**

| Topic | Proposal | Why |
|---|---|---|
| Free downloads | The download endpoint checks the sign-in, counts the download, then answers with nginx's `X-Accel-Redirect` to an internal location and `X-Accel-Limit-Rate` with the free speed. nginx passes the file through from GitHub to the player at that speed, with no copy kept (a disk cache can be added later if GitHub ever slows the server's fetches; it would not lower the bandwidth bill, which counts bytes leaving the server). GitHub's download link for a release file is a redirect to a short-lived signed address on its file host, and nginx does not follow redirects by itself, so the service asks GitHub for that address first and passes it to nginx; nginx connects with the host's name for TLS (`proxy_ssl_server_name on`). The internal location turns off nginx's response buffering (`proxy_buffering off`): with it on, nginx reads from GitHub faster than a throttled player takes the file and parks the difference in temporary files on disk, up to 1 GB per download by default, which would fill the disk after all. With it off, nginx reads from GitHub only as fast as the player receives. The service never handles the file's bytes | A redirect cannot be slowed down, so free downloads must pass through the server; nginx does the streaming and the throttling, which it is built for |
| Subscribers' downloads | The same endpoint answers with a redirect to the GitHub release file. GitHub serves it at full speed from its own network | Full speed at no bandwidth cost to EDGEmods. Subscribers are signed in, so seeing GitHub's address breaks no soft gate |
| The free speed | Set in the server's settings, so it can change without a release. The number is the owner's choice | |
| In the extension | Installs use the same endpoint (the install plan's download links), so the same speed applies, and the progress bar says which. A free account's install suggests the subscription once, never during a download | One rule everywhere |
| Bandwidth cost | Free downloads leave the AWS server, which AWS charges for beyond a monthly free allowance (about 100 GB, then roughly $0.09 per GB: unverified, check against the bill). 10,000 free downloads of 50 MB is 500 GB a month. Subscribers cost nothing in bandwidth. The admin page shows the month's free bytes served | The cost grows with free use, not paid use, so it must be watched |
| Stripe | Stripe Checkout to subscribe and Stripe's customer portal to change or cancel; no card details reach EDGEmods. A webhook (`/api/v1/stripe/webhook`, its signature checked) records each account's subscription state in `site.db`. Each Stripe event is claimed once by its id before it is applied, as TheLostRealms' Portal does with its keys. Payment failures keep full speed until Stripe gives up, then fall back to free | Stripe holds the money and the cards; EDGEmods only knows "subscribed until" |
| What stays free | Every mod stays downloadable and installable for free, from the website and the extension. The subscription buys speed, not access. The files also stay public on GitHub, where anyone can download them at full speed; that is a soft gate, like sign-in for downloads | CD Projekt RED's Fan Content Guidelines allow no paywalls on mods (see [R0 research](research.html#legal)); Nexus Mods sells speed the same way for this game |
| Accounts | A fourth kind of account: Subscriber, a player or modder with an active subscription | |
| The account page | Decided (the owner, 2026-10-18): an Account page with the person's Auth0 profile and links to their billing and subscription on Stripe. Proposed tabs: **Profile** (name, verified email, sign-in methods and linking, posting to GitHub, download my data, delete account), **Liked mods**, **My mods**, **Subscription** (the plan and its state; Subscribe opens Stripe Checkout; "Manage billing and invoices" opens Stripe's customer portal, where card, invoices, plan changes and cancelling live), **Settings**. Profile changes go through Auth0's Management API from the server. Deleting an account cancels its Stripe subscription first. In the [prototype](prototype/me.html?as=modder). **Built 2026-11-21 (R3c), at `/me`:** Profile (name, email and whether it is verified, how they signed in, member since; a password email for email-and-password accounts through Auth0; Download my data as JSON; Delete account, which deletes the Auth0 user through the Management API first and only then the EDGEmods data), Liked mods, My mods (a GitHub sign-in's mods: live, waiting for checks, or hidden), Settings (adult mods). Two changes from the proposal: the name other people see is the username, kept on EDGEmods, not a name written to Auth0 (Auth0 overwrites a GitHub or Google profile's name at each sign-in, and that is often a real name); and linking sign-ins is left for later, so each sign-in method is its own account for now. Changing the email, posting to GitHub and Subscription are not built (Subscription is R3f) | Stripe and Auth0 already have the hard pages (cards, invoices, passwords); EDGEmods links to them instead of rebuilding them |

## Accounts (Decided)

| Who | Signs in with | Can |
|---|---|---|
| Anyone | Nothing | Browse |
| Player | Any Auth0 account: email, Google, GitHub | Download, like, see a mod's origin, browse and install in VS Code |
| Modder | A GitHub account through Auth0, required for publishing | All of the above, plus publish and manage their mods; the extension shows their published mods |

A modder who signs in with email or Google can browse but does not see their published mods, which belong to their GitHub account. The tenants and their settings are on [their own page](auth0-setup.html) (2026-10-25): a development tenant now, a production tenant at R3h; the website as a Regular Web Application with a client secret and PKCE; the GitHub connection asking only `read:user` and the email; the server's Management API access limited to `read:users`, `update:users` and `delete:users`.

**Proposed**, following TheLostRealms (details in [R0 research](research.html#thelostrealms-auth0-code)):

| Part | Proposal |
|---|---|
| Website sign-in | Auth0 Universal Login, authorization code with PKCE and the client secret, done by the server, as TheLostRealms does. **Built 2026-11-21 (R3c):** the sign-in page offers GitHub, Google and email (each opens Universal Login on that connection); the state, nonce and PKCE verifier ride in a 10-minute cookie signed with `EDGEMODS_SESSION_SECRET`, so nothing is held in memory; the ID token is checked by `src/jwt.ts` (RS256 only, issuer, audience, expiry, nonce; the tenant's keys cached for 10 minutes and fetched again for a new key id). Sign out ends the session and Auth0's, so the next sign-in can pick another account |
| Sessions | An opaque session id in an HttpOnly cookie, stored in the database so sessions can be revoked. **Built:** 32 random bytes in `edgemods_session` (HttpOnly, SameSite=Lax, Secure on https, 30 days); `site.db` keeps only its SHA-256. Blocking a person ends all their sessions and refuses their next sign-in |
| People | **Built:** `users` in `site.db`, keyed by the Auth0 user id (`github|<id>`, `google-oauth2|…`, `auth0|…`), with the GitHub user id and login for a GitHub sign-in, the email and whether Auth0 verified it, the adult setting and a status. Admins are verified emails listed in `EDGEMODS_ADMINS` |
| Usernames | **Decided (the owner, 2026-11-21), built the same day.** Other people see a username, never a person's name or email. After the first sign-in, a page asks for one, with a free suggestion (a GitHub sign-in is offered its GitHub login). 3 to 20 characters: a to z, digits, `-` and `_`, starting with a letter or digit; plain letters only, so nobody can pose as someone with a lookalike letter. Unique whatever the capitals (Bob and bob are one username), enforced by a unique index in `site.db`, so two people can never hold the same one. Words that look official (admin, edgemods, the EDGE tools' names) are kept back, and so are the GitHub logins of modders with mods on EDGEmods, for those modders. A username can change once in 60 days (the first pick does not count, and changing only the capitals is not a change); one given up is held for 30 days, for its old owner only. `src/usernames.ts` |
| API | One check that accepts the website's cookie or the extension's Bearer token (an Auth0 access token, RS256, audience checked), with a same-origin check for writes through the cookie. **Built:** the cookie half, with the same-origin check on every write (likes, account changes, sign out) and `GET /api/v1/me`; the Bearer half (R4a, 2026-11-22), on `/api/` and `/download/` only: the token must be RS256 from the tenant, for the EDGEmods API, with the extension's application as its `azp`; a person seen first through a token is asked of Auth0's userinfo and kept in `site.db` like a website sign-in; a blocked account's token is refused. `GET /api/v1/auth` tells the extension the tenant, its client id and the API; `POST /api/v1/me/username` picks a username; a download through a token without a username answers `403 {"error":"username"}` |
| Extension sign-in | An Auth0 sign-in provider in VS Code: the system browser with PKCE, the answer coming back through VS Code's own link handler (`vscode://edgemodders.edgemods/auth`, or the editor's own scheme), so no local port is opened (the owner agreed, 2026-11-22; it replaces the loopback redirect first proposed); Auth0's Native application "EDGEmods for VS Code", with no client secret ([Auth0 setup, step 9](auth0-setup.html)); the refresh token, rotated at each use, kept in VS Code's secret storage. The server tells the extension its tenant and client id, so the extension needs only the site's address. The person chooses how to sign in, as on the website, so the extension and the website are one account (discussed with the owner, 2026-11-21). VS Code's own GitHub sign-in is never passed to EDGEmods: it is a key to the person's repositories, and someone who uses Google or email on the website would become a second account. When VS Code has a GitHub sign-in, the extension offers "Sign in with GitHub" first, as a shortcut. VS Code's GitHub sign-in is used for publishing only: pushing the mod's repository, and checking it is the same GitHub user as the EDGEmods account |
| Modder check | Publishing endpoints require an Auth0 user id from the GitHub connection, which carries the numeric GitHub user id. Before publishing, the extension checks that its VS Code GitHub sign-in is the same GitHub user |
| Code | Based on the Apache-2.0 sign-in in TheLostRealms' `Registry/`, with its notice kept. TheLostRealms' `Server/` files are under the Business Source License and are not copied. **Built:** `packages/server/src/jwt.ts` and `src/auth0.ts` are adapted from `Registry/admin-login.js` and stay Apache-2.0, with `packages/server/NOTICE` and `licenses/Apache-2.0.txt` |

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
| Memory | Estimates, to measure in R3 (unverified): the Node service about 100 MB; the cache with a size cap from the settings (start at 128 MB, evicting the least used); SQLite's page cache a few MB per database; Litestream some tens of MB; nginx a few tens of KB per open download. So about 300 to 400 MB for EDGEmods at launch. What grows it: the cache cap (a setting), the number of free downloads open at once (nginx), and later Redis if it comes. The admin page shows the service's memory and the cache's size and hit rate, so a bigger machine is chosen from numbers | The owner can move the service to a machine with more memory when the numbers say so (the owner, 2026-10-18) |
| Deploy files | `deploy/` holds the script, the units, the env example, the Litestream config and an nginx snippet that a person includes (the live nginx config is never edited) | EDGEmods deploys without any change to TheLostRealms |
| nginx | The server's nginx is the proxy (the owner, 2026-10-18). The service listens on `127.0.0.1` only; nginx serves `edgemods.ai` over HTTPS and passes requests to it, with `X-Forwarded-For` and `X-Forwarded-Proto` (the service trusts them from the loopback proxy only, for rate limits and download counts). `www.edgemods.ai` redirects to `edgemods.ai`. Request size: nginx's default 1 MB, except the GitHub webhook (25 MB, GitHub's largest delivery) and the index handover (its own larger limit). Free downloads stream through nginx at a limited speed; subscribers' downloads are redirects to GitHub (see "Subscriptions and download speed") | One public door, as for TheLostRealms' services |
| Built (2026-11-22, R3h, not yet run on the server) | `deploy/setup-edgemods.sh`, `deploy/add-domain.sh`, `deploy/setup-litestream.sh`, the units in `deploy/systemd/`, `deploy/edgemods.env.example` and `deploy/nginx/edgemods.ai.conf`, as proposed in the rows here, with these choices: each commit is built in a temporary folder as the person running sudo, from `git archive` (local edits never ship), with `npm ci --ignore-scripts` for the server's four packages only, then copied root-owned to `/opt/edgemods/releases/<commit>`; `/opt/edgemods/current` is switched and the previous build put back if `/healthz` does not answer in 20 s; the first `index.db` is built by the script, as the service will not start without one; Litestream must already be at 0.5.17 (the script checks, it does not install). The steps, with the owner's part, are on the [Deploy](deploy.html) page |
| The domain script | `deploy/add-domain.sh [--dry-run]`, written fresh to TheLostRealms' `add-subdomain.sh` rules: DNS first (the name must already point at this server, or Let's Encrypt's check fails and rate-limits retries); one server block per name, reused if one exists; a new file in `conf.d` only, nothing else in nginx edited; `nginx -t` before every reload, and a block it wrote removed again if the test fails; the certificate from certbot `--nginx` with the HTTP-to-HTTPS redirect; then a check that `https://edgemods.ai/healthz` answers. Re-running after success does nothing | Repeatable, and nothing left broken; TheLostRealms' scripts are Business Source License, so not copied |

### Runners (Proposed)

The owner already runs a self-hosted GitHub runner on an AWS Linux server, to stay within GitHub's quotas. Standard GitHub-hosted runners are free and unlimited for public repositories, and EDGEmods and every mod repository are public, so quotas are not the reason to use it here; trust is.

| Job | Runs on | Why |
|---|---|---|
| Merge checks (`registry.yml`) and update checks (`release-check`) | GitHub-hosted, `ubuntu-latest` | They download strangers' files. A GitHub-hosted runner is a fresh machine for every job and is thrown away after; a self-hosted one keeps whatever a job leaves behind, which is why GitHub advises against self-hosted runners on public repositories |
| Mod builds (the shared build workflow) | GitHub-hosted, `windows-latest` | They run in the modders' repositories, which cannot use the owner's runner, and REDbridge is a Windows build |
| The index rebuild (goal 8) | The owner's runner, label `edgemods` | Started only by trusted events: a push to `main`, a schedule, or by hand; never by a pull request. It needs to reach the server's database |
| Pack test, App check, docs, tests | GitHub-hosted | Free, and nothing to protect |

| Topic | Proposal |
|---|---|
| Separate from the existing runner | A second runner on the same machine, in its own folder (`/opt/actions-runner-edgemods`), under its own service account, registered to the EDGEmods repository only, with the label `edgemods`. The owner's existing runner is not touched |
| Setup | `deploy/runner/`: a README and `setup-runner.sh [--dry-run]`, in the style of the server's install script: preflight, download GitHub's runner, register it with a token the owner pastes (never stored), install it as a service, prove it is online. Re-runnable |
| Where it runs | The same server as TheLostRealms and EDGEmods for now, likely separated later (the owner, 2026-10-18) |
| Handing over the index | The rebuild writes a fresh `index.db` in the runner's own folder, then sends it to the EDGEmods service over HTTPS (`POST /api/v1/admin/index`, signed with a shared secret). The service checks it opens and holds the registry's mods, then swaps it in; on any failure it keeps the old one. The same path on one machine or two, so separating the runner later changes nothing |
| What it needs | Node 24 and network access to the EDGEmods service, nothing else; no access to the service's data folder, no ClamAV, no 7-Zip, no WolvenKit |
| Workflow rule | A workflow that uses `runs-on: [self-hosted, edgemods]` has no `pull_request` or `pull_request_target` trigger. A test in this repository fails if one does |
| Built (2026-11-22, R3h) | `POST /api/v1/admin/index`: the body streams to a file beside the index; `X-EDGEmods-Timestamp` (within 10 minutes) and the body are signed together with `EDGEMODS_INDEX_SECRET`, its own secret, so an old index cannot be sent again; refused if it does not open, is another format, or shows fewer than half the mods that show now (from 4 mods on); every swap is in the audit log; SIGHUP (`systemctl reload edgemods`) reloads an index moved in by hand. `.github/workflows/index.yml` (push to `main` under `registry/`, hourly, by hand; off until the variable `EDGEMODS_SITE` is set) builds and sends it with `packages/indexer/bin/edgemods-index-send.mjs`. **It runs on GitHub's runner** (the owner, 2026-11-22): with the handover over HTTPS the rebuild no longer needs to reach the server's database, it reads only public repositories, and push and schedule runs are trusted events. **Installs and updates are done by the Claude session on the server, following [Deploy](deploy.html)** (the owner, 2026-11-22: "let's try using them first and resort to the GitHub runner later"). A runner on the server, which could also deploy each commit, is the fallback: a second runner registered to this repository only, under a user without root (it may write EDGEmods' code folder and run `systemctl restart edgemods`, nothing else), so a runner taken over reaches EDGEmods and never root or TheLostRealms. Not built; `EDGEMODS_INDEX_RUNS_ON` (`["self-hosted","edgemods"]`) would move the rebuild there. `packages/server/test/deploy.test.mjs` holds the workflow rule |


## Administration

**Decided:**

- The server's settings hold a list of admin email accounts, as in TheLostRealms.
- The server has an admin page for managing user accounts and mods: editing, removing, blocking and so on, simple at first. **Started 2026-11-21 (R3d):** `/admin`, linked from the account menu for admins only (verified emails in `EDGEMODS_ADMINS`), with an overview (mods live, accounts, this month's downloads, likes, the free speed) and the log of admin actions (`audit` in `site.db`: who, what, when, the change). Every change is checked same-origin. Mods, users, the blocklist and reports come in R3e.
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

**Built 2026-11-21 (R3e), agreed with the owner that day.** `/admin` has six tabs, each action a form that works without JavaScript, checked same-origin and written to the log:

| Tab | What it does |
|---|---|
| Overview | Counts, and the spot review: releases that show and no admin has marked reviewed, newest first, with Look and Reviewed (`spot_reviews` in `site.db`) |
| Mods | Every mod in the index, showing or not, searchable. One action per row with a private reason: Hide, Block, Show again; Mark 18+, Mark not 18+, 18+ as the modder says (`mod_overrides`; the site uses the override everywhere); Block the GitHub account; Block the repository |
| Users | Accounts, searchable. Block ends every session and refuses the next sign-in, with a private reason; Unblock. An admin cannot block their own account |
| Reports | Signed-in players report a mod from its page: a reason (does not work, malware, someone else's work, adult content not marked, something else) and an optional note; one open report per person and mod. Admins close each with a private note on what was done |
| Blocklist | GitHub accounts and repositories, added by name; GitHub gives the numeric id, which is what is kept, so a rename changes nothing. A blocked GitHub account's mods are hidden, its sessions end and it cannot sign in; a blocked repository's mods are hidden. Blocked EDGEmods accounts are listed here too |
| Log | Every admin action: who, what, when, the detail |

The merge checks' side: `POST /api/v1/blocklist/check` with `{ github, repo }` (GitHub ids), signed like check results (`EDGEMODS_CHECKS_SECRET`), answers `{ blocked, github, repo }`. The registry workflow starts asking it once the server is live (R3h); before that, every publish would fail. **Connected 2026-11-22 (R3h):** `packages/checks` asks it as the server answers (it was written in R2 for a proposed `GET /api/v1/registry/blocked`), and records a passing merge check with `POST /api/v1/checks` before the merge, so the release shows. Only a passing result is sent: a failing pull request may point at someone else's repository, and must not hide their release. Both run once the repository has the variable `EDGEMODS_SITE` and the secret `EDGEMODS_CHECKS_SECRET`; the variable without the secret stops the checks. **Not built, on purpose:** removing a mod from the registry (a pull request from EDGEmods' GitHub App, which needs the App's key on the server: R3h), and changing a mod's tags or type (search would need rebuilding around the change; the adult override covers the urgent case).

## The EDGEmods extension (Decided)

| Feature | What it does |
|---|---|
| Browse | The same cards, search, filters and mod pages as the website, in VS Code, from the website's API |
| Install | Installs a mod with its whole chain of requirements: the server assembles the chain, the extension downloads the files and hands each mod to EDGEdeck, which installs it into the player's loadout (see below) |
| Install from the website | **Decided (the owner, 2026-11-21), built on the website the same day:** a mod's page has two buttons. **Manual download** gives the file (or the Files tab, when there are several). **Mod manager** opens an `edgemods://install/<mod>/<version>` link, its own kind of link like Nexus' `nxm:` (which names Nexus files, so other managers could not use it for EDGEmods), and whichever mod manager registered for it installs the mod with its requirements. EDGEdeck registers for it next to `nxm:` links and passes each to this extension. The format and what a handler does: [Mod manager links](links.html). It replaces the earlier `vscode://edgemodders.edgemods/install` proposal, which only VS Code could answer |
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

**R4 in slices (agreed with the owner, 2026-11-22),** each with its own test. Packaging for the Marketplace stays in R6; until then the extension is tried as a `.vsix` or in VS Code's Extension Development Host.

| Slice | What it brings | Its test |
|---|---|---|
| R4a Foundations and sign-in | `extensions/edgemods` (built with esbuild, as EDGEdeck is), its core with no VS Code imports, the API client. Sign in from VS Code (browser, Auth0, back through the link handler), staying signed in with the rotated refresh token. On the server: the API and downloads accept the extension's access token; someone who signs in from VS Code first chooses a username there | Sign in from VS Code with each method; the status bar shows the username |
| R4b Browse | An EDGEmods view in the activity bar: search, New, Updated, Most downloaded, Liked. A mod page in VS Code in the website's look: About, Files, Versions, Requirements, likes, Manual download (to a folder), Install | Find the test mod and open its page |
| R4c Install | `openLink(url)` for EDGEdeck's links, an Install button and command: the plan, "Install X and N requirements?", every file downloaded and checked against its SHA-256, then EDGEdeck installs them, all or nothing, with an offer to deploy. Needs EDGEdeck#16's part 2; until then Install offers to save the files | Mod manager on the website goes all the way into EDGEdeck; then a mod found in VS Code runs in the game |
| R4d MCP server | `mods_search`, `mods_info`, `mods_plan`, `mods_install`, reusing the core; install shows the tree first | A Claude session finds and installs the test mod |

**Built:** R4a (2026-11-22; the owner's hand test passed that day). R4b (2026-11-22; the owner's hand test passed that day: "Everything works"), with how it works:

| Part | How |
|---|---|
| Side panel | A webview view in the activity bar. The extension asks the API (`/api/v1/mods`, `/api/v1/me/likes`); the panel's script draws rows from that data with `textContent` only |
| A mod's tab | One editor tab per mod, the website's own page from `GET /api/v1/mods/<id>/view` (the page without its frame, `PageContext.embed`), so the look and the soft gate are the site's. Its Mod manager button reads Install. Tabs restore when VS Code reopens |
| Links in a tab | Never followed inside the editor. The tab's script sends each link as written, and `pageLink()` in the core decides: a mod opens its tab, a type or tag filters the side panel, a download saves the file, outside links open in the browser (VS Code asks first for sites it does not trust), anything else (`javascript:`, `command:`, `file:`) does nothing |
| Webview rules | Scripts only from the extension's `media/` folder, with a fresh nonce; pictures, site.css and its fonts from the site (`/assets` sends CORS for that); no forms, no frames |
| Manual download | To a folder the person picks; the token goes to the site only, never along GitHub's redirects; each file checked against the SHA-256 the release check recorded, deleted if it does not match |
| Likes and reports | `POST /api/v1/mods/<id>/like` and `/report`, with the token |
| Sign-in | Auth0 now returns to the site's `/auth/vscode`, a page that says "Back to VS Code" and opens the editor's link; the state starts with the editor's link scheme, from a fixed list. Windows does not bring the editor forward, and a page cannot send the browser back or reliably close its own tab, so the page says what to do |
| Install | Says installing through EDGEdeck comes with R4c and offers to save the files |

R4d's first part (2026-11-22): the MCP server, `dist/mcp.js` in the extension, started by VS Code for the agents it hosts (`mcpServerDefinitionProviders`, as EDGEdeck) or by any client with `node mcp.js --site <site>` (the command **EDGEmods: Connect an assistant (MCP)** copies the Claude Code line). Tools: `mods_search`, `mods_info`, `mods_plan`, all read-only, from `src/core/tools.ts` over the same API client. They ask the site as a visitor, so no download links and no repositories. A mod's About text and notes go back fenced and labelled as the author's, data and not instructions, cut to a length. Still to do: `mods_install` with R4c, and with it how the server, a separate process, gets the person's sign-in (it cannot read VS Code's secret storage; to be agreed with the owner then).

**Scripted run, 2026-11-25** (EDGEweb's session, at the owner's request, against 60e1dfa; not the owner's hand test). It used a site on port 8801 with no sign-in and its own JSON-RPC client over stdio. All six checks passed:

| Check | Result |
|---|---|
| Tools listed | Only the three tools, each read-only; the instructions are present |
| Find the test mod | Listed, and found by "test" |
| The mod's details | Complete, with the About text and notes fenced as the author's |
| No repository shown | No tool output names the repository |
| Install plan | The plan is correct, with no problems |
| Errors | In words, with no stack traces: an unknown mod, a malformed id, the site down |

In a trial EDGEkit, **Connect an assistant (MCP)** offered its three choices. The entry in VS Code's MCP servers list was not seen, because that build has no MCP: List Servers command. Wording noted for later:
- "EDGEmods does not have that." does not name the mod.
- A malformed id's message starts with the MCP SDK's "MCP error -32602: Input validation error".
- The command's title is "Connect an assistant (MCP)", where EDGEfab, EDGEhack and EDGEmat write "Connect an Assistant (MCP)...".

## Installing a mod and its requirements

**Decided (the owner, 2026-10-17):** when a player picks a mod to install, the EDGEmods server assembles the dependency chain from the mods' `edgemods.json` files. The EDGEmods extension orchestrates the rest: it downloads every file in the chain from the mods' GitHub releases and hands each mod to EDGEdeck, which installs each one into the loadout.

**Proposed:**

| Topic | Proposal |
|---|---|
| The plan | `GET /api/v1/mods/<id>/install-plan?version=…&files=…` returns the mods in install order, requirements first. Each has its id, name, version and files (name, role, group, size, SHA-256, download link), and says which mod or file needs it. It also returns the outside links to get by hand, and any problems. Anyone can ask for it, so the mod page shows what installing brings; the download links are in it only for people who are signed in, like any download (built 2026-10-23, R3b) |
| Versions | A requirement without `exact` allows its release or any newer one; the plan takes the newest release every requirement in the chain allows. `exact` allows only that release |
| Conflicts | Requirements that cannot all hold (one needs exactly 1.2.0, another 1.3.0 or newer) stop the install before anything downloads, with a plain message naming who needs what |
| Which files | Of a required mod: its required files, one file of each choose-one group (the player picks; the first is suggested), and its optional files offered unticked. A file's own requirements join the chain only when that file is chosen |
| Depth | Requirements of requirements come from each chosen release's `edgemods.json`; the indexer keeps every release's. Up to 20 levels; a loop is reported, not followed |
| Already installed | The extension asks EDGEdeck what the library has, and skips a mod already there at an allowed version |
| The tree | The plan holds the tree (each mod or file, and what it needs) and the install order worked out from it: requirements before the mods that need them, each mod once even when several need it. Before anything starts, the extension shows what will be installed, at which version, and why ("needed by Street Cred Overhaul"); the player confirms |
| Downloads | Each file goes through the EDGEmods download link, which counts it and serves it at the account's speed |
| Download and check first | The extension downloads every file in the plan and checks each against the SHA-256 the indexer recorded, before anything is installed. A failed download or a wrong hash stops there, with nothing in the game changed |
| Installing in order | Then it hands the mods to EDGEdeck one at a time, in the plan's order, each after the one before has finished. If one fails, the install stops: the mods after it, including the one the player asked for, are not installed, and the ones this run installed are undone through EDGEdeck, so the loadout is as it was. All or nothing per call is part of the EDGEdeck request |
| When it fails | The message names the mod and version, the step (download, check, install) and the reason in plain words, with the raw error one click away and "Try again". A requirement that failed is never reported as the asked-for mod failing |
| Older versions | Installing an older version from the Versions tab makes the same plan from that release's `edgemods.json`, so with its own requirements at their versions. EDGEdeck keeps versions of a mod side by side as a family, so going back is a switch |
| In the MCP server | `mods_install` shows the same tree first and reports the same errors |
| Outside links | Shown in the plan for the player to get themselves; never fetched |
| A mod removed later | A requirement that is no longer on EDGEmods (removed, hidden, blocked) is a problem in the plan; the mod that needs it shows a warning on its page |

## How it fits with the other EDGE tools

| Tool | How |
|---|---|
| EDGEdeck | Owns installing. `EDGEdeckApi` version 1 (checked 2026-10-17) has `installProject`, `deploy` and `turnOff`, but no install from a downloaded archive. **First request issue, filed 2026-11-21 as [EDGEdeck#16](https://github.com/Edgemodders/EDGEdeck/issues/16)** with the `edgemods:` link handler (see [Mod manager links](links.html)), shaped with EDGEdeck's session; the proposal it grew from: install a list of downloaded mods in order, each as `{ files: [paths], source: 'edgemods', modId, version, requires: [modIds] }`, into the active loadout, so EDGEmods versions join EDGEdeck's families the way Nexus versions do; all or nothing: if one fails, the ones that call installed are undone, and it says which failed and why; plus a way to ask which EDGEmods mods and versions the library already has |
| REDcode | Owns the project and packing (`REDcodeApi` version 1: `project()`, `pack()`). **Request issues (proposed):** a project button and command that open the EDGEmods publishing form, with a prompt to install EDGEmods when it is missing; and a command-line pack (a project folder in, the `packed` folder out, through REDbridge) that the shared build workflow can run on a GitHub runner |
| GitHub | Mod repositories, pushes, releases, the webhook and the registry pull request are made with the modder's own GitHub account, through VS Code's GitHub sign-in (`public_repo`, `write:repo_hook` and `workflow`), so the modder never has to visit GitHub. Builds run on GitHub Actions in the mod's repository, through EDGEmods' shared workflow |
| EDGEweb | Owns https://edgemodders.ai, the platform's site; EDGEmods has its own domain, https://edgemods.ai. EDGEweb can link to it |
| EDGEkit, EDGEchat (the Claude Code plugin, named EDGEplugin until 2026-10-17) | Bundle EDGEmods, and teach it to the assistant, once released |

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
| **R5 Publish** | The publishing form, REDcode's button, the git checkout and repository, the shared build workflow, Release, the registry pull request, My mods, contributing and reviewing pull requests | A non-coder publishes a mod from REDcode and sees its page; a second modder's pull request is merged and released, and the card shows "Updated" |
| **R6 Ship** | The agent review, docs, the MCP package, Open VSX and Marketplace, the EDGEkit bundle | Someone outside the team publishes a mod from the docs alone |

## Open questions

| Question | Notes |
|---|---|
| The metadata format and the publishing form's fields | The format is drafted on its own page, [edgemods.json](manifest.html) (proposed, for the owner's review); the form's fields follow it |
| Which malware scanner | ClamAV runs in the merge checks now (R2). VirusTotal as a second scanner waits on a reading of its terms for this use |
| What the agent review tags and refuses | The owner defines it before R6 |
| Nexus | Cross-posting, linked both ways? EDGEdeck already speaks to Nexus. **Listings from other sites** (the owner, 2026-11-23: mods from other sites shown like EDGEmods mods, with a Source filter, linking back, no files) are set aside: Nexus Mods' [Terms of Service](https://help.nexusmods.com/article/18-terms-of-service) (section 11) forbid scraping without an exemption from support@nexusmods.com, and the [API policy](https://help.nexusmods.com/article/114-api-acceptable-use-policy) forbids bulk fetching to rehost. Descriptions and images belong to each mod's author. The plan, if it comes back: a listings file format, a signed import into its own `listings.db`, a Source filter, and a takedown report |
| Other git hosts | GitHub only for now |
| Narrower GitHub access | If modders object to granting all their public repositories: an EDGEmods GitHub App installed on selected repositories only. To find out first with a test App: can it create the repository for the modder, and can a new repository join the installation without GitHub's install page? |
| Privacy | No tracking on the website; the extension calls the network only when the user asks for something that needs it |
| The subscription's price and the free speed | The owner's choice |
| Modders and the subscription | Does part of the subscription go to modders, as Nexus Mods' Donation Points do? Modders should at least be told plainly, when they publish, that EDGEmods sells download speed |
| Non-commercial licences | Some mods use licences that forbid commercial use (such as CC BY-NC). EDGEmods streams free downloads from its own server and sells faster ones; whether that counts as commercial use of such a mod needs a lawyer's reading before launch. Not legal advice |

## Sources

| Source | What it gave |
|---|---|
| The owner, 2026-10-17 | The idea, goals 1 to 10, and every decision on this page |
| [R0 research](research.html) | Prior art, GitHub mechanics, legal, TheLostRealms' sign-in, house style |
| [EDGEdeck design](https://edgemodders.github.io/EDGEdeck/design.html) | Installing, families, the Nexus client |
| [REDcode API](https://edgemodders.github.io/REDcode/api.html) | `REDcodeApi` version 1 |
