import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseManifest, validateManifest } from '../dist/index.js';
import { example, messages } from './helpers.mjs';

/** Breaks the example with `change`, and expects one error at `path` whose message contains `words`. */
function expectError(change, path, words) {
  const m = example();
  change(m);
  const result = validateManifest(m);
  assert.equal(result.ok, false, `expected an error at ${path}`);
  const hit = result.issues.find((i) => i.level === 'error' && i.path === path && i.message.includes(words));
  assert.ok(hit, `no error at ${path} containing "${words}". Got:\n${messages(result).join('\n')}`);
}

test('the example is valid, with no warnings', () => {
  const result = validateManifest(example());
  assert.equal(result.ok, true, messages(result).join('\n'));
  assert.deepEqual(messages(result, 'warning'), []);
  assert.equal(result.manifest.id, 'edgemods-example');
});

test('a value that is not an object', () => {
  assert.equal(validateManifest([]).ok, false);
  assert.match(validateManifest('x').issues[0].message, /must be an object/);
});

test('required fields, named in plain words', () => {
  for (const [key, words] of [
    ['schemaVersion', 'format version'],
    ['id', 'mod id is missing'],
    ['name', 'name is missing'],
    ['summary', 'short description'],
    ['version', 'version is missing'],
    ['author', 'author is missing'],
    ['license', 'license is missing'],
    ['type', 'mod type is missing'],
    ['images', 'card image'],
    ['files', 'release files is missing'],
  ]) {
    expectError((m) => delete m[key], key, words);
  }
});

test('unknown fields suggest the likely one', () => {
  expectError((m) => { m.sumary = m.summary; delete m.summary; }, 'sumary', 'Did you mean "summary"');
  expectError((m) => { m.colour = 'red'; }, 'colour', 'Remove it');
  expectError((m) => { m.author.githb = 'x'; }, 'author.githb', 'Did you mean "github"');
});

test('a newer format version asks for an update', () => {
  expectError((m) => { m.schemaVersion = 2; }, 'schemaVersion', 'Update EDGEmods');
});

test('ids', () => {
  expectError((m) => { m.id = 'My Mod'; }, 'id', 'lowercase letters');
  expectError((m) => { m.id = 'my--mod'; }, 'id', 'single dashes');
  expectError((m) => { m.id = 'ab'; }, 'id', 'too short');
});

test('text lengths and spaces', () => {
  expectError((m) => { m.summary = 'x'.repeat(201); }, 'summary', '201 characters, the limit is 200');
  expectError((m) => { m.summary = 'Too short'; }, 'summary', 'too short');
  expectError((m) => { m.name = ' Spaced'; }, 'name', 'spaces');
  expectError((m) => { m.name = ''; }, 'name', 'empty');
  expectError((m) => { m.name = 42; }, 'name', 'text in quotes');
});

test('versions explain the usual mistakes', () => {
  expectError((m) => { m.version = 'v1.0.0'; }, 'version', 'starts with "v"');
  expectError((m) => { m.version = '1.2'; }, 'version', '"1.2.0"');
  expectError((m) => { m.version = '1.0.0+build'; }, 'version', 'MAJOR.MINOR.PATCH');
  assert.equal(validateManifest({ ...example(), version: '2.0.0-beta.1' }).ok, true);
});

test('the author login', () => {
  expectError((m) => { m.author.github = '@octocat'; }, 'author.github', 'without "@"');
  expectError((m) => { m.author.github = 'https://github.com/x'; }, 'author.github', 'not a GitHub login');
});

test('type and tags', () => {
  expectError((m) => { m.type = 'graphics'; }, 'type', '"graphics" is not one of them');
  expectError((m) => { m.tags = ['Night City']; }, 'tags[0]', 'lowercase');
  expectError((m) => { m.tags = ['cars', 'cars']; }, 'tags[1]', 'twice');
  expectError((m) => { m.tags = Array.from({ length: 11 }, (_, i) => `tag-${i}`); }, 'tags', 'limit is 10');
});

