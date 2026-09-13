import { readFile, writeFile } from 'node:fs/promises';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const libraries = Object.entries(lock.packages).filter(([name, info]) => name && !info.dev);
let text = '# Third-party notices\n\nMDView source is MIT-licensed. The following libraries retain their own licences and notices. This file is generated from the locked production dependencies by `npm run notices`.\n\nElectron and Chromium are included in desktop releases. Their notices are shipped as `LICENSE.electron.txt` and `LICENSES.chromium.html` next to the executable. Build and test tools have separate licences in their installed npm packages.\n';
for (const [directory, info] of libraries) {
  const pkg = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
  let license;
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'LICENSE-MIT.txt', 'COPYING']) {
    try { license = await readFile(`${directory}/${name}`, 'utf8'); break; } catch {}
  }
  if (!license) throw new Error(`Missing licence text for ${pkg.name}`);
  text += `\n## ${pkg.name} ${info.version}\n\nLicence: ${info.license || pkg.license}\n\n\`\`\`text\n${license.trim()}\n\`\`\`\n`;
}
await writeFile('THIRD_PARTY_NOTICES.md', text);
console.log(`Wrote notices for ${libraries.length} production dependencies.`);
