// Limits and patterns for edgemods.json. The JSON schema is generated from these (src/schema.ts), so patterns
// carry no flags: JSON Schema has none. Case-insensitive extensions are spelled out instead.

export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** MAJOR.MINOR.PATCH with an optional pre-release, no build metadata (it would end up in the git tag). */
export const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
export const GAME_VERSION_PATTERN = /^\d+\.\d+(?:\.\d+)?[a-z]?$/;
export const TAG_PATTERN = ID_PATTERN;
/** A path inside the repository, under images/, with no . or .. segments. */
export const IMAGE_PATH_PATTERN = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))images\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:[Pp][Nn][Gg]|[Jj][Pp][Ee]?[Gg]|[Ww][Ee][Bb][Pp])$/;
/** A markdown file in the repository, with no . or .. segments. */
export const MARKDOWN_PATH_PATTERN = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.[Mm][Dd]$/;
/** GitHub rewrites spaces and most punctuation in release asset names, so only safe characters are allowed. */
export const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.(?:[Zz][Ii][Pp]|7[Zz])$/;
export const HTTPS_URL_PATTERN = /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/;

export const LIMITS = {
  id: { min: 3, max: 64 },
  name: { min: 1, max: 80 },
  summary: { min: 10, max: 200 },
  authorName: { min: 1, max: 80 },
  license: { min: 1, max: 64 },
  credits: { max: 20 },
  creditName: { max: 80 },
  creditFor: { max: 80 },
  tags: { max: 10 },
  tag: { min: 2, max: 24 },
  gallery: { max: 30 },
  caption: { max: 140 },
  files: { min: 1, max: 50 },
  fileName: { max: 128 },
  fileTitle: { max: 80 },
  fileGroup: { max: 40 },
  fileNote: { max: 500 },
  requirements: { max: 30 },
  requirementName: { max: 80 },
  requirementNote: { max: 300 },
  url: { max: 500 },
  /** Release assets: GitHub's limit is under 2 GiB each. */
  releaseAssetBytes: 2 * 1024 ** 3 - 1,
  /** Images are served by EDGEmods from a cache; keep them small. */
  imageBytes: 5 * 1024 ** 2,
  readmeBytes: 512 * 1024,
  card: { minWidth: 640, minHeight: 320, recommendedWidth: 1280, recommendedHeight: 640, ratio: 2, ratioTolerance: 0.05 },
} as const;
