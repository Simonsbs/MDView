const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { atomicReplace } = require('../src/atomic-replace.cjs');

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-replace-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "notes ' $(not-a-command) ` 日本.md");
  const replacement = path.join(directory, "replacement ' $(not-a-command) `.tmp");
  const original = Buffer.from('# Original');
  await writeFile(target, original);
  return { target, replacement, original };
}

test('atomic replacement treats Unicode and shell punctuation in paths literally', async t => {
  const { target, replacement, original } = await fixture(t);
  await writeFile(replacement, '# Replacement');
  await atomicReplace(replacement, target, original);
  assert.equal(await readFile(target, 'utf8'), '# Replacement');
  await assert.rejects(stat(replacement), { code: 'ENOENT' });
});

test('a replacement failure preserves the original file', async t => {
  const { target, replacement, original } = await fixture(t);
  await assert.rejects(atomicReplace(replacement, target, original));
  assert.deepEqual(await readFile(target), original);
});

test('Windows replacement verifies the target inside the child process', { skip: process.platform !== 'win32' }, async t => {
  const { target, replacement, original } = await fixture(t);
  await writeFile(replacement, '# My draft');
  await writeFile(target, '# External save');
  await assert.rejects(atomicReplace(replacement, target, original), { code: 'DOCUMENT_CONFLICT' });
  assert.equal(await readFile(target, 'utf8'), '# External save');
  assert.equal(await readFile(replacement, 'utf8'), '# My draft');
});

test('Windows replacement retains the original creation time', { skip: process.platform !== 'win32' }, async t => {
  const { target, replacement, original } = await fixture(t);
  const before = await stat(target);
  await delay(40);
  await writeFile(replacement, '# Replacement');
  const staged = await stat(replacement);
  assert.notEqual(staged.birthtimeMs, before.birthtimeMs);
  await atomicReplace(replacement, target, original);
  assert.equal((await stat(target)).birthtimeMs, before.birthtimeMs);
});
