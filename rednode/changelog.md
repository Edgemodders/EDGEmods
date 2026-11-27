# Changelog

What changed in each release of EDGEmods for REDnode, the in-game browser. Same convention as every Edgemodders repo: a line under **Unreleased** with each change a player would notice, grouped **New**, **Changed**, **Fixed**, **Other**; renamed to the version at each release. The release workflow (RN5, not written yet) will stop if anything is still under Unreleased, as REDnode's `pack-zip.mjs` does.

## Unreleased

### New

- EDGEmods in the game: search the REDnode mods on EDGEmods, open a mod's page, and install it while you play. Windows, HUD widgets and Node mods start a moment after Install, without restarting the game.
- Everything a mod needs comes with it, when it is a REDnode mod too. You see what comes, what each package is, the permissions it asks for and whether it runs code, then say yes. Every file is checked against the one EDGEmods checked before anything is unpacked, and if any part fails, nothing changes.
- Mods that need files in the game folder say so, and point you to EDGEkit or VS Code, where EDGEdeck installs them.
- Installed: the mods EDGEmods installed in the game, with Remove. Updates replace the old version.
- Sign in with a code: the game shows a short code, you confirm it on your phone or PC, and the game stays signed in. Browsing needs no account.
- Installed mods live in `Documents\REDnode\EDGEmods`, not in the game folder, so EDGEdeck's mods are never touched.
