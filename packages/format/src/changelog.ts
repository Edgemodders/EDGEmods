// A changelog in the form every Edgemodders repository keeps, and mods published with EDGEmods too:
//
//   ## Unreleased
//   ## 1.2.0 (2026-10-19)
//   **New**
//   - One change per line.
//
// Sections are level-2 headings, newest first. Lines grouped under **New**, **Changed**, **Fixed** and **Other**.
// Pure, like validate.ts: the indexer reads a section for each release, the extension drafts and writes them.

import { isVersion } from './versions.js';

export const CHANGELOG_FILE = 'CHANGELOG.md';
export const CHANGELOG_GROUPS = ['New', 'Changed', 'Fixed', 'Other'] as const;

export interface ChangelogSection {
  /** The version, or undefined for Unreleased. */
  version?: string;
  /** YYYY-MM-DD when the heading has one. */
  date?: string;
  /** The section's markdown, without its heading, trimmed. */
  body: string;
}

const HEADING = /^##\s+(.+?)\s*$/;
// "1.2.0 (2026-10-19)", "[1.2.0] - 2026-10-19", "v1.2.0", "Unreleased"
const TITLE = /^\[?v?([0-9A-Za-z.+-]+?)\]?(?:\s*(?:-|–|—)?\s*\(?(\d{4}-\d{2}-\d{2})\)?)?$/;

/** Every level-2 section, in file order. Headings that are not a version or "Unreleased" are left out. */
export function parseChangelog(text: string): ChangelogSection[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const sections: ChangelogSection[] = [];
  let current: { section: ChangelogSection; lines: string[] } | undefined;
  let fence = false;
  const close = (): void => {
    if (current) current.section.body = current.lines.join('\n').trim();
    current = undefined;
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading = fence ? null : HEADING.exec(line);
    if (heading) {
      close();
      const section = sectionFor(heading[1]);
      if (section) {
        current = { section, lines: [] };
        sections.push(section);
      }
      continue;
    }
    // A level-1 heading ends a section too.
    if (!fence && /^#\s/.test(line)) {
      close();
      continue;
    }
    current?.lines.push(line);
  }
  close();
  return sections;
}

/** The section for one version, or undefined. */
export function changelogSection(text: string, version: string): ChangelogSection | undefined {
  return parseChangelog(text).find((s) => s.version === version);
}

function sectionFor(title: string): ChangelogSection | undefined {
  if (/^\[?unreleased\]?$/i.test(title)) return { body: '' };
  const match = TITLE.exec(title);
  if (!match || !isVersion(match[1])) return undefined;
  return { version: match[1], ...(match[2] ? { date: match[2] } : {}), body: '' };
}
