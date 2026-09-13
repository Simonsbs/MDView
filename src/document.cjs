const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { readFile, stat } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const MAX_BYTES = 32 * 1024 * 1024;
const isMarkdown = file => /\.(md|markdown|mdown|mkd)$/i.test(file);
const sameFile = (a, b) => a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino;

function decodeMarkdown(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

async function readMarkdown(file) {
  for (let attempt = 0; ; attempt++) {
    try {
      const before = await stat(file);
      if (!before.isFile()) throw new Error('Choose a Markdown file.');
      if (before.size > MAX_BYTES) throw new Error('This file is too large. The limit is 32 MB.');
      const bytes = await readFile(file);
      const after = await stat(file);
      if (bytes.length > MAX_BYTES) throw new Error('This file is too large. The limit is 32 MB.');
      if (!sameFile(before, after)) throw new Error('The file is still being saved.');
      return decodeMarkdown(bytes);
    } catch (error) {
      // Editors may briefly lock, truncate, delete or replace a file during a save.
      if (attempt >= 4 || (!error.code && !error.message.includes('still being saved'))) throw error;
      await delay(60 * (attempt + 1));
    }
  }
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
  }

  async open(file) {
    const request = ++this.openRequest;
    if (typeof file !== 'string' || !isMarkdown(file)) throw new Error('Choose a .md or .markdown file.');
    const absolutePath = path.resolve(file);
    const markdown = await readMarkdown(absolutePath);
    if (this.disposed || request !== this.openRequest) return;
    this.stopWatching();
    this.generation++;
    this.state = { path: absolutePath, name: path.basename(absolutePath), markdown, error: '', revision: this.state.revision + 1 };
    this.startWatching();
    this.emit('change', this.state);
    // Cover a save between the first read and installing the watcher.
    this.queueRefresh();
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
    this.refreshTimer = setTimeout(() => this.refresh(generation, request), this.debounceMs);
    this.refreshTimer.unref?.();
  }

  async refresh(generation, request) {
    const current = () => !this.disposed && generation === this.generation && request === this.refreshRequest;
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
