# EDGE<span class="y">mods</span> docs

EDGEmods is the EDGE mod registry for Cyberpunk 2077: a website that lists mods hosted in their authors' own git repositories and renders each mod's page from its repository, and a VS Code extension with an MCP server that browses, installs and publishes them. This site is EDGEmods' developer documentation; the mod website itself does not exist yet.

| Document | What it covers |
|---|---|
| [Design](design.html) | The owner's goals, the mod lifecycle, the registry and its merge checks, a mod's repository, the website, accounts, the extension, how it fits with the other tools, phases, open questions. Draft 0.2: decided and proposed sections marked |
| [Format](manifest.html) | `edgemods.json`, the metadata every mod's repository carries: fields, release files, requirements, the checks. Proposed, format version 1 |
| [Website prototype](prototype.html) | A clickable prototype of edgemods.ai, and what it asks of the server |
| [Registry](registry.html) | The registry files, the merge checks step by step, the workflow's safety rules, the owner's GitHub setup |
| [R0 research](research.html) | Prior art, GitHub mechanics and limits, legal sources, TheLostRealms' Auth0 sign-in, the house style tokens |
| [Dev setup](dev-setup.html) | What a PC needs to work on EDGEmods |
| [REDdeck docs](https://edgemodders.github.io/REDdeck/) | The mod manager that installs what EDGEmods finds |
| [REDcode docs](https://edgemodders.github.io/REDcode/) | The editor whose projects EDGEmods publishes |

## Roadmap status

As of 2026-10-17.

| Phase | Status |
|---|---|
| R0 Design | In progress: draft 0.2 |
| R1 Format | Built for review: schema, validator, folder and release checks, example |
| R2 Registry and checks | Built for review: the registry folder, the merge checks, the workflow. The GitHub App is set up; no real publish has been through yet |
| R3 Website | Prototype built for the owner's review; the server not started |
| R4 Browse and install | Not started |
| R5 Publish | Not started |
| R6 Ship | Not started |

The phases are proposed and may change when R0 is agreed.

Source code and issues: [github.com/Edgemodders/EDGEmods](https://github.com/Edgemodders/EDGEmods)
