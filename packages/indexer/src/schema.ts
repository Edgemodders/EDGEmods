// index.db: what the website shows about mods, rebuilt from the registry and the repositories. It holds no
// people's data, so it needs no backup and can be thrown away and built again (docs/design.md, "Two kinds of
// data"). Whether a release passed EDGEmods' release checks, likes, downloads and moderation live in site.db.

/** Raised when the tables change, so the website refuses an index it cannot read. */
export const INDEX_SCHEMA_VERSION = 1;

export const INDEX_SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- One row per mod with at least one usable release. The fields come from the newest release's edgemods.json.
CREATE TABLE mods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  author_name TEXT NOT NULL,
  owner_login TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  repo TEXT NOT NULL,              -- owner/name today; the id below survives renames
  repo_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  tags TEXT NOT NULL,              -- JSON array
  license TEXT NOT NULL,
  adult INTEGER NOT NULL,
  latest TEXT NOT NULL,            -- the version shown by default: the newest that is not a pre-release, if any
  first_published TEXT,            -- ISO date of the oldest usable release
  last_updated TEXT,               -- ISO date of the newest usable release
  card TEXT NOT NULL,              -- repository path of the card image
  gallery TEXT NOT NULL,           -- JSON [{ path, caption }]
  page_html TEXT NOT NULL,         -- the README, rendered and sanitized
  links TEXT NOT NULL,             -- JSON { homepage, nexus, discord, donate }
  credits TEXT NOT NULL,           -- JSON [{ name, for }]
  indexed_at TEXT NOT NULL
);

-- Every usable release of every mod: its own edgemods.json, files and notes.
CREATE TABLE releases (
  mod_id TEXT NOT NULL REFERENCES mods(id),
  version TEXT NOT NULL,
  tag TEXT NOT NULL,
  rank INTEGER NOT NULL,           -- 0 for the newest version, by semantic versioning order
  prerelease INTEGER NOT NULL,
  published_at TEXT,
  game_version TEXT,
  notes_html TEXT NOT NULL,        -- the version's CHANGELOG.md section, or the release's description; sanitized
  notes_from TEXT NOT NULL,        -- 'changelog', 'release' or 'none'
  files TEXT NOT NULL,             -- JSON [{ name, role, group, title, note, size, assetId, url, requirements }]
  requirements TEXT NOT NULL,      -- JSON: the whole mod's requirements
  size INTEGER NOT NULL,           -- required files plus the first file of each choose-one group
  manifest TEXT NOT NULL,          -- the release's edgemods.json, as read
  PRIMARY KEY (mod_id, version)
);

-- Repository paths EDGEmods may serve as images for a mod, at the newest release's tag. Nothing else is fetched.
CREATE TABLE images (
  mod_id TEXT NOT NULL REFERENCES mods(id),
  path TEXT NOT NULL,
  ref TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (mod_id, path)
);

-- Why a registry entry or one of its releases is not on the website, for the admin page and My mods.
CREATE TABLE problems (
  mod_id TEXT NOT NULL,
  version TEXT,                    -- null when the whole mod is affected
  message TEXT NOT NULL
);

CREATE VIRTUAL TABLE mods_search USING fts5(id UNINDEXED, name, summary, tags, author, tokenize = 'porter unicode61');
`;
