// The edgemods.json metadata a mod's repository carries, schema version 1.
// schema/edgemods.schema.json describes the same shape for editors; test/schema.test.mjs keeps the two in step.

export const SCHEMA_VERSION = 1;
export const MANIFEST_FILE = 'edgemods.json';
export const SCHEMA_URL = 'https://edgemods.ai/schema/edgemods-1.json';

/** What a mod mainly is. One per mod; tags add the rest. */
export const MOD_TYPES = [
  'gameplay',
  'visual',
  'characters',
  'clothing',
  'weapons',
  'vehicles',
  'audio',
  'ui',
  'world',
  'quests',
  'utility',
  'modding-resource',
  'other',
] as const;
export type ModType = (typeof MOD_TYPES)[number];

/** How a release file is used. */
export const FILE_ROLES = ['required', 'optional', 'choose-one'] as const;
export type FileRole = (typeof FILE_ROLES)[number];

export const LINK_KEYS = ['homepage', 'nexus', 'discord', 'donate'] as const;
export type LinkKey = (typeof LINK_KEYS)[number];

export interface Author {
  /** The name shown on the mod's page. */
  name: string;
  /** The GitHub login that owns the mod's repository. */
  github: string;
}

export interface Credit {
  name: string;
  /** What they did, in a few words. */
  for?: string;
}

export interface GalleryImage {
  path: string;
  caption?: string;
}

export interface Images {
  /** The card image: 2:1, like a social preview, at least 640 × 320; 1280 × 640 recommended. */
  card: string;
  gallery?: GalleryImage[];
}

export interface ModFile {
  /** The release asset's file name, exactly as it is attached to the release. */
  name: string;
  role: FileRole;
  /** For choose-one files: the files in one group replace each other, so only one of them is installed. */
  group?: string;
  /** A short label for the file; the file name is shown when it is missing. */
  title?: string;
  /** Free-form explanation of the file. */
  note?: string;
}

/** Another mod on EDGEmods, by its id. */
export interface ModRequirement {
  mod: string;
  minVersion?: string;
  note?: string;
}

/** Something outside EDGEmods: another mod site, a file host, a framework's page. Not scanned. */
export interface LinkRequirement {
  name: string;
  url: string;
  note?: string;
}

export type Requirement = ModRequirement | LinkRequirement;

export interface Manifest {
  $schema?: string;
  schemaVersion: typeof SCHEMA_VERSION;
  /** Lowercase words joined by dashes; unique on EDGEmods and never changed after publishing. */
  id: string;
  name: string;
  /** The card's short description. */
  summary: string;
  /** This release's version, MAJOR.MINOR.PATCH. The release is tagged v<version>. */
  version: string;
  author: Author;
  credits?: Credit[];
  /** An SPDX identifier such as MIT or CC-BY-4.0, or the author's own terms in a few words. */
  license: string;
  type: ModType;
  tags?: string[];
  /** The game version the mod was made and tested with, such as 2.31. */
  gameVersion?: string;
  /** The author says the mod has adult content. EDGEmods' own review may add this tag too. */
  adult?: boolean;
  images: Images;
  /** The mod page's body. Default README.md. */
  page?: string;
  /** Default CHANGELOG.md, when the file exists. */
  changelog?: string;
  files: ModFile[];
  requirements?: Requirement[];
  links?: Partial<Record<LinkKey, string>>;
}

export function isModRequirement(r: Requirement): r is ModRequirement {
  return typeof (r as ModRequirement).mod === 'string';
}
