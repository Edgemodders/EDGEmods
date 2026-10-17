// The merge checks' report, posted on the pull request and in the workflow's summary. Plain words for the modder.

import { formatBytes } from '@edgemodders/edgemods-format';
import type { CheckResult, StepResult } from './checks.js';
import { KIND_LABELS, type ContentKind } from './contents.js';

/** Marks the bot's comment so a re-run edits it instead of adding another. */
export const REPORT_MARKER = '<!-- edgemods-registry-check -->';

const ICON: Record<StepResult['status'], string> = { pass: '✅', fail: '❌', skip: '⏸️' };

export function renderReport(result: CheckResult, options: { merging?: boolean } = {}): string {
  const lines: string[] = [REPORT_MARKER];
  const name = result.mod ? escape(`${result.mod.name} ${result.mod.version}`) : 'this mod';
  if (result.ok) {
    lines.push(`## ✅ ${name} passed the EDGEmods checks`, '');
    lines.push(options.merging === false
      ? 'Every check passed. The pull request will be merged once the EDGEmods app is set up.'
      : 'Every check passed, so this pull request is merged by itself. The mod appears on https://edgemods.ai after the next rebuild.');
  } else {
    lines.push(`## ❌ ${name} is not ready for EDGEmods yet`, '');
    lines.push('Fix the problems below in the mod\'s repository, then publish again from the EDGEmods extension, or push an empty commit to this pull request to re-run the checks.');
  }
  lines.push('');

  for (const step of result.steps) {
    lines.push(`### ${ICON[step.status]} ${step.title}`);
    const errors = step.issues.filter((i) => i.level === 'error');
    const warnings = step.issues.filter((i) => i.level === 'warning');
    for (const i of errors) lines.push(`- **Problem:** ${escape(i.message)}${i.path ? ` <sub>(${escape(i.path)})</sub>` : ''}`);
    for (const i of warnings) lines.push(`- Advice: ${escape(i.message)}${i.path ? ` <sub>(${escape(i.path)})</sub>` : ''}`);
    for (const n of step.notes) lines.push(`- ${escape(n)}`);
    lines.push('');
  }

  if (result.downloads.length) {
    lines.push('### What the downloads contain', '', '| File | Size | Contents | Scan | SHA-256 |', '|---|---|---|---|---|');
    for (const d of result.downloads) {
      const kinds = Object.entries(d.contents.kinds)
        .map(([k, n]) => `${n} ${KIND_LABELS[k as ContentKind]}`)
        .join('; ');
      const scan = d.scan ? (d.scan.clean ? `${d.scan.scanner}: clean` : `${d.scan.scanner}: **${escape(d.scan.findings.join(', '))}**`) : 'not scanned';
      lines.push(`| ${escape(d.name)} | ${formatBytes(d.size)} | ${escape(kinds)} | ${scan} | \`${d.sha256.slice(0, 16)}…\` |`);
    }
    const runsCode = result.downloads.filter((d) => d.contents.runsCode.length);
    if (runsCode.length) {
      lines.push('', 'Some files run code with the player\'s permissions, which is normal for game plugins. The mod page tells players.');
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Text from a mod's repository goes into the comment; keep it from becoming markup or mentions. */
function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]|]/g, (c) => `\\${c}`)
    .replace(/@/g, '@​')
    .replace(/\r?\n/g, ' ');
}
