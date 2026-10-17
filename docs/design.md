# EDGE<span class="y">mods</span> design

EDGEmods is a mod website for Cyberpunk 2077 that hosts nothing itself. Every mod lives in its author's own git repository. EDGEmods is a **registry**: a list of those repositories, and a website that renders a page for each mod from what is in its repository. A VS Code extension, also called EDGEmods, browses and installs the mods, and publishes a REDcode project as a mod in one guided step. The other EDGE tools read the same registry.

**Status: draft 0.1, a starting brief.** Written on 2026-10-17 by the REDcode session that scaffolded this repo, from the owner's description of the idea that day (summarized under "The idea"). Everything else here is a proposal or marked *open* or *unverified*, for EDGEmods' own first session to settle with the owner. That session replaces this page, section by section, with the real design. Next: R0.

## The idea, as the owner put it

| Point | In practice |
|---|---|
| A mod hosting website that the EDGE tools and extensions interact with | One registry, read by the website, the EDGEmods extension, REDdeck and the assistants |
| Only a registry that pulls in mods hosted on git | EDGEmods stores no mod files. The repository is the source of truth: text, images, versions and downloads |
| An EDGEmods extension for browsing the mods on the website | Browse, read a mod's page, install it, in VS Code |
| The extension publishes a REDcode mod to git, packaged in a certain way (a special README, an image folder, and so on) | A fixed layout for a mod's repository, so the website can render the mod's page from it |

## Mission

EDGE brings modding to everyone, especially non-coders: easy, fun and fast. Sharing a mod today means a hosting site's upload forms, a page written in its markup, and screenshots uploaded one by one, repeated for each version. With EDGEmods, the mod's repository already is its page. Publishing a new version is a release, made by one action in the editor.

| Rule | In practice |
|---|---|
| The author owns everything | Files, text, images and history stay in the author's repository. Leaving EDGEmods loses nothing |
| One action to publish | From a REDcode project: check, describe, add images, push, release, register |
| The page comes from the repository | No second copy of the description to keep in step |
| Everything the UI does, an assistant can do | Each feature ships in the UI and the MCP server together |
| Open and inspectable | The registry is a public list; anyone can read it, build on it, or mirror it |

## Prior art, to study in R0

How other projects run a registry over repositories they do not host. From memory; R0 checks each one and records what to copy and what to avoid.

| Project | How it works (unverified details) | Worth studying for |
|---|---|---|
| Obsidian community plugins | A JSON list in one GitHub repository; authors add their plugin with a pull request, which is reviewed. The app reads a manifest and README from each plugin's repository and downloads release assets | The closest model: review on entry, releases as downloads |
| Homebrew taps, Scoop buckets | Git repositories of small manifests that point to downloads elsewhere | Manifests as plain files in git |
| pkg.go.dev | Indexes modules straight from version control and renders their docs | Pages rendered from the repository |
| Nexus Mods, Thunderstore | Host the files themselves, with accounts, uploads and moderation | What EDGEmods does differently, and what modders will expect anyway (endorsements, requirements, file lists) |

## A mod's repository (proposed)

The layout the EDGEmods extension writes and the website reads. Names are proposals.

