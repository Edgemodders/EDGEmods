import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from '../dist/index.js';

const ctx = {
  modId: 'neon-rain',
  repo: 'kvane/neon-rain',
  dir: '',
  files: new Set(['images/card.png', 'images/shots/one.jpg', 'docs/install.md', 'notes.txt']),
};
const html = (md, c = ctx) => renderMarkdown(md, c).html;

test('scripts, event handlers, styles, frames and forms are removed', () => {
  const out = html([
    '<script>alert(1)</script>',
    '<img src="images/card.png" onerror="alert(2)">',
    '<p style="position:fixed" onclick="alert(3)">hi</p>',
    '<iframe src="https://evil.example"></iframe>',
    '<form action="https://evil.example"><input type="password" name="p"></form>',
    '<object data="x"></object><embed src="x"><svg onload="alert(4)"></svg><style>body{}</style>',
    '<a href="javascript:alert(5)">js</a> <a href="data:text/html,x">data</a> <a href="vbscript:x">vb</a>',
  ].join('\n\n'));
  for (const bad of ['<script', 'onerror', 'onclick', 'style', '<iframe', '<form', 'password', '<object', '<embed', '<svg', 'javascript:', 'data:', 'vbscript:', 'alert(1)']) {
    assert.ok(!out.includes(bad), `${bad} in ${out}`);
  }
  assert.match(out, /<p>hi<\/p>/);
});

test('images show only from the mod\'s own repository, through EDGEmods', () => {
  const { html: out, images } = renderMarkdown([
    '![card](images/card.png)',
    '![shot](./images/shots/one.jpg "One")',
    '![raw](https://raw.githubusercontent.com/kvane/neon-rain/main/images/card.png)',
    '![blob](https://github.com/KVane/Neon-Rain/blob/v1.0.0/images/shots/one.jpg?raw=true)',
    '![tracker](https://evil.example/pixel.png)',
    '![other repo](https://raw.githubusercontent.com/someone/else/main/images/card.png)',
    '![missing](images/nope.png)',
    '![not an image](notes.txt)',
    '![climb](../../etc/passwd.png)',
    '![data](data:image/png;base64,AAAA)',
  ].join('\n\n'), ctx);
  assert.equal((out.match(/<img /g) ?? []).length, 4);
  assert.match(out, /src="\/mods\/neon-rain\/images\/images\/card.png"/);
  assert.match(out, /src="\/mods\/neon-rain\/images\/images\/shots\/one.jpg"/);
  assert.ok(!/evil|someone|nope|notes|passwd|data:/.test(out), out);
  assert.deepEqual(images.sort(), ['images/card.png', 'images/shots/one.jpg']);
  assert.match(out, /loading="lazy"/);
});

test('links into the repository go through EDGEmods; others open safely', () => {
  const out = html([
    '[install](docs/install.md)',
    '[top](#features)',
    '[blob](https://github.com/kvane/neon-rain/blob/main/docs/install.md)',
    '[site](https://example.com/page)',
    '[mail](mailto:a@example.com)',
    '[climb](../../secret)',
    '[dot climb](./../secret)',
    '[encoded climb](%2e%2e/secret)',
  ].join(' '));
  assert.match(out, /href="\/mods\/neon-rain\/source\/docs\/install.md">install/);
  assert.match(out, /href="#features"/);
  assert.match(out, /href="\/mods\/neon-rain\/source\/docs\/install.md">blob/);
  assert.match(out, /href="https:\/\/example.com\/page" rel="nofollow ugc noopener noreferrer" target="_blank"/);
  assert.match(out, /href="mailto:a@example.com"/);
  assert.match(out, /<a>climb<\/a>/);
  assert.match(out, /<a>dot climb<\/a>/);
  assert.match(out, /<a>encoded climb<\/a>/);
});

test('relative paths resolve from the markdown file\'s folder', () => {
  const out = html('![one](../images/shots/one.jpg) [back](../notes.txt)', { ...ctx, dir: 'docs' });
  assert.match(out, /src="\/mods\/neon-rain\/images\/images\/shots\/one.jpg"/);
  assert.match(out, /href="\/mods\/neon-rain\/source\/notes.txt"/);
});

test('headings move down one level; GitHub markdown still works', () => {
  const out = html('# Title\n\n## Part\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~\n\n```lua\nprint(1)\n```');
  assert.match(out, /<h2>Title<\/h2>/);
  assert.match(out, /<h3>Part<\/h3>/);
  assert.match(out, /<table>/);
  assert.match(out, /<td align="right">2<\/td>/);
  assert.match(out, /<input type="checkbox" disabled checked \/> done/);
  assert.match(out, /<input type="checkbox" disabled \/> todo/);
  assert.match(out, /<del>old<\/del>/);
  assert.match(out, /<code class="language-lua">/);
});