test('game version and adult flag', () => {
  expectError((m) => { m.gameVersion = 'patch 2.3'; }, 'gameVersion', '"2.31"');
  expectError((m) => { m.adult = 'yes'; }, 'adult', 'true or false');
  const m = example();
  delete m.gameVersion;
  const result = validateManifest(m);
  assert.equal(result.ok, true);
  assert.ok(result.issues.some((i) => i.level === 'warning' && i.path === 'gameVersion'));
});

test('image paths', () => {
  expectError((m) => { m.images.card = 'https://i.imgur.com/x.png'; }, 'images.card', 'is a link');
  expectError((m) => { m.images.card = 'images\\card.png'; }, 'images.card', 'backslashes');
  expectError((m) => { m.images.card = 'card.png'; }, 'images.card', 'under images/');
  expectError((m) => { m.images.card = 'images/../secret.png'; }, 'images.card', 'under images/');
  expectError((m) => { m.images.card = 'images/card.gif'; }, 'images.card', '.png, .jpg or .webp');
  expectError((m) => { m.images.gallery.push({ path: 'images/screenshot-1.png' }); }, 'images.gallery[1].path', 'twice');
  assert.equal(validateManifest({ ...example(), images: { card: 'images/Card.JPG' } }).ok, true);
});

test('page and changelog paths', () => {
  expectError((m) => { m.page = '../README.md'; }, 'page', '.md file');
  expectError((m) => { m.changelog = 'CHANGES.txt'; }, 'changelog', '.md file');
});

test('release files', () => {
  expectError((m) => { m.files = []; }, 'files', 'empty');
  expectError((m) => { m.files[0].name = 'My Mod.zip'; }, 'files[0].name', 'has spaces');
  expectError((m) => { m.files[0].name = 'mod.rar'; }, 'files[0].name', '.zip or .7z');
  expectError((m) => { m.files[1].name = m.files[0].name.toUpperCase(); }, 'files[1].name', 'listed twice');
  expectError((m) => { m.files[0].role = 'main'; }, 'files[0].role', 'required, optional, choose-one');
  expectError((m) => { delete m.files[1].group; }, 'files[1].group', 'its group is missing');
  expectError((m) => { m.files[0].group = 'Body'; }, 'files[0].group', 'Only choose-one files');
  expectError((m) => { m.files[2].group = 'Other'; }, 'files[1].group', 'only one file');
  expectError((m) => { m.files[0].note = 'x'.repeat(501); }, 'files[0].note', 'limit is 500');
  expectError((m) => { m.files = [{ name: 'a.zip', role: 'optional' }]; }, 'files', 'Every file is optional');
});

test('requirements', () => {
  expectError((m) => { m.requirements[1].mod = 'edgemods-example'; }, 'requirements[1].mod', 'itself');
  expectError((m) => { m.requirements.push({ mod: 'edgemods-example-core' }); }, 'requirements[2].mod', 'twice');
  expectError((m) => { m.requirements[0].url = 'http://example.com'; }, 'requirements[0].url', 'https');
  expectError((m) => { m.requirements[0].url = 'not a link'; }, 'requirements[0].url', 'not a web address');
  expectError((m) => { m.requirements[0].mod = 'x-y-z'; }, 'requirements[0]', 'both');
  expectError((m) => { m.requirements.push({}); }, 'requirements[2]', 'empty');
  expectError((m) => { delete m.requirements[0].url; }, 'requirements[0].url', 'link is missing');
  expectError((m) => { m.requirements[1].minVersion = '1.2'; }, 'requirements[1].minVersion', '"1.2.0"');
});

test('links', () => {
  expectError((m) => { m.links.patreon = 'https://patreon.com/x'; }, 'links.patreon', 'Remove it');
  expectError((m) => { m.links.homepage = 'edgemods.ai'; }, 'links.homepage', 'https://');
});

test('JSON syntax errors give a line and column', () => {
  const result = parseManifest('{\n  "id": "x",\n}');
  assert.equal(result.ok, false);
  assert.match(result.issues[0].message, /line 3, column 1/);
  assert.match(result.issues[0].message, /comma after the last item/);
});

test('a byte order mark is accepted', () => {
  assert.equal(parseManifest('﻿' + JSON.stringify(example())).ok, true);
});
