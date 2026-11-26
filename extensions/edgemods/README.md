# EDGEmods for VS Code

**Preview, not released yet.** The EDGE mod registry for Cyberpunk 2077, in VS Code: sign in to [EDGEmods](https://edgemods.ai), find mods and install them, with everything they need, through [EDGEdeck](https://github.com/Edgemodders/EDGEdeck).

## What it does now

| Feature | How |
|---|---|
| Sign in | **EDGEmods: Sign in** from the Command Palette, the EDGEmods item in the status bar, or VS Code's Accounts menu. Pick GitHub, Google or Email and password, the same way you signed in on the website. Your browser opens; when you have signed in, it hands you back to VS Code |
| Your username | Other people see your username, never your name or email. Signing in from VS Code for the first time asks for one |
| Find mods | The EDGEmods icon in the activity bar: search, and the lists Updated, New, Most downloaded, Most liked and Your likes. **EDGEmods: Find a mod** searches from the Command Palette. A mod opens in an editor tab, in the website's look |
| Install | The **Install** button on a mod's tab, **EDGEmods: Install a mod**, or the website's **Mod manager** button. You see what comes and why, then say yes. Every file is checked before EDGEdeck (0.34.0 or newer) adds the mods, all or nothing, and turns them on; you deploy when you are ready. Without EDGEdeck, you can save the files instead |
| Assistants (MCP) | Agents in VS Code and Claude Code get `mods_search`, `mods_info`, `mods_plan` and `mods_install`. `mods_install` asks you in VS Code before anything happens. **EDGEmods: Connect an assistant (MCP)** gives Claude Code the line to add them |

## Settings

| Setting | What it is |
|---|---|
| `edgemods.site` | The EDGEmods site: `https://edgemods.ai`. A developer running the website on their PC sets `http://localhost:8800`. Only https, or http on this PC, is used, and only from your user settings, so a folder you open cannot change it |

## Privacy

Nothing is sent anywhere until you sign in or ask for something that needs EDGEmods. Your sign-in is kept in VS Code's secret storage. The extension never uses VS Code's own GitHub sign-in for EDGEmods.

MIT licensed. Source and design: https://github.com/Edgemodders/EDGEmods
