# The mod metadata: edgemods.json

Every mod on EDGEmods has an `edgemods.json` at the top of its repository. The EDGEmods publishing form writes it; modders do not need to edit it by hand. The website, the extension and the merge checks all read it.

**Status: proposed, format version 1 (2026-10-17).** Built in R1 for the owner to review. Fields may still change before the first mod is published. The code is in [`packages/format`](https://github.com/Edgemodders/EDGEmods/tree/main/packages/format) and the example in [`examples/example-mod`](https://github.com/Edgemodders/EDGEmods/tree/main/examples/example-mod).

## A mod's repository

| Path | What it is |
|---|---|
| `edgemods.json` | The metadata, described below |
| `README.md` | The mod page, in GitHub-flavored markdown. Another file can be named in `page` |
| `images/` | The card image and the gallery |
| `CHANGELOG.md` | Optional, named in `changelog` |
| Releases | One per version, tagged `v` plus the version (`v1.2.0`), with the files listed in `files` attached. Downloads never go in the repository: git refuses files over 100 MB, while release files can be up to 2 GiB each |

Each release's tag points at a commit whose `edgemods.json` describes that release, so older versions keep their own files, notes and requirements.

## Fields

| Field | Required | What it is | Rules |
|---|---|---|---|
| `$schema` | no | The schema link, for editors | `https://edgemods.ai/schema/edgemods-1.json` |
| `schemaVersion` | yes | The format version | `1` |
| `id` | yes | The mod's id on EDGEmods; never changed after publishing | 3 to 64 lowercase letters, digits and single dashes: `better-car-radio`. Unique on EDGEmods (checked by the merge checks) |
| `name` | yes | The name on the card and the page | Up to 80 characters |
| `summary` | yes | The card's short description | 10 to 200 characters |
| `version` | yes | This release's version | `MAJOR.MINOR.PATCH`, with an optional pre-release (`2.0.0-beta.1`). No `v` |
| `author.name` | yes | The name shown | Up to 80 characters |
| `author.github` | yes | The GitHub login that owns the repository | Must match the repository's owner (checked by the merge checks) |
| `credits` | no | Others who helped | Up to 20 of `{ "name", "for" }` |
| `license` | yes | The mod's license | An SPDX identifier (`MIT`, `CC-BY-4.0`) or the terms in a few words, up to 64 characters |
| `type` | yes | What the mod mainly is | One of `gameplay`, `visual`, `characters`, `clothing`, `weapons`, `vehicles`, `audio`, `ui`, `world`, `quests`, `utility`, `modding-resource`, `other` |
| `tags` | no | Words players search for | Up to 10, lowercase with dashes, 2 to 24 characters each |
| `gameVersion` | no (a warning) | The game version it was tested with | Like `2.31` or `2.12a` |
| `adult` | no | The author says it has adult content | `true` or `false`. EDGEmods' own review can add the tag too |
| `images.card` | yes | The card image | A `.png`, `.jpg` or `.webp` under `images/`; 2:1, at least 640 × 320, 1280 × 640 best; up to 5 MB |
| `images.gallery` | no (a warning) | Screenshots | Up to 30 of `{ "path", "caption" }`, same file rules as the card, any shape |
| `page` | no | The mod page | A `.md` file; default `README.md`, up to 512 KB |
| `changelog` | no | The changelog | A `.md` file |
| `files` | yes | The release's files | 1 to 50; see below |
| `requirements` | no | What the mod needs | Up to 30; see below |
| `links` | no | Other places | `homepage`, `nexus`, `discord`, `donate`; https only |

### Release files

| Field | What it is |
|---|---|
| `name` | The file's name on the release, exactly, capitals included. A `.zip` or `.7z`, with letters, digits, dots, dashes, underscores and `+` only, because GitHub renames anything else |
| `role` | `required`: always installed. `optional`: the player may add it. `choose-one`: one file of its group is installed |
| `group` | For `choose-one` files only: the group's name, such as "Body". Files in a group override the same thing, so the player picks one. A group has at least two files |
| `title` | A short label, up to 80 characters |
| `note` | Free-form explanation, up to 500 characters |

At least one file is `required`, or there is a `choose-one` group: a mod made only of optional files cannot be installed.

### Requirements

| Form | Fields | Meaning |
|---|---|---|
| A mod on EDGEmods | `mod` (its id), `minVersion`, `note` | Picked from a search box in the publishing form |
| Anything else | `name`, `url` (https), `note` | Another mod site, a file host, a framework's page. Not scanned by EDGEmods |

## The checks

| Check | Where | What |
|---|---|---|
| `validateManifest`, `parseManifest` | Anywhere: no disk, no network | The fields above, with each problem explained in plain words and a "did you mean" for typos |
| `checkModFolder` | The extension before publishing; `npm run check:example` | The manifest, then: the page and images exist with exactly the same capitals (Windows ignores capitals, GitHub does not), images are real PNG, JPEG or WebP files matching their extension, the card is 2:1, and no file is too big for git |
| `checkRelease` | The merge checks, the extension | The tag is `v<version>`; every listed file is attached, with the same name, not empty and under 2 GiB; files on the release that are not listed are a warning |
| The JSON schema | Editors | `schema/edgemods.schema.json`, generated from the validator's own rules, so the two agree. The validator is the authority |

Problems are errors or warnings. Errors stop a mod; warnings are advice, such as a missing gallery.

## Example

The complete example is [`examples/example-mod/edgemods.json`](https://github.com/Edgemodders/EDGEmods/blob/main/examples/example-mod/edgemods.json). In short:

```json
{
  "$schema": "https://edgemods.ai/schema/edgemods-1.json",
  "schemaVersion": 1,
  "id": "edgemods-example",
  "name": "EDGEmods Example",
  "summary": "An example of a mod's metadata for EDGEmods.",
  "version": "1.0.0",
  "author": { "name": "Edgemodders", "github": "Edgemodders" },
  "license": "MIT",
  "type": "modding-resource",
  "tags": ["example"],
  "gameVersion": "2.31",
  "images": { "card": "images/card.png" },
  "files": [
    { "name": "edgemods-example-1.0.0.zip", "role": "required", "title": "Main file" },
    { "name": "edgemods-example-body-a-1.0.0.zip", "role": "choose-one", "group": "Body", "title": "Body A" },
    { "name": "edgemods-example-body-b-1.0.0.zip", "role": "choose-one", "group": "Body", "title": "Body B" }
  ],
  "requirements": [
    { "name": "ArchiveXL", "url": "https://www.nexusmods.com/cyberpunk2077/mods/4198" }
  ]
}
```

## Open points

| Point | Notes |
|---|---|
| The type list | Proposed above; the owner may want different types |
| The card size | 2:1 like GitHub's social preview (1280 × 640). Another shape is a one-line change |
| Archive formats | `.zip` and `.7z` only. `.rar` is left out because the merge checks must list an archive's contents |
| Several authors | One owner (the GitHub login) plus `credits` for now |
