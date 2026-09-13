import { create, list } from 'tar';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const name = `MDView-${version}-linux-x64`;
const file = `release/${name}.tar.gz`;
const executables = new Set(['mdview', 'chrome-sandbox', 'chrome_crashpad_handler']);

// Windows filesystem metadata does not preserve Linux executable permissions.
await create({
  file,
  cwd: 'release/linux-unpacked',
  prefix: name,
  portable: true,
  gzip: { level: 6 },
  onWriteEntry(entry) {
    entry.stat.mode = entry.type === 'Directory' || executables.has(path.basename(entry.path)) ? 0o755 : 0o644;
  },
}, ['.']);

const verified = new Set();
await list({
  file,
  onReadEntry(entry) {
    const name = path.posix.basename(entry.path);
    if (executables.has(name)) {
      if ((entry.mode & 0o111) !== 0o111) throw new Error(`Missing executable permissions: ${entry.path}`);
      verified.add(name);
    }
  },
});
for (const executable of executables) {
  if (!verified.has(executable)) throw new Error(`Missing Linux executable: ${executable}`);
}
console.log(`Created and verified ${file}`);
