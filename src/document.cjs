const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { access, open, readFile, realpath, stat, unlink } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { atomicReplace } = require('./atomic-replace.cjs');

const MAX_BYTES = 32 * 1024 * 1024;
const isMarkdown = file => /\.(md|markdown|mdown|mkd)$/i.test(file);
const sameFile = (a, b) => a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino;

function decodeMarkdown(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

async function readSnapshot(file) {
  for (let attempt = 0; ; attempt++) {
    try {
      const target = await realpath(file);
      const before = await stat(target);
      if (!before.isFile()) throw new Error('Choose a Markdown file.');
      if (before.size > MAX_BYTES) throw new Error('This file is too large. The limit is 32 MB.');
      const bytes = await readFile(target);
      const after = await stat(target);
      if (bytes.length > MAX_BYTES) throw new Error('This file is too large. The limit is 32 MB.');
      if (!sameFile(before, after) || await realpath(file) !== target) throw new Error('The file is still being saved.');
      return { markdown: decodeMarkdown(bytes), bytes, target, metadata: after };
    } catch (error) {
      // Editors may briefly lock, truncate, delete or replace a file during a save.
      if (attempt >= 4 || (!error.code && !error.message.includes('still being saved'))) throw error;
      await delay(60 * (attempt + 1));
    }
  }
}

async function readMarkdown(file) {
  return (await readSnapshot(file)).markdown;
}

function encodeMarkdown(markdown, original) {
  const lineEnding = original.markdown.match(/\r\n|\n|\r/)?.[0];
  const text = lineEnding ? markdown.replace(/\r\n|\n|\r/g, lineEnding) : markdown;
  if (original.bytes[0] === 0xff && original.bytes[1] === 0xfe) {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  }
  if (original.bytes[0] === 0xfe && original.bytes[1] === 0xff) {
    return Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]);
  }
  const bom = original.bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  return Buffer.from(`${bom ? '\uFEFF' : ''}${text}`, 'utf8');
}

function conflictError() {
  return Object.assign(new Error('The file changed outside MDView. Your edits have been kept. Reload the file before saving again.'), { code: 'DOCUMENT_CONFLICT' });
}

function describeError(error) {
  if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return 'File not found.';
  if (error.code === 'EACCES' || error.code === 'EPERM') return 'The file cannot be read. Check its permissions or whether another app has locked it.';
  return error.message || 'The file could not be read.';
}

class MarkdownDocument extends EventEmitter {
  constructor({ pollInterval = 750, debounceMs = 140 } = {}) {
    super();
    this.pollInterval = pollInterval;
    this.debounceMs = debounceMs;
    this.state = { path: null, name: '', markdown: '', error: '', revision: 0 };
    this.generation = 0;
    this.openRequest = 0;
    this.refreshRequest = 0;
    this.disposed = false;
    this.saving = false;
  }

  async open(file) {
    if (this.saving) throw new Error('Wait for the current save to finish.');
    const request = ++this.openRequest;
    if (typeof file !== 'string' || !isMarkdown(file)) throw new Error('Choose a .md or .markdown file.');
    const absolutePath = path.resolve(file);
    const markdown = await readMarkdown(absolutePath);
    if (this.disposed || request !== this.openRequest) return;
    if (this.saving) throw new Error('Wait for the current save to finish.');
    this.stopWatching();
    this.generation++;
    this.state = { path: absolutePath, name: path.basename(absolutePath), markdown, error: '', revision: this.state.revision + 1 };
    this.startWatching();
    this.emit('change', this.state);
    // Cover a save between the first read and installing the watcher.
    this.queueRefresh();
  }

