const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chmod, link, lstat, mkdtemp, open, readFile, readdir, stat, symlink, writeFile, rename, rm, mkdir, truncate } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { MarkdownDocument, readMarkdown } = require('../src/document.cjs');

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-test-'));
  const file = path.join(directory, 'notes.md');
  const document = new MarkdownDocument({ pollInterval: 100, debounceMs: 40 });
  t.after(async () => { document.close(); await rm(directory, { recursive: true, force: true }); });
  await writeFile(file, '# Original\n\nHello.');
  return { directory, file, document };
}

async function eventually(predicate, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await delay(30);
  }
  assert.ok(predicate(), 'Expected the document state to update');
}

test('opens a file and refreshes after an ordinary save', async t => {
  const { file, document } = await fixture(t);
  await document.open(file);
  assert.equal(document.state.name, 'notes.md');
  assert.equal(document.state.markdown, '# Original\n\nHello.');
  await writeFile(file, '# Updated\n\nSaved from an editor.');
  await eventually(() => document.state.markdown.includes('Saved from an editor.'));
});

test('keeps watching after repeated atomic replacement saves', async t => {
  const { directory, file, document } = await fixture(t);
  await document.open(file);
  for (let i = 1; i <= 3; i++) {
    const temporary = path.join(directory, `editor-${i}.tmp`);
    await writeFile(temporary, `# Replacement ${i}`);
    await rename(temporary, file);
    await eventually(() => document.state.markdown === `# Replacement ${i}`);
  }
});

test('retains the preview after deletion and recovers when the file returns', async t => {
  const { file, document } = await fixture(t);
  await document.open(file);
  await rm(file);
  await eventually(() => Boolean(document.state.error));
  assert.equal(document.state.markdown, '# Original\n\nHello.');
  await writeFile(file, '# Returned');
  await eventually(() => document.state.markdown === '# Returned' && !document.state.error);
});

test('polling recovers when the entire parent directory is replaced', async t => {
  const { directory, document } = await fixture(t);
  const parent = path.join(directory, 'folder');
  const file = path.join(parent, 'nested.md');
  await mkdir(parent);
  await writeFile(file, 'before');
  await document.open(file);
  await rm(parent, { recursive: true });
  await eventually(() => Boolean(document.state.error));
  await mkdir(parent);
  await writeFile(file, 'after');
  await eventually(() => document.state.markdown === 'after' && !document.state.error);
});

test('switching files stops old updates and a failed open preserves the current file', async t => {
  const { directory, file, document } = await fixture(t);
  const other = path.join(directory, 'second.markdown');
  await writeFile(other, 'Second file');
  await document.open(file);
  await document.open(other);
  await writeFile(file, 'Old file changed');
  await delay(350);
  assert.equal(document.state.markdown, 'Second file');
  await assert.rejects(document.open(path.join(directory, 'missing.md')));
  assert.equal(document.state.path, other);
  await writeFile(other, 'Second file updated');
  await eventually(() => document.state.markdown === 'Second file updated');
});

test('opens empty and Unicode files, including UTF-8 and UTF-16 BOMs', async t => {
  const { file, document } = await fixture(t);
  await writeFile(file, '');
  await document.open(file);
  assert.equal(document.state.markdown, '');
  const text = '# שלום\n\nCafé 日本語';
  await writeFile(file, `\uFEFF${text}`);
  assert.equal(await readMarkdown(file), text);
  await writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
  assert.equal(await readMarkdown(file), text);
  await writeFile(file, Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]));
  assert.equal(await readMarkdown(file), text);
});

test('handles rapid saves and keeps the newest content', async t => {
  const { file, document } = await fixture(t);
  await document.open(file);
  for (let i = 0; i < 12; i++) {
    await writeFile(file, `Revision ${i}`);
    await delay(8);
  }
  await eventually(() => document.state.markdown === 'Revision 11');
  assert.equal(document.state.error, '');
});

test('rejects non-Markdown, directory and oversized input without losing the open file', async t => {
  const { directory, file, document } = await fixture(t);
  await document.open(file);
  await assert.rejects(document.open(path.join(directory, 'program.exe')), /Choose a/);
  const folder = path.join(directory, 'folder.md');
  await mkdir(folder);
  await assert.rejects(document.open(folder), /Choose a Markdown file/);
  const huge = path.join(directory, 'huge.md');
  await writeFile(huge, '');
  await truncate(huge, 33 * 1024 * 1024);
  await assert.rejects(document.open(huge), /32 MB/);
  assert.equal(document.state.path, file);
});

test('saves the open document and continues watching outside saves', async t => {
  const { directory, file, document } = await fixture(t);
  await document.open(file);
  const baseline = document.state.markdown;
  const revision = document.state.revision;
  await document.save('# Edited\n\nFrom MDView.', baseline, document.generation);
  assert.equal(await readFile(file, 'utf8'), '# Edited\n\nFrom MDView.');
  assert.equal(document.state.markdown, '# Edited\n\nFrom MDView.');
  assert.equal(document.state.revision, revision + 1);
  assert.equal(document.saving, false);
  assert.deepEqual(await readdir(directory), ['notes.md']);
  await delay(200);
  assert.equal(document.state.markdown, '# Edited\n\nFrom MDView.');
  await writeFile(file, '# Outside editor');
  await eventually(() => document.state.markdown === '# Outside editor');
});

