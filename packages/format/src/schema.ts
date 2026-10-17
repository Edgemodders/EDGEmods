// Builds the JSON schema for edgemods.json from the same constants the validator uses.
// `npm run schema` writes it to schema/edgemods.schema.json; a test fails if the committed copy is stale.
// The schema gives editors completion and basic checks. The validator is the authority: it adds the rules
// a schema cannot express well (choose-one groups, duplicates) and explains problems in plain words.

import {
  FILE_NAME_PATTERN,
  GAME_VERSION_PATTERN,
  GITHUB_LOGIN_PATTERN,
  HTTPS_URL_PATTERN,
  ID_PATTERN,
  IMAGE_PATH_PATTERN,
  LIMITS,
  MARKDOWN_PATH_PATTERN,
  TAG_PATTERN,
  VERSION_PATTERN,
} from './limits.js';
import { FILE_ROLES, LINK_KEYS, MOD_TYPES, SCHEMA_URL, SCHEMA_VERSION } from './manifest.js';

type Json = Record<string, unknown>;

const text = (max: number, min = 1, description?: string): Json => ({
  type: 'string', minLength: min, maxLength: max, ...(description ? { description } : {}),
});
const pattern = (re: RegExp, max: number, description: string, min = 1): Json => ({
  type: 'string', minLength: min, maxLength: max, pattern: re.source, description,
});
const url = (description: string): Json => pattern(HTTPS_URL_PATTERN, LIMITS.url.max, description);
const object = (properties: Json, required: string[], description?: string): Json => ({
  type: 'object', ...(description ? { description } : {}), properties, required, additionalProperties: false,
});

export function buildSchema(): Json {
  const requirements: Json = {
    type: 'array',
    maxItems: LIMITS.requirements.max,
    items: {
      oneOf: [
        object(
          {
            mod: pattern(ID_PATTERN, LIMITS.id.max, 'The id of a mod on EDGEmods.', LIMITS.id.min),
            version: pattern(VERSION_PATTERN, 64, 'The release picked in the publishing form. Newer releases do too, unless exact.'),
            exact: { type: 'boolean', description: 'Only this version will do.' },
            note: text(LIMITS.requirementNote.max),
          },
          ['mod', 'version'],
          'A mod on EDGEmods, at a release.',
        ),
        object(
          { name: text(LIMITS.requirementName.max), url: url('Where to get it.'), note: text(LIMITS.requirementNote.max) },
          ['name', 'url'],
          'Something elsewhere: another mod site, a file host.',
        ),
      ],
    },
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: SCHEMA_URL,
    title: 'EDGEmods mod metadata (edgemods.json)',
    description: 'Describes a Cyberpunk 2077 mod for the EDGEmods registry. Written by the EDGEmods publishing form.',
    ...object(
      {
        $schema: { type: 'string', description: 'This schema, for editors.' },
        schemaVersion: { const: SCHEMA_VERSION, description: 'The format version.' },
        id: pattern(ID_PATTERN, LIMITS.id.max, 'Lowercase words joined by dashes. Unique on EDGEmods; never changed after publishing.', LIMITS.id.min),
        name: text(LIMITS.name.max, LIMITS.name.min, "The mod's name."),
        summary: text(LIMITS.summary.max, LIMITS.summary.min, "The card's short description."),
        version: pattern(VERSION_PATTERN, 64, "This release's version, MAJOR.MINOR.PATCH. The release is tagged v<version>."),
        author: object(
          {
            name: text(LIMITS.authorName.max, 1, 'The name shown on the mod page.'),
            github: pattern(GITHUB_LOGIN_PATTERN, 39, "The GitHub login that owns the mod's repository."),
          },
          ['name', 'github'],
        ),
        credits: {
          type: 'array',
          maxItems: LIMITS.credits.max,
          items: object({ name: text(LIMITS.creditName.max), for: text(LIMITS.creditFor.max) }, ['name']),
        },
        license: text(LIMITS.license.max, 1, 'An SPDX identifier such as MIT or CC-BY-4.0, or the terms in a few words.'),
        type: { enum: [...MOD_TYPES], description: 'What the mod mainly is.' },
        tags: {
          type: 'array',
          maxItems: LIMITS.tags.max,
          uniqueItems: true,
          items: pattern(TAG_PATTERN, LIMITS.tag.max, 'Lowercase words joined by dashes.', LIMITS.tag.min),
        },
        gameVersion: pattern(GAME_VERSION_PATTERN, 16, 'The game version the mod was tested with, such as 2.31.'),
        adult: { type: 'boolean', description: 'The mod has adult content.' },
        images: object(
          {
            card: pattern(IMAGE_PATH_PATTERN, 200, 'The card image under images/: 2:1, at least 640 × 320, 1280 × 640 recommended.'),
            gallery: {
              type: 'array',
              maxItems: LIMITS.gallery.max,
              items: object(
                { path: pattern(IMAGE_PATH_PATTERN, 200, 'An image under images/.'), caption: text(LIMITS.caption.max) },
                ['path'],
              ),
            },
          },
          ['card'],
        ),
        page: pattern(MARKDOWN_PATH_PATTERN, 200, "The mod page's markdown. Default README.md."),
        changelog: pattern(MARKDOWN_PATH_PATTERN, 200, 'The changelog. Default CHANGELOG.md, when it exists.'),
        files: {
          type: 'array',
          minItems: LIMITS.files.min,
          maxItems: LIMITS.files.max,
          description: "The release's files.",
          items: {
            ...object(
              {
                name: pattern(FILE_NAME_PATTERN, LIMITS.fileName.max, "The release asset's file name, exactly."),
                role: { enum: [...FILE_ROLES], description: 'required, optional, or choose-one (one of a group).' },
                group: text(LIMITS.fileGroup.max, 1, 'For choose-one files: the group whose files replace each other.'),
                title: text(LIMITS.fileTitle.max, 1, 'A short label for the file.'),
                note: text(LIMITS.fileNote.max, 1, 'Free-form explanation of the file.'),
                requirements: { ...requirements, description: "What this file needs on top of the whole mod's requirements." },
              },
              ['name', 'role'],
            ),
            if: { properties: { role: { const: 'choose-one' } }, required: ['role'] },
            then: { required: ['group'] },
            else: { not: { required: ['group'] } },
          },
        },
        requirements,
        links: object(Object.fromEntries(LINK_KEYS.map((k) => [k, url(`The ${k} link.`)])), []),
      },
      ['schemaVersion', 'id', 'name', 'summary', 'version', 'author', 'license', 'type', 'images', 'files'],
    ),
  };
}
