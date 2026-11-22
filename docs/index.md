# EDGE<span class="y">mods</span> docs

EDGEmods is the EDGE mod registry for Cyberpunk 2077: a website that lists mods hosted in their authors' own git repositories and renders each mod's page from its repository, and a VS Code extension with an MCP server that browses, installs and publishes them. This site is EDGEmods' developer documentation. The mod website is being built: a read-only version runs on a PC ([Dev setup](dev-setup.html#run-the-website-on-this-pc)); it is not live at edgemods.ai yet.

| Document | What it covers |
|---|---|
| [Design](design.html) | The owner's goals, the mod lifecycle, the registry and its merge checks, a mod's repository, the website, accounts, the extension, how it fits with the other tools, phases, open questions. Draft 0.2: decided and proposed sections marked |
| [Format](manifest.html) | `edgemods.json`, the metadata every mod's repository carries: fields, release files, requirements, the checks. Proposed, format version 1 |
| [Website prototype](prototype.html) | A clickable prototype of edgemods.ai, and what it asks of the server |
| [Registry](registry.html) | The registry files, the merge checks step by step, the workflow's safety rules, the owner's GitHub setup |
| [R0 research](research.html) | Prior art, GitHub mechanics and limits, legal sources, TheLostRealms' Auth0 sign-in, the house style tokens |
| [Dev setup](dev-setup.html) | What a PC needs to work on EDGEmods |
| [Mod manager links](links.html) | The `edgemods:` link a mod page's Mod manager button opens, and what a mod manager does with it |
| [Auth0 setup](auth0-setup.html) | The owner's checklist for the Auth0 tenant, the GitHub OAuth App and the settings file |
| [Changelog](changelog.html) | What changed in each release of the server and website |
| [EDGEdeck docs](https://edgemodders.github.io/EDGEdeck/) | The mod manager that installs what EDGEmods finds |
| [REDcode docs](https://edgemodders.github.io/REDcode/) | The editor whose projects EDGEmods publishes |

## Roadmap status

As of 2026-11-22.

| Phase | Status |
|---|---|
| R0 Design | In progress: draft 0.2 |
| R1 Format | Built for review: schema, validator, folder and release checks, example |
| R2 Registry and checks | Built for review: the registry folder, the merge checks, the workflow. The GitHub App is set up; the first real publish (a test mod, pull request #1) passed and merged by itself |
| R3 Website | Prototype reviewed by the owner (2026-10-23). Started in slices R3a to R3h. Built: R3a, the indexer (`packages/indexer`); R3b, the read-only website (`packages/server`: home, browse and search, mod pages, images, the install plan); R3c, accounts (Auth0 sign-in, sessions, likes, the Account page), tested against a stand-in for Auth0; the owner signed in with GitHub, Google and email on the development tenant (2026-11-21); R3d, downloads (the download link, counts, Downloaded mods), tested on a PC only: free speed through nginx waits for the deploy; R3e, the Admin page (mods, users, reports, the blocklist, spot review, the log) |
| R4 Browse and install | Started 2026-11-22 in slices R4a to R4d. Built: R4a, the extension's foundations and sign-in (`extensions/edgemods`: sign in from VS Code through Auth0, the username, the account in the status bar; the server takes its access tokens), tested against stand-ins for Auth0 and the site; the owner's hand test passed on 2026-11-22 (GitHub, Google and email, on the development tenant). R4b, browse, built 2026-11-22 for the owner's hand test: the EDGEmods side panel (search; Updated, New, Most downloaded, Liked), a mod's page in an editor tab (the website's own page: likes, reports, manual download checked against its SHA-256), EDGEmods: Find a mod, and the sign-in's landing page in the browser (`/auth/vscode`) |
| R5 Publish | Not started |
| R6 Ship | Not started |

The phases are proposed and may change when R0 is agreed.

Source code and issues: [github.com/Edgemodders/EDGEmods](https://github.com/Edgemodders/EDGEmods)
