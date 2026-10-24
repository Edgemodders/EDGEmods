// Pages are built with the html`` template: every value put into it is escaped, unless it is already Html. The
// only Html that comes from outside is a mod's page and release notes, which the indexer sanitized (raw()).

export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

type Value = Html | string | number | boolean | null | undefined | Value[];

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function render(value: Value): string {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false || value === true) return '';
  return esc(String(value));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Html {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Html(out);
}

/** HTML that is already safe: the indexer's sanitized output, or markup built here. */
export function raw(text: string): Html {
  return new Html(text);
}

/** A URL path with each segment encoded. */
export function pathOf(...segments: string[]): string {
  return segments.flatMap((s) => s.split('/')).map(encodeURIComponent).join('/');
}