| Path | What it is |
|---|---|
| `edgemods.json` | The manifest: id, name, one-line summary, author, license, version, game version, requirements (ArchiveXL, TweakXL, RED4ext, REDnode and so on, with minimum versions), kind (archive, REDmod, REDnode package, scripts), tags, cover image, gallery order |
| `README.md` | The mod page's body, in GitHub-flavored markdown |
| `images/` | Cover and gallery images, referenced by the manifest |
| `CHANGELOG.md` | Optional; the website shows it per version |
| Releases | One per version, tagged `vX.Y.Z`, with the zip laid out like the game folder (what REDcode's pack makes) as the download |
| The project itself | Optional: a REDcode or WolvenKit project, if the author shares the source |

A JSON schema for `edgemods.json` lives in this repo, so the extension, the website and any editor validate it the same way.

## How it fits together (proposed)

| Part | What it is |
|---|---|
| The registry | A list of mod repositories, kept in this repository (`registry/`). How a mod gets on it is open (see the open questions) |
| The indexer | A scheduled GitHub Actions job that reads each listed repository (manifest, README, images, releases) and writes a static JSON index |
| The website | A static site built from that index: a mod list with search and filters, and a page per mod. No server and no database, if R0 confirms that is enough |
| `extensions/edgemods` | The VS Code extension, id `edgemodders.edgemods` (proposed). Its own activity bar container, icon [`tools/brand/activity.svg`](https://github.com/Edgemodders/EDGEmods/blob/main/tools/brand/activity.svg) (HUD brackets around a grid of tiles, one color). Browse, mod page, install, publish |
| `extensions/edgemods/src/core` | Everything that is not UI. **No VS Code imports**, so the MCP server bundles it |
| `packages/edgemods-mcp` | The MCP server over stdio |

| Relationship | How |
|---|---|
| REDdeck | Owns installing and deploying. The extension's Install hands the release zip to REDdeck, as REDcode's Install does, with a direct fallback only if R0 decides one is needed. REDdeck already groups versions into families keyed by the Nexus mod id; an EDGEmods id would join it. `REDdeckApi` version 1 (checked 2026-10-17) has `installProject`, `deploy` and `turnOff` but no install from a downloaded archive: a likely first `request` issue to REDdeck |
| REDcode | Owns the project and packing. Publish reads the project (`REDcodeApi` version 1: project, pack) and the `.cpmodproj` fields (name, version, description, author). Never imports its code |
| GitHub | Repositories and releases are made with the author's own GitHub account through VS Code's GitHub sign-in. Other git hosts are open |
| EDGEweb | Owns https://edgemodders.ai. Where the website lives (a path there, or a subdomain) is the owner's decision with EDGEweb |
| The other EDGE tools | Read the index to find and suggest mods; requests as issues |
| EDGEkit, EDGEplugin | Bundled, and taught to the assistant, once released |

## The MCP server

Intent, not plumbing. Proposed names, settled in R0:

| Tool | Does |
|---|---|
| `mods_search` | Finds mods in the registry by words, tag, kind or requirement |
| `mods_info` | One mod: summary, versions, requirements, what its download contains |
| `mods_install` | Installs a mod through REDdeck |
| `mods_publish` | Publishes a REDcode project as a mod: checks it, writes the manifest and README, pushes, makes the release, and registers it, asking the user before each step that goes public |

## Phases (proposed)

For the first session to agree with the owner. The format comes first, because the website, the extension and REDdeck all depend on it.

| Phase | Builds | The test proves |
|---|---|---|
| **R0 Design** | Study the prior art, decide the open questions with the owner, write the design. The design document is the output | The owner agrees the design |
| **R1 Format** | The `edgemods.json` schema, a validator, and an example mod repository | The example validates, and a broken one is explained in plain words |
| **R2 Registry and website** | The registry, the indexer and the static website | The example mod has a page on the website, rendered from its repository |
| **R3 Browse and install** | The extension's browse view and mod page; install through REDdeck | A mod found in VS Code is installed and running in the game |
| **R4 Publish** | Publish from a REDcode project: manifest, README, images, repository, release, registration | A non-coder publishes a mod from REDcode and sees its page |
| **R5 Ship** | Docs, the MCP package, Open VSX and Marketplace, the EDGEkit bundle | Someone outside the team publishes a mod from the docs alone |

## Open questions

| Question | Notes |
|---|---|
| How a mod gets on the registry | A reviewed pull request (Obsidian), automatic discovery by a GitHub topic, or the extension filing the entry. Review costs time; no review risks spam and malware |
| Safety | Mods can carry RED4ext plugins (`.dll`) and scripts. What is checked, what the page shows about a download's contents, and how a bad mod is pulled |
| Game files in public repositories | A mod's archive contains modified game data, as a Nexus download does. Is committing a WolvenKit project's source (`source/archive`) acceptable, or do repositories carry only images, text and releases? CD Projekt RED's modding and fan content terms need reading (unverified) |
| Sizes | Git hosts limit file sizes; release assets allow far more. Large mods publish their zip as a release asset, not in git (limits unverified) |
| README rendering | Mod READMEs are untrusted input. The website must sanitize HTML and only show images from the mod's own repository or allowed hosts |
| Accounts, feedback, counts | No accounts on the site: the git host is the identity. Comments and bug reports as the repository's issues or discussions? Download counts from release statistics? Endorsements? |
| Other git hosts | GitHub first. GitLab, Codeberg or any git URL later? |
| Where the website lives | A path on edgemodders.ai, a subdomain, or GitHub Pages under the organisation. A decision with the owner and EDGEweb |
| Nexus | Cross-posting: a mod on both, linked both ways? REDdeck already speaks to Nexus |
| Updates | REDdeck or the extension checks the index for newer releases of installed mods |
| Privacy | No tracking on the website; any network calls in the extension only after the user asks |

## Sources

| Source | What it gave |
|---|---|
| The owner, 2026-10-17 | The idea |
| [REDdeck design](https://edgemodders.github.io/REDdeck/design.html) | Installing and deploying, families, the Nexus client |
| [REDcode API](https://edgemodders.github.io/REDcode/api.html) | `REDcodeApi` version 1 |
| [EDGEfab design](https://edgemodders.github.io/EDGEfab/design.html) | The family's shape, copied here |