test('refuses to overwrite a changed file even before the watcher refreshes', async t => {
  const { directory, file, document } = await fixture(t);
  await document.open(file);
  const baseline = document.state.markdown;
  await writeFile(file, '# External change');
  await assert.rejects(document.save('# My draft', baseline), { code: 'DOCUMENT_CONFLICT' });
  assert.equal(await readFile(file, 'utf8'), '# External change');
  assert.deepEqual(await readdir(directory), ['notes.md']);
  assert.equal(document.saving, false);
  await eventually(() => document.state.markdown === '# External change');
  await assert.rejects(document.save('# My draft', baseline), { code: 'DOCUMENT_CONFLICT' });
});

test('rejects stale document identities and concurrent file operations', async t => {
  const { directory, file, document } = await fixture(t);
  const second = path.join(directory, 'second.md');
  await writeFile(second, '# Second');
  await document.open(file);
  const firstId = document.generation;
  await document.open(second);
  await assert.rejects(document.save('Stale edit', '# Second', firstId), /no longer open/);
  const save = document.save('# Saved', '# Second', document.generation);
  await assert.rejects(document.save('# Concurrent', '# Second'), /current save/);
  await assert.rejects(document.open(file), /current save/);
  await save;
  assert.equal(await readFile(second, 'utf8'), '# Saved');
  assert.equal(await readFile(file, 'utf8'), '# Original\n\nHello.');
});

test('preserves UTF-8 and UTF-16 BOMs and the original line endings', async t => {
  const { file, document } = await fixture(t);
  const original = '# Original\r\n\r\nשלום';
  const edited = '# Edited\n\nCafé 日本語\n';
  const saved = edited.replace(/\n/g, '\r\n');
  const encodings = [
    text => Buffer.from(text, 'utf8'),
    text => Buffer.from(`\uFEFF${text}`, 'utf8'),
    text => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]),
    text => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]),
  ];
  for (const encode of encodings) {
    await writeFile(file, encode(original));
    await document.open(file);
    await document.save(edited, original);
    assert.deepEqual(await readFile(file), encode(saved));
    assert.equal(document.state.markdown, saved);
  }
});

test('leaves byte-for-byte content untouched for a no-op save', async t => {
  const { file, document } = await fixture(t);
  const original = Buffer.from('\uFEFF# Mixed\r\n\ntext\rmore');
  await writeFile(file, original);
  await document.open(file);
  const before = await stat(file);
  await document.save(document.state.markdown, document.state.markdown);
  assert.deepEqual(await readFile(file), original);
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
});

test('oversized encoded saves preserve the original file', async t => {
  const { directory, file, document } = await fixture(t);
  await writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# Original', 'utf16le')]));
  await document.open(file);
  const original = await readFile(file);
  await assert.rejects(document.save('x'.repeat(16 * 1024 * 1024), '# Original'), /32 MB/);
  assert.deepEqual(await readFile(file), original);
  assert.deepEqual(await readdir(directory), ['notes.md']);
  assert.equal(document.saving, false);
});

test('read-only files are not replaced and retain their original contents', async t => {
  const { directory, file, document } = await fixture(t);
  await document.open(file);
  await chmod(file, 0o444);
  t.after(() => chmod(file, 0o666).catch(() => {}));
  await assert.rejects(document.save('# Changed', document.state.markdown), /read-only|permission/i);
  assert.equal(await readFile(file, 'utf8'), '# Original\n\nHello.');
  assert.deepEqual(await readdir(directory), ['notes.md']);
});

test('saves through symbolic links without replacing the link', async t => {
  const { directory, file, document } = await fixture(t);
  const shortcut = path.join(directory, 'shortcut.md');
  try {
    await symlink(file, shortcut, 'file');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') return t.skip('Symbolic link creation is not permitted on this host.');
    throw error;
  }
  await document.open(shortcut);
  await document.save('# Via link', document.state.markdown);
  assert.ok((await lstat(shortcut)).isSymbolicLink());
  assert.equal(await readFile(file, 'utf8'), '# Via link');
  assert.equal(document.state.path, shortcut);
});

test('hard-linked files are protected from link-breaking replacement', async t => {
  const { directory, file, document } = await fixture(t);
  const other = path.join(directory, 'other.md');
  await link(file, other);
  await document.open(file);
  await assert.rejects(document.save('# Changed', document.state.markdown), /hard links/);
  assert.equal(await readFile(other, 'utf8'), '# Original\n\nHello.');
  assert.equal((await stat(file)).nlink, 2);
});

test('a failed temporary write leaves the original intact and removes the partial file', async t => {
  const { directory, file, document } = await fixture(t);
  await document.open(file);
  const probe = await open(file, 'r');
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const write = t.mock.method(prototype, 'writeFile', async () => {
    throw Object.assign(new Error('No space left on device'), { code: 'ENOSPC' });
  });
  await assert.rejects(document.save('# Changed', document.state.markdown), { code: 'ENOSPC' });
  write.mock.restore();
  assert.equal(await readFile(file, 'utf8'), '# Original\n\nHello.');
  assert.deepEqual(await readdir(directory), ['notes.md']);
  assert.equal(document.saving, false);
});

test('an outside save during replacement preparation prevents the overwrite', async t => {
  const { directory, file, document } = await fixture(t);
  await document.open(file);
  const probe = await open(file, 'r');
  const prototype = Object.getPrototypeOf(probe);
  const originalSync = prototype.sync;
  await probe.close();
  const sync = t.mock.method(prototype, 'sync', async function () {
    await writeFile(file, '# New outside content');
    return originalSync.call(this);
  });
  await assert.rejects(document.save('# My draft', document.state.markdown), { code: 'DOCUMENT_CONFLICT' });
  sync.mock.restore();
  assert.equal(await readFile(file, 'utf8'), '# New outside content');
  assert.deepEqual(await readdir(directory), ['notes.md']);
  await eventually(() => document.state.markdown === '# New outside content');
});
