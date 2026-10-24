// Plain words for values: sizes, dates, mod types and what a download contains.

export const TYPE_LABELS: Record<string, string> = {
  gameplay: 'Gameplay', visual: 'Visual', characters: 'Characters', clothing: 'Clothing', weapons: 'Weapons', vehicles: 'Vehicles',
  audio: 'Audio', ui: 'UI', world: 'World', quests: 'Quests', utility: 'Utility', 'modding-resource': 'Modding resource', other: 'Other',
};

export const KIND_LABELS: Record<string, string> = {
  plugin: 'Game plugins (.dll, .asi)', program: 'Programs (.exe and similar)', redscript: 'redscript scripts', cet: 'Cyber Engine Tweaks scripts',
  archive: 'Game archives', tweak: 'Tweaks', audio: 'Sound files', 'nested-archive': 'Archives inside the download', other: 'Other files',
};

export const typeLabel = (t: string): string => TYPE_LABELS[t] ?? t;

export function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function date(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const d = (now - Date.parse(iso)) / 86400000;
  if (d < 1 / 24) return 'just now';
  if (d < 1) return `${Math.round(d * 24)} h ago`;
  if (d < 2) return 'yesterday';
  if (d < 30) return `${Math.round(d)} days ago`;
  if (d < 365) return `${Math.round(d / 30)} months ago`;
  return `${Math.round(d / 365)} years ago`;
}

export const daysSince = (iso: string | undefined, now = Date.now()): number => (iso ? (now - Date.parse(iso)) / 86400000 : Infinity);

export function needsWords(r: { version: string; exact?: boolean }): string {
  return r.exact ? `exactly ${r.version}` : `${r.version} or newer`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
