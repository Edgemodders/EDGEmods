// The JSON schema is generated from the validator's constants; these tests keep the committed copy current and
// check that the schema and the validator agree on the cases a schema can express.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { buildSchema, validateManifest } from '../dist/index.js';
import { example } from './helpers.mjs';

const committed = JSON.parse(readFileSync(new URL('../schema/edgemods.schema.json', import.meta.url), 'utf8'));
// strictRequired would refuse `required` inside if/then, which is how choose-one files demand a group.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
const schemaCheck = ajv.compile(committed);

test('the committed schema matches the code (run `npm run schema` if not)', () => {
  assert.deepEqual(committed, buildSchema());
});

test('the example passes the schema', () => {
  assert.equal(schemaCheck(example()), true, JSON.stringify(schemaCheck.errors, null, 2));
});

const broken = {
  'missing id': (m) => delete m.id,
  'bad id': (m) => { m.id = 'Bad Id'; },
  'unknown field': (m) => { m.colour = 'red'; },
  'v-prefixed version': (m) => { m.version = 'v1.0.0'; },
  'unknown type': (m) => { m.type = 'graphics'; },
  'duplicate tags': (m) => { m.tags = ['a-b', 'a-b']; },
  'image link': (m) => { m.images.card = 'https://x.y/z.png'; },
  'dot-dot path': (m) => { m.images.card = 'images/../z.png'; },
  'file name with spaces': (m) => { m.files[0].name = 'a b.zip'; },
  'choose-one without group': (m) => { delete m.files[1].group; },
  'group on a required file': (m) => { m.files[0].group = 'x'; },
  'requirement with both forms': (m) => { m.requirements[0].mod = 'x-y-z'; },
  'mod requirement without a version': (m) => { delete m.requirements[1].version; },
  'old minVersion field': (m) => { m.requirements[1].minVersion = '1.0.0'; },
  "bad version on a file's requirement": (m) => { m.files[2].requirements[0].version = '2'; },
  'http link': (m) => { m.links.homepage = 'http://edgemods.ai'; },
  'long summary': (m) => { m.summary = 'x'.repeat(201); },
};

for (const [name, change] of Object.entries(broken)) {
  test(`schema and validator both refuse: ${name}`, () => {
    const m = example();
    change(m);
    assert.equal(schemaCheck(m), false, 'the schema accepted it');
    assert.equal(validateManifest(m).ok, false, 'the validator accepted it');
  });
}
