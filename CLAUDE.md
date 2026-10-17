# EDGEmods: notes for Claude sessions

EDGEmods is the EDGE mod registry for Cyberpunk 2077. It is three things: a registry of mods hosted in their authors' own git repositories, a website that renders each mod's page from its repository, and a VS Code extension (`edgemodders.edgemods`, proposed) with an MCP server that browses and installs mods and publishes a REDcode project as a mod. EDGEmods hosts no mod files. Read [docs/design.md](docs/design.md) first.

## Status and next step

- Scaffold created 2026-10-17 by the REDcode session: README, license, docs site (HUD layout, dev setup), brand sources and images (icon "EM", activity bar icon), Pages workflow. No code, no mod website.
- **Design draft 0.2 (2026-10-17)** marks each section of `docs/design.md` **Decided** or **Proposed**. Decided with the owner: goals 1 to 10 (the idea table); publishing lives in the EDGEmods extension, opened from a REDcode project button; a mod gets on the registry by an auto-merged pull request when a chain of merge checks passes (structure and binary/malware at launch, an agent content review soon after); each repo is its modder's responsibility; a Node service with `node:sqlite` and Litestream; Auth0 accounts (any account browses, downloads and installs; GitHub required to publish); anonymous browsing, with downloads and a mod's origin behind sign-in as a soft gate; site-only download counts and likes; files per release with a role and note; requirements as EDGEmods mods or external links. The research behind it is in `docs/research.md`; do not redo it.
- **The owner started the build on 2026-10-17**, with the website at https://edgemods.ai. R1 (the `edgemods.json` format, `packages/format`, the example in `examples/example-mod`, the page `docs/manifest.md`) is built for the owner's review; the format stays "proposed" until they agree it. Proposed sections of the design are built on but stay marked proposed until the owner says otherwise.
- **R2 built 2026-10-17** (`packages/checks`, `.github/workflows/registry.yml`, `registry/`, `docs/registry.md`) for review. The EDGEmods GitHub App (`edgemods-registry`, id 5359107) was set up 2026-10-17 and passes the hand-run App check workflow. First end-to-end test the same day, with the owner's go-ahead: test mod `CyberbuildsAI/edgemods-test-mod`, PR #1, passed and auto-merged; it is in `registry/CyberbuildsAI/` and stays as the R3 indexer's first real mod unless the owner says to remove it. Further public tests (new repositories, pull requests): ask the owner first.
- **Website prototype built 2026-10-17** (`docs/prototype/`, explained in `docs/prototype.md` with what it asks of the server). Plain HTML/CSS/JS, invented data, a "view as" strip for visitor, player, modder, admin.
- **Next:** the owner's review of the prototype and its server needs; then R3, the server. File the first `request` issues (REDdeck: install from a downloaded archive; REDcode: the publish button) once the owner agrees their shape.
- **Format rules live in one place:** `packages/format/src/limits.ts` and `validate.ts`. The JSON schema is generated from them (`npm run schema --workspace packages/format`); a test fails if the committed schema is stale.
- **Auth0 template:** the owner's TheLostRealms app (`E:\Development\TheLostRealms\thelostrealms`). Its `Server/` is Business Source License; the proposal is to base EDGEmods code on its Apache-2.0 `Registry/` sign-in and keep the notice. Do not change that repo.
- At the start of each session: read this repo's open issues labelled `request` (needs from other EDGE repos), and check whether the requests EDGEmods filed elsewhere have answers.

## The EDGE platform

