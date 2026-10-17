# Dev setup

What a Windows PC needs to work on EDGEmods. The shared tools are the same as in [REDcode's setup guide](https://edgemodders.github.io/REDcode/dev-setup.html).

## 1. Base tools

| Tool | Version used | Why | Install |
|---|---|---|---|
| Git for Windows | as REDcode | Source control | `winget install --id Git.Git -e` |
| GitHub CLI | as REDcode | Repositories, releases and the API from scripts | `winget install --id GitHub.cli -e` |
| nvm for Windows and Node.js | Node 24.11.1, npm 11.14.1 (22.13 or later is the floor: the server uses `node:sqlite`) | The packages, and later the extension, the indexer and the website, are TypeScript, as the rest of the ecosystem | `winget install --id CoreyButler.NVMforWindows -e`, then `nvm install 24` and `nvm use 24` |
| Python | 3.10 or later | Brand tooling | |
| Chrome or Edge | any | Renders the brand images | Already present on Windows |
| REDcode and EDGEdeck | latest | Publishing reads a REDcode project; installing goes through EDGEdeck | From the Marketplace or Open VSX |

## 2. Repository and GitHub

```powershell
git clone https://github.com/Edgemodders/EDGEmods.git
cd EDGEmods
git config user.name  "CyberbuildsAI"
git config user.email "340969962+CyberbuildsAI@users.noreply.github.com"
git config credential.https://github.com.username CyberbuildsAI
```

Test mods for the registry go in their own repositories, never in this one. This repository holds the registry list, the schema, the code and the docs.

## 3. Build and test

An npm workspace: the root `package.json` runs each package's scripts.

```powershell
npm install               # first time, and after a dependency changes (CI uses npm ci)
npm run build             # compile the packages
npm run typecheck
npm test                  # build, then node --test
npm run check:example     # check examples/example-mod as EDGEmods would
npm run schema --workspace packages/format   # regenerate the JSON schema after changing the format's rules
```

| Package | Dev dependencies (installed 2026-10-17) |
|---|---|
| `packages/format` | `typescript` 5.9.3, `@types/node` 24.19.2, `ajv` 8.20.0 (tests only: checks the generated schema). No runtime dependencies |
| `packages/checks` | `typescript`, `@types/node` as above. Runtime: only `packages/format`. Uses the `clamscan` (ClamAV) and `7z` (p7zip) tools when present; the registry workflow installs them on the runner. The two `.7z` tests are skipped where `7z` is missing |

`.github/workflows/test.yml` runs the same steps on every push and pull request, on Node 24.

## 4. Docs site and brand images

The developer docs at https://edgemodders.github.io/EDGEmods/ are built by `.github/workflows/pages.yml` on every push to `main`. **Settings > Pages > Source** must be **GitHub Actions**. The mod website is a separate build, decided in R0.

```powershell
.\tools\brand\render.ps1   # banner, social preview, icon, badges
```

| Output | Used by |
|---|---|
| `docs/assets/brand/banner.png` | README header |
| `docs/assets/brand/social.png` | Upload by hand in Settings > General > Social preview |
| `docs/assets/brand/icon.png` | Site icon, and the extension's Marketplace icon later |
| `docs/assets/brand/badges/*.svg` | README badges. Edit the list in `tools/brand/badges.py` |
| `tools/brand/activity.svg` | The activity bar icon. Drawn by hand, not rendered: 24 × 24, stroke 2, `currentColor`, the family's HUD brackets around a grid of tiles. R3 copies it to `extensions/edgemods/images/activity.svg` |
