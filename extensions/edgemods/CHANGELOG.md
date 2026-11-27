# Changelog

What changed in each release of the EDGEmods extension for VS Code. The Marketplace and Open VSX show this file; the website's and server's changes are in [docs/changelog.md](https://github.com/Edgemodders/EDGEmods/blob/main/docs/changelog.md). Same convention as every Edgemodders repo: a line under **Unreleased** with each change a player or modder would notice, grouped **New**, **Changed**, **Fixed**, **Other**; renamed to the version at each release.

## Unreleased

### New

- Sign in to EDGEmods from VS Code with GitHub, Google or an email address: the same account as on the website. Your browser opens Auth0's page and hands the sign-in back to VS Code; you stay signed in.
- Your EDGEmods username in the status bar and in VS Code's Accounts menu, with your account, a username change and Sign out one click away.
- Signing in from VS Code for the first time asks you to choose your username there.
- EDGEmods in the activity bar, with a jigsaw puzzle piece for its icon: search mods, and the lists Updated, New, Most downloaded, Most liked and Your likes.
- A mod's page in an editor tab, in the website's look: About, Files, Versions and Requirements, likes, reporting a mod, and Manual download to a folder you pick, each file checked against the one EDGEmods checked.
- EDGEmods: Find a mod, from the Command Palette: search as you type, and open the mod's tab.
- After signing in, your browser shows an EDGEmods page that says to go back to VS Code, and VS Code says who you are signed in as.
- Assistants can find mods too: Claude Code and the agents in VS Code get `mods_search`, `mods_info` (a mod in full) and `mods_plan` (what installing it brings, requirements first). Agents in VS Code see them by themselves; **EDGEmods: Connect an assistant (MCP)** gives Claude Code the line to add them. They need no sign-in.
- EDGEmods links from the website's Mod manager button (through EDGEdeck 0.33.0 or newer) open the mod's tab in VS Code and install the mod.
- Install a mod with everything it needs, through EDGEdeck 0.34.0 or newer: from the website's Mod manager button, the Install button on a mod's tab, or **EDGEmods: Install a mod**. You see what comes, why, and what EDGEdeck has already, then say yes. Every file is checked against the one EDGEmods checked before EDGEdeck adds anything, and if any mod fails, nothing is installed. EDGEdeck turns the mods on, and you deploy when you are ready.
- A mod with a choice of files asks which one you want, and offers its optional files.
- REDnode mods have their own type in the side panel and for assistants (`mods_search` with type `rednode`).
- A mod's tab shows what EDGEdeck has of it (the version, and whether it is in the game) and offers an update when a newer version is out.
- Without EDGEdeck, installing offers to get it or to save the files instead.
- Assistants can install too: `mods_install` asks VS Code, which shows you what the mod brings and waits for your yes.