  async save(markdown, baseMarkdown, documentId = this.generation) {
    if (this.disposed || !this.state.path) throw new Error('Open a Markdown file before saving.');
    if (this.saving) throw new Error('Wait for the current save to finish.');
    if (documentId !== this.generation) throw new Error('This document is no longer open. Your edits have been kept.');
    if (typeof markdown !== 'string' || typeof baseMarkdown !== 'string') throw new Error('Invalid Markdown content.');
    if (markdown.length > MAX_BYTES || baseMarkdown.length > MAX_BYTES) throw new Error('This file is too large. The limit is 32 MB.');
    const file = this.state.path;
    const generation = this.generation;
    let temporary;
    let handle;
    this.saving = true;
    // Invalidate a read that started before saving so it cannot restore old text.
    this.refreshRequest++;
    clearTimeout(this.refreshTimer);
    const current = () => {
      if (this.disposed || generation !== this.generation || file !== this.state.path) {
        throw new Error('This document is no longer open. Your edits have been kept.');
      }
    };
    try {
      const original = await readSnapshot(file);
      current();
      if (original.markdown !== baseMarkdown) throw conflictError();
      const bytes = markdown === original.markdown ? original.bytes : encodeMarkdown(markdown, original);
      if (bytes.length > MAX_BYTES) throw new Error('This file is too large. The limit is 32 MB.');
      if (!bytes.equals(original.bytes)) {
        // Replace the resolved target, never the symbolic link used to open it.
        // Hard-linked files cannot be replaced without separating their links.
        if (original.metadata.nlink > 1) throw new Error('This file has multiple hard links. Save it with an editor that supports hard-linked files. Your edits have been kept.');
        if (!(original.metadata.mode & 0o222)) throw new Error('This file is read-only. Check its permissions. Your edits have been kept.');
        await access(original.target, fs.constants.W_OK);
        temporary = path.join(path.dirname(original.target), `.mdview-${randomUUID()}.tmp`);
        handle = await open(temporary, 'wx', original.metadata.mode & 0o777);
        await handle.writeFile(bytes);
        if (process.platform !== 'win32') {
          await handle.chown(original.metadata.uid, original.metadata.gid);
          await handle.chmod(original.metadata.mode & 0o7777);
        }
        await handle.sync();
        await handle.close();
        handle = null;
        // Check again after preparing the replacement to catch edits during save.
        const latest = await readSnapshot(file);
        current();
        if (latest.target !== original.target || !sameFile(latest.metadata, original.metadata) || !latest.bytes.equals(original.bytes)) throw conflictError();
        await atomicReplace(temporary, original.target, original.bytes);
        temporary = null;
      }
      current();
      this.state = { ...this.state, markdown: decodeMarkdown(bytes), error: '', revision: this.state.revision + 1 };
      this.emit('change', this.state);
      return this.state;
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (temporary) await unlink(temporary).catch(() => {});
      this.saving = false;
      // Reconcile any outside change that arrived while the write was in flight.
      if (!this.disposed) this.queueRefresh();
    }
  }

  startWatching() {
    const file = this.state.path;
    const generation = this.generation;
    const changed = () => { if (generation === this.generation) this.queueRefresh(); };
    try {
      // Watching the directory survives the atomic rename used by many editors.
      // Expand Windows 8.3 paths before libuv watches them; short paths can abort
      // affected Node/Electron runtimes instead of emitting a catchable error.
      const directory = fs.realpathSync.native(path.dirname(file));
      this.watcher = fs.watch(directory, { persistent: false }, (_, name) => {
        if (!name || String(name) === path.basename(file)) changed();
      });
      this.watcher.on('error', () => { this.watcher?.close(); this.watcher = null; });
    } catch {
      // The stat watcher below also works where native events are unavailable.
    }
    this.pollListener = (current, previous) => { if (!sameFile(current, previous)) changed(); };
    fs.watchFile(file, { persistent: false, interval: this.pollInterval }, this.pollListener);
  }

  queueRefresh() {
    clearTimeout(this.refreshTimer);
    const request = ++this.refreshRequest;
    const generation = this.generation;
    if (this.saving) return;
    this.refreshTimer = setTimeout(() => this.refresh(generation, request), this.debounceMs);
    this.refreshTimer.unref?.();
  }

  async refresh(generation, request) {
    const current = () => !this.disposed && !this.saving && generation === this.generation && request === this.refreshRequest;
    if (!current()) return;
    try {
      const markdown = await readMarkdown(this.state.path);
      if (!current() || (markdown === this.state.markdown && !this.state.error)) return;
      this.state = { ...this.state, markdown, error: '', revision: this.state.revision + 1 };
    } catch (error) {
      if (!current()) return;
      const message = `${describeError(error)} Waiting for the file to become available.`;
      // Releasing a file lock does not necessarily produce a filesystem event.
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => { if (current()) this.queueRefresh(); }, 1000);
      this.refreshTimer.unref?.();
      if (message === this.state.error) return;
      // Keep the last successful rendering while waiting for the file to return.
      this.state = { ...this.state, error: message };
    }
    this.emit('change', this.state);
  }

  stopWatching() {
    clearTimeout(this.refreshTimer);
    this.refreshRequest++;
    this.watcher?.close();
    this.watcher = null;
    if (this.pollListener && this.state.path) fs.unwatchFile(this.state.path, this.pollListener);
    this.pollListener = null;
  }

  close() {
    this.disposed = true;
    this.openRequest++;
    this.generation++;
    this.stopWatching();
    this.removeAllListeners();
  }
}

module.exports = { MarkdownDocument, readMarkdown, isMarkdown, describeError };
