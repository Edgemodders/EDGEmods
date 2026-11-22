// What every EDGEmods webview shares: the page around its content, with a strict Content-Security-Policy. Scripts run
// only from the extension's own media folder (with a fresh nonce); pictures, the stylesheet and its fonts come from
// the EDGEmods site. Mod pages come from strangers: the site cleans them, and nothing in them can run here.

import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface Shell {
  title: string;
  /** A file in media/ that runs the page. */
  script: string;
  bodyClass: string;
  /** HTML, already escaped or cleaned by the site. */
  body: string;
  /** data-* values for the page's script, set on <body>. */
  data?: Record<string, string>;
}

export function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return { enableScripts: true, enableCommandUris: false, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] };
}

export function shell(webview: vscode.Webview, extensionUri: vscode.Uri, site: string, s: Shell): string {
  const nonce = randomBytes(16).toString('base64');
  const media = (file: string): string => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file)).toString();
  const csp = [
    "default-src 'none'",
    `img-src ${site} ${webview.cspSource}`,
    `style-src ${site} ${webview.cspSource}`,
    `font-src ${site}`,
    `script-src 'nonce-${nonce}'`,
    "form-action 'none'",
  ].join('; ');
  const data = Object.entries(s.data ?? {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${esc(site)}/">
<link rel="stylesheet" href="${esc(site)}/assets/site.css">
<link rel="stylesheet" href="${esc(media('edgemods.css'))}">
<title>${esc(s.title)}</title>
</head>
<body class="${esc(s.bodyClass)}"${data}>
${s.body}
<script nonce="${nonce}" src="${esc(media(s.script))}"></script>
</body>
</html>`;
}
