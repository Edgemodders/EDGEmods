# Changelog

What changed in each EDGEmods release, for players and modders. Each release takes its notes from its section here: the GitHub release, written by the release workflow once there is one.

The server and the extension have their own tags (`server-vX.Y.Z`, `extension-vX.Y.Z`; see [the design](design.html)). This file is the server's and the website's. The extension gets its own `CHANGELOG.md` in its folder when it is built, because the VS Code Marketplace and Open VSX show that one.

How to keep it (the convention in every Edgemodders repo, 2026-10-19):

- With each change a player or modder would notice, add a line under **Unreleased** in the same commit, in its group: **New**, **Changed**, **Fixed** or **Other**. One change per line. Leave out what only the tests see.
- Before a release, rename **Unreleased** to `## <version> (<date>)` and start a new empty **Unreleased** above it. The release workflow will stop if the version has no section.
- Links are full URLs, since the same text goes to GitHub and other sites.

## Unreleased

### New

- Signing in from VS Code ends on an EDGEmods page in your browser that says to go back to VS Code, instead of on Auth0's page.
- Sign in with GitHub, Google or an email address, through Auth0. Signed in, you can see where each mod comes from; browsing still needs no account.
- Likes: a heart on every mod card and mod page, a Most liked sort on the browse page, and your liked mods on your account page.
- Usernames: after your first sign-in you choose the name other people see on EDGEmods; your real name and email stay private. It can change once in 60 days.
- Your account page: your profile, liked mods, your published mods (with a GitHub sign-in) and settings, including whether to show adult mods.
- Downloads: signed in, download any file of a mod from its Files and Versions tabs. Mod cards and pages show how many times a mod was downloaded, and Browse can sort by Most downloaded.
- Downloaded mods, on your account page: every mod you downloaded, the version you got, and a note when a newer version is out.
- Admins have an Admin page, from the account menu.
- Report a mod to the admins from its page, when it does not work, looks harmful, is someone else's work or is adult content not marked 18+.
- The Admin page has tabs: an overview with the newest releases to look over, mods (hide, block, mark 18+), users (block and unblock), reports, the blocklist (GitHub accounts and repositories) and the log.
- Download everything EDGEmods keeps about you, and delete your account.
- Email-and-password accounts can ask for a link to change their password.
- The EDGEmods extension for VS Code can sign in to the website: the same account, with its downloads counted the same way.

### Changed

- A mod's page has two buttons: Mod manager, which opens your mod manager (EDGEdeck, or another that supports EDGEmods links) to install it with its requirements, and Manual download.
- Page headers wear the EDGE banner's background: its grid and a yellow glow from the bottom left.
- The filters column on the left scrolls with a thin yellow line instead of the browser's own scrollbar.

### Fixed

- "1 months ago" now reads "1 month ago".
