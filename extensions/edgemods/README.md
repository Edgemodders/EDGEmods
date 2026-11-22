# EDGEmods for VS Code

**Preview, not released yet.** The EDGE mod registry for Cyberpunk 2077, in VS Code: sign in to [EDGEmods](https://edgemods.ai), and soon find mods and install them, with everything they need, through [EDGEdeck](https://github.com/Edgemodders/EDGEdeck).

## What it does now

| Feature | How |
|---|---|
| Sign in | **EDGEmods: Sign in** from the Command Palette, the EDGEmods item in the status bar, or VS Code's Accounts menu. Pick GitHub, Google or Email and password, the same way you signed in on the website. Your browser opens; when you have signed in, it hands you back to VS Code |
| Your username | Other people see your username, never your name or email. Signing in from VS Code for the first time asks for one |
| Mod manager links | The website's **Mod manager** button opens an `edgemods:` link. EDGEdeck 0.33.0 or newer passes it here; for now it opens the mod's page, and installing comes next |

Coming next: browsing mods in VS Code, installing a mod with its requirements through EDGEdeck, and tools for AI assistants (MCP).

## Settings

| Setting | What it is |
|---|---|
| `edgemods.site` | The EDGEmods site: `https://edgemods.ai`. A developer running the website on their PC sets `http://localhost:8800`. Only https, or http on this PC, is used, and only from your user settings, so a folder you open cannot change it |

## Privacy

Nothing is sent anywhere until you sign in or ask for something that needs EDGEmods. Your sign-in is kept in VS Code's secret storage. The extension never uses VS Code's own GitHub sign-in for EDGEmods.

MIT licensed. Source and design: https://github.com/Edgemodders/EDGEmods
