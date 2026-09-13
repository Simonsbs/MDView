import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const expected = [
  `MDView-${version}-windows-x64-setup.exe`,
  `MDView-${version}-windows-x64-portable.exe`,
  `MDView-${version}-linux-x64.AppImage`,
  `MDView-${version}-linux-x64.deb`,
  `MDView-${version}-linux-x64.tar.gz`,
];
const available = await readdir('release');
if (process.argv.includes('--require-all')) {
  for (const name of expected) if (!available.includes(name)) throw new Error(`Missing release package: ${name}`);
}
const files = expected.filter(name => available.includes(name));
if (!files.length) throw new Error('No packages found for the current version.');
const lines = [];
for (const name of files.sort()) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(`release/${name}`)) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${name}`);
}
await writeFile('release/SHA256SUMS.txt', `${lines.join('\n')}\n`);
console.log(`Checksums written for ${lines.length} packages.`);
