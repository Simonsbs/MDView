const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rename, rm, mkdir, truncate } = require('node:fs/promises');
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
