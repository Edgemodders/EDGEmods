# Mod manager links

A mod's page on EDGEmods has two buttons: **Mod manager** and **Manual download**. Manual download gives you the file itself. Mod manager opens an `edgemods:` link, and whichever mod manager on your computer has registered for those links installs the mod, with everything it needs. This page is the link's format, for anyone writing a mod manager that supports it.

**Status:** decided with the owner on 2026-11-21. The website makes these links since that day. **EDGEdeck 0.33.0 or newer** (released 2026-11-22; [EDGEdeck#16](https://github.com/Edgemodders/EDGEdeck/issues/16)) registers for them and passes each to the EDGEmods extension, which is not built yet (R4). Until then EDGEdeck says the extension is needed.

## Why its own kind of link

Nexus Mods' `nxm:` links name a Nexus mod and file number, and the program that receives one fetches the file from Nexus with the player's Nexus key. Sent an EDGEmods mod, Vortex or Mod Organizer would ask Nexus for it and fail. So EDGEmods has its own kind of link, which works the same way: a mod manager registers for it with the operating system, and gets every `edgemods:` link the player opens.

## The format

```
edgemods://install/<mod>/<version>
```

| Part | What it is |
|---|---|
| `install` | What to do. The only action so far |
| `<mod>` | The mod's id on EDGEmods, such as `street-cred` (lower case, digits and `-`; see [the format](manifest.html)) |
| `<version>` | The release the player picked, such as `1.0.0`. Install that release, not "the newest": the player may have picked an older one on the Versions tab |

Both parts are percent-encoded. Unknown actions, missing parts or anything else after them are ignored by the handler, which says the link is not one it understands.

**No query string and no `#`.** A link never has `?` or `#` in it. EDGEdeck passes the whole link inside its own `vscode://` link unencoded, which is safe only because of that. Anything a later action needs goes in the path; a change to this rule needs EDGEdeck's agreement first.

The link carries no web address. The handler asks the EDGEmods site it is set to use: `https://edgemods.ai` by default; a developer's PC may set `http://localhost:8800`. A link must never be able to point a handler at another server.

## What a handler does

1. **Asks first.** Any web page can open an `edgemods:` link, so the handler never acts on one by itself. It reads the install plan (step 3), then asks: "Install Street Cred 1.0.0 and 1 requirement?", naming them, with Install and Cancel.
2. **Signs in.** Downloads from EDGEmods need a free account. The handler signs in to EDGEmods through Auth0 in the browser, as the EDGEmods extension does, and keeps the sign-in for next time.
3. **Reads the install plan:** `GET <site>/api/v1/mods/<mod>/install-plan?version=<version>`. It lists every mod to install, requirements first, each with its version and files: name, size, SHA-256 and the EDGEmods download link. It also lists outside requirements to get by hand, and problems. If it has problems (two requirements that cannot both hold, a loop, a mod that is gone), the handler stops and shows them; nothing is downloaded.
4. **Downloads every file** through the plan's download links, with the sign-in, and checks each against its SHA-256. A failed download or a wrong hash stops here, with nothing in the game changed.
5. **Installs in the plan's order**, requirements first, all or nothing: if one fails, the ones this run installed are undone, and the message names the mod, the step and the reason.

The [design](design.html#installing-a-mod-and-its-requirements) has the reasons behind each step.

## Registering for the links

On Windows, a program registers for `edgemods:` links under the current user's registry, as for `nxm:`:

```
HKEY_CURRENT_USER\Software\Classes\edgemods
    (Default)      = "URL:EDGEmods link"
    URL Protocol   = ""
    shell\open\command
        (Default)  = "<the program>" "%1"
```

Only one program can hold it at a time. A mod manager that takes it over should say so, and offer to give it back, as EDGEdeck does for `nxm:` links.

## In EDGE

| Tool | Its part |
|---|---|
| EDGEdeck | Registers for `edgemods:` links when nothing else holds them, quietly, and runs the editor straight (`"<Code.exe>" --open-url -- "vscode://edgemodders.edgedeck/edgemods?url=%1"`, no shell, since any web page can open these links). It checks only the `edgemods:` scheme, then activates `edgemodders.edgemods` and awaits its `openLink(url)` with the whole link. Without the extension it says the extension is needed, with a button that shows it; with one that has no `openLink`, it asks to update it. A Set up step appears only while another program holds the links. Owns installing: installs the downloaded mods into the loadout, all or nothing (`installMods`, `edgemodsMods()`, parts 2 and 3 of [EDGEdeck#16](https://github.com/Edgemodders/EDGEdeck/issues/16), built when R4 is near). Part 1 released in EDGEdeck 0.33.0 (2026-11-22), the lowest version that handles the links; not yet tried with a real browser click |
| The EDGEmods extension (R4) | Exports `openLink(url: string): Promise<void>` from `activate()`, which EDGEdeck calls with the whole link. It asks, signs in, reads the plan, downloads and checks the files, then hands them to EDGEdeck's `installMods`. Before relying on that, it checks `typeof api.installMods === "function"` and names the lowest EDGEdeck version it needs |
| The website | Makes the links: the Mod manager button on a mod's page, and on each release in the Versions tab |
