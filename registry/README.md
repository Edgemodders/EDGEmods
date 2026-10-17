# The EDGEmods registry

Every mod on EDGEmods has one file here: `registry/<github-login>/<mod-id>.json`. The EDGEmods extension adds it for you when you publish, by opening a pull request. The merge checks look at your mod's repository and its release, and merge the pull request by themselves when everything is right.

```json
{
  "schemaVersion": 1,
  "repo": "https://github.com/octocat/better-car-radio",
  "repoId": 123456789,
  "ownerId": 583231
}
```

| Field | What it is |
|---|---|
| `repo` | The mod's repository |
| `repoId` | GitHub's numeric id for the repository, which stays the same if it is renamed |
| `ownerId` | GitHub's numeric id for the owner's account |

New versions need no pull request: EDGEmods reads them from the mod's releases. Removing a mod is done by the EDGEmods admins.

How the checks work: https://edgemodders.github.io/EDGEmods/registry.html
