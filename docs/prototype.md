# Website prototype

A clickable prototype of https://edgemods.ai, built on 2026-10-17 so the owner can shape the website before the server (R3) is designed around it. **[Open the prototype](prototype/index.html).**

It is plain HTML, CSS and JavaScript in [`docs/prototype`](https://github.com/Edgemodders/EDGEmods/tree/main/docs/prototype), with invented mods, authors and numbers, and no server. The strip at the top switches who is looking: a **visitor** (not signed in), a **player** (signed in with email or Google), a **modder** (signed in with GitHub, owns two mods) or an **admin**. Likes and settings are kept in the browser only.

| Page | What it shows |
|---|---|
| [Home](prototype/index.html) | Counts, the mod types, rails of new, recently updated and most liked mods |
| [Browse](prototype/browse.html) | Search, sort, facets with counts (type, tags, requirements, "no game plugins"), active filters as chips, all kept in the address |
| [A mod](prototype/mod.html?id=arasaka-tactical-wear) | Gallery, actions, facts, what the download contains, and tabs for the page, the files (required, choose-one groups, optional), versions and requirements |
| [Account](prototype/me.html?as=modder) | Liked mods, My mods (or how to publish, without GitHub), settings |
| [Admin](prototype/admin.html?as=admin) | Overview and spot review, mods, users, reports, the blocklist, the audit log |
| [Publish](prototype/publish.html) | How publishing from REDcode and VS Code works |

## What the website asks of the server

The point of building the prototype first: each item below is something the R3 server has to provide. All are proposals for the owner to confirm or change.

| Area | The server needs |
|---|---|
| Mod cards | Per mod: id, name, short description, author's name, type, tags, version, size, downloads, likes, first published, last updated, and flags: runs code, adult. **Size** is the required files plus the first file of each choose-one group |
| Search and facets | Search over name, short description, tags and author name. Facets with counts: type (any of), tags (all of), requirements (all of), no game plugins. Sorts: newest, recently updated, most downloaded, most liked, name. Paging. The browse page's address is the query |
| What visitors may not see | For visitors the API leaves out download links, the repository address, the author's GitHub login (it gives the repository away) and adult mods: hidden in the data, not only in the page |
| The mod page | The README rendered to safe HTML on the server; images served from EDGEmods' own cache; each release's version, date, notes and files (role, group, title, note, size); requirements (the whole mod's and each file's) resolved to EDGEmods mods with their version ("1.2.0 or newer", "exactly 2.0.0") or labelled as outside links |
| What a download contains | Per release file: kinds of files, which files run code, SHA-256, scanner and scan date. These come from the merge checks, so **the indexer runs the downloads step on every new release**, and the server machine needs ClamAV and 7-Zip too |
| Release notes | Where a version's notes come from: the GitHub release's text (sanitized), or `CHANGELOG.md`. To decide |
| Install plan | The mod with its chain of requirements, resolved on the server: mods in install order, versions chosen, files with sizes, hashes and download links, outside links, problems. See [installing](design.html#installing-a-mod-and-its-requirements) |
| Downloads | One endpoint per file that counts, then redirects to GitHub. Repeats from the same account count once per file per day. "Install in VS Code" opens `vscode://edgemodders.edgemods/install?mod=…&version=…` |
| Likes | One per account per mod, toggled; a list of liked mods |
| Settings | Show adult mods (off by default, never for visitors); download my data; delete my account |
| My mods | The modder's mods by their GitHub id (from the Auth0 GitHub sign-in), **including publish attempts whose checks failed**. So the registry workflow reports each result to the server (with the registry secret), not only on the pull request |
| Reports | Signed-in people report a mod with a reason; admins see a queue and close reports |
| Admin | Overview counts; spot review of recently merged mods, marked reviewed; mods: edit EDGEmods' tags, type, featured, hide, remove (which opens a pull request deleting the registry file, so the server needs the GitHub App too); users: sign-in method, joined, last seen, block; the private blocklist (GitHub accounts, repositories, site accounts, with a private reason); the audit log |

## Open points for the owner

| Point | In the prototype |
|---|---|
| Adult mods | Hidden from visitors; signed-in people opt in from settings |
| "Runs code" | A red tag on cards and a plain warning on the mod page for mods with game plugins (`.dll`, `.asi`) or programs |
| Featured mods | An admin action exists; the home page does not show a featured rail yet |
| Comments, bug reports | Not in the prototype. The mod's GitHub issues, or EDGEmods' own? |
| The home page | Counts, types and three rails. Anything else? |
