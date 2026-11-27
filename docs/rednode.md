---
title: EDGEmods for REDnode
---

# EDGEmods for REDnode

EDGEmods for REDnode is a REDnode app that runs in the game. It finds the REDnode mods on EDGEmods and installs them while you play: windows, HUD widgets and Node mods start a moment after **Install**, without restarting the game.

**Status: built 2026-11-27 (RN4), not released, not tried in the game yet.** The code is in [`rednode/`](https://github.com/Edgemodders/EDGEmods/tree/main/rednode). The design is in [the design](design.html), "REDnode mods and the in-game browser".

## What it lists

It lists only the mods that can install from the game: a release with a file that is nothing but REDnode packages. The merge checks decide that when the mod is published ([registry](registry.html), "The downloads").

A mod that also has files for the game folder, such as archives, redscript or a framework, needs EDGEdeck and a restart. The app says so and points to EDGEkit or VS Code.

## Using it

| Step | What happens |
|---|---|
| Install the pack | Through EDGEdeck or by hand, like any REDnode pack. It needs REDnode 0.66.0 or newer |
| Switch it on | REDnode's **Mod Manager**: switch on **EDGEmods**, and allow its **admin** permission. The app needs that permission to give REDnode the folder it installs into and to start what it installed. Browsing works without it |
| Browse | Search, sort, and open a mod's page: what each package is, the permissions it asks for, whether it runs code, what it needs |
| Sign in | Installing downloads files, which needs a free EDGEmods account. **Account** › **Sign in** shows a short code. Open the address it gives on your phone or PC, sign in as on the website and enter the code. The game stays signed in |
| Install | One question that names every mod and version that comes. Every file is downloaded and checked against the one EDGEmods checked, then unpacked. Only then do the packages move into place, all or nothing, and REDnode starts them |
| Installed | The mods the app installed, with **Remove**. Installing a newer version replaces the old one |

## Where the files go

Installed mods go in `Documents\REDnode\EDGEmods\<package>\`, not in the game folder. The game folder is EDGEdeck's, so the app never touches what EDGEdeck deployed.

REDnode watches that folder as one of its development folders. Two things follow from that:

- A package there is reloaded when its files change.
- A package there wins over a copy with the same id in the game's apps folder.

So the app refuses to install a package that REDnode already has from somewhere else, and says where it is.

The app's own data (what it installed, the site address) is in REDnode's data folder for it. Your sign-in is in REDnode's secrets, encrypted with your Windows account.

## For testing

**Account** › **EDGEmods site** takes another address: `http://localhost:8800` for the website on this PC ([dev setup](dev-setup.html)). Leave it empty for edgemods.ai.

On the website's side, signing in from the game needs the Auth0 application from [Auth0 setup](auth0-setup.html), step 10.