EDGE is an AI-first modding platform for Cyberpunk 2077, by the same owner as every repo below (GitHub organisation Edgemodders). EDGEmodders is the community and organisation; EDGE is the platform brand. Each tool has its own repo and its own `CLAUDE.md`; most are checked out as siblings of this one under `E:\Modding\Cyberpunk 2077\` (EDGEbuilder is not, on this machine: read it on GitHub). Read a sibling's notes and design before relying on it; another session may be working in it right now.

| Tool | What it is | What EDGEmods gets from it |
|---|---|---|
| REDdeck | The mod manager extension (`edgemodders.reddeck`): library, deploy with a manifest, undo, conflicts, load order, Nexus downloads and nxm links, families of versions | **Owns installing.** EDGEmods hands downloads to it. `REDdeckApi` version 1 from `activate()` has `installProject`, `deploy`, `turnOff`, but no install from a downloaded archive yet: a likely first request |
| REDcode | The editor (`edgemodders.redcode-cyberpunk`): WolvenKit projects, pack, install through REDdeck | **Owns the project and packing.** `REDcodeApi` version 1 ([api.md](https://edgemodders.github.io/REDcode/api.html)): `project()`, `pack()`. Its release workflow already builds a Nexus zip, a model for the mod download |
| REDbridge | WolvenKit's engine behind JSON-RPC, GPL-3.0 | Reading a mod archive's contents for its page (`archive.openMod`), if R0 wants a file list. Only as a separate process |
| REDnode | The runtime: mods and HTML overlays in the running game, an MCP server | REDnode packages are one kind of mod EDGEmods lists |
| REDagent, EDGEplugin | The in-game assistant and the Claude Code plugin | Users of EDGEmods' MCP tools |
| EDGEweb | The website https://edgemodders.ai and its wiki | **Owns the domain.** Where the mod website lives is a decision with the owner and EDGEweb |
| EDGEkit | The branded editor and the extension pack `edgemodders.edgekit` | Bundles EDGEmods once it is released; ask with a `request` issue then |
| EDGEwave, EDGEmat, EDGEfab, EDGEquest, EDGEbuilder | The studios: sound, materials, assets, quests, world building | Their output is what gets published as mods |

**How the tools work together:** when two tools are installed, one owns each job and the others call it, through an exported extension API or MCP tools, never by importing each other's code. Each still works alone, with a fallback. Before building anything in another tool's domain (installing, packing, the game folder, Nexus), check whether that tool does it and agree a small entry point with the owner.

## Conventions

- Same as the sibling repos (see REDcode's and EDGEfab's CLAUDE.md): commit straight to `main` in small logical commits and push; agree the plan in chat first; PRs only for large or risky changes. Plain, short sentences; tables for comparisons and facts; mark anything unverified as unverified.
- **Git identity:** per repo, `CyberbuildsAI` with the GitHub no-reply email (`340969962+CyberbuildsAI@users.noreply.github.com`), plus `credential.https://github.com.username CyberbuildsAI`, all set in this checkout. Never change the global identity. Push with `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never timeout 120 git push`; if it still blocks on a sign-in window, tell the owner rather than retrying.
- **Never commit game files**, WolvenKit binaries, mod archives, or data extracted from the game. Test mods live in their own repositories.
- **Publishing is outward-facing.** Anything that creates a repository, pushes, makes a release or adds to the registry under someone's account needs that person's clear yes at the time, in the product as in development. Never publish a test mod under the owner's account without asking.
- **Untrusted input:** mod READMEs, manifests and images come from strangers. Sanitize everything the website or a webview renders; never run anything from a mod repository.
- **License boundary:** this repo is MIT. Talk to REDbridge (GPL-3.0) only as a separate process. Each mod keeps its author's license; the registry links, it does not relicense.
- **Do not change other EDGE repos from here**; other sessions work in them. Needs go to them as issues labelled `request` on their repo, with the shape that would work.
- **The mission decides UI questions:** modding for everyone, especially non-coders; easy, fun, fast. Plain words first, raw values one click away. Every feature ships in the UI and the MCP server together. AI is optional, and so is the network: no calls or telemetry until the user asks for something that needs them.
- Keep `extensions/edgemods/src/core` free of VS Code imports; the MCP server bundles it.
- **House style** is the HUD look from REDnode's design doc; the REDnode HUD theme (`edgemodders.rednode-hud-theme`, in REDcode's repo) is the default theme for any VS Code UI, and the mod website should look like part of the same family.
- **Docs site:** `docs/` is the developer docs, published by GitHub Pages through `.github/workflows/pages.yml` at https://edgemodders.github.io/EDGEmods/. It is not the mod website. `docs/index.md` is the landing page (document ledger and roadmap status); add every page to `nav` in `docs/_config.yml`. Brand images come from `tools/brand/render.ps1`; re-run it when a badge changes. Record every tool install in `docs/dev-setup.md`, with versions and exact commands.
- **Shell pitfalls on this machine:** Bash heredocs and `node -e` strings eat backslashes in Windows paths; write such text with the Write or Edit tool, or a script file.
