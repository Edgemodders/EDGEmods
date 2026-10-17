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
  /** What this file needs on top of the whole mod's requirements, when it is installed. */
  requirements?: Requirement[];
}

/**
 * Another mod on EDGEmods, by its id, at the release the modder picked in the publishing form. Installing resolves
 * the chain: the EDGEmods server reads each required mod's edgemods.json at the chosen release, and so on down.
 */
export interface ModRequirement {
  mod: string;
  /** The release picked: MAJOR.MINOR.PATCH, released as the tag v<version>. This version or a newer one, unless exact. */
  version: string;
  /** Only this version will do. */
  exact?: boolean;
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

/** A requirement with where it was declared: the whole mod, or one file (by its name). */
export interface PlacedRequirement {
  requirement: Requirement;
  /** The release file that needs it; undefined when the whole mod does. */
  file?: string;
}

/** Every requirement in the manifest: the whole mod's first, then each file's. */
export function allRequirements(m: Pick<Manifest, 'requirements' | 'files'>): PlacedRequirement[] {
  return [
    ...(m.requirements ?? []).map((requirement) => ({ requirement })),
    ...m.files.flatMap((f) => (f.requirements ?? []).map((requirement) => ({ requirement, file: f.name }))),
  ];
}
