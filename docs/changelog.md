# Changelog

What changed in each EDGEmods release, for players and modders. Each release takes its notes from its section here: the GitHub release, written by the release workflow once there is one.

The server and the extension have their own tags (`server-vX.Y.Z`, `extension-vX.Y.Z`; see [the design](design.html)). This file is the server's and the website's. The extension gets its own `CHANGELOG.md` in its folder when it is built, because the VS Code Marketplace and Open VSX show that one.

How to keep it (the convention in every Edgemodders repo, 2026-10-19):

- With each change a player or modder would notice, add a line under **Unreleased** in the same commit, in its group: **New**, **Changed**, **Fixed** or **Other**. One change per line. Leave out what only the tests see.
- Before a release, rename **Unreleased** to `## <version> (<date>)` and start a new empty **Unreleased** above it. The release workflow will stop if the version has no section.
- Links are full URLs, since the same text goes to GitHub and other sites.

## Unreleased
