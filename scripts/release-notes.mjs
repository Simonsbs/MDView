import { readFile, writeFile, mkdir } from 'node:fs/promises';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const tag = process.env.RELEASE_TAG || `v${version}`;
if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match package version ${version}.`);
const changelog = await readFile('CHANGELOG.md', 'utf8');
const heading = `## [${version}]`;
const start = changelog.indexOf(heading);
if (start < 0) throw new Error(`CHANGELOG.md has no entry for ${version}.`);
const remainder = changelog.slice(start + heading.length);
const end = remainder.indexOf('\n## [');
const entry = (end < 0 ? remainder : remainder.slice(0, end)).trim();
const changes = entry.slice(entry.indexOf('\n') + 1).split('\n[Unreleased]:')[0].trim();
await mkdir('release', { recursive: true });
await writeFile('release/RELEASE_NOTES.md', `# MDView ${version}\n\nA focused Markdown viewer for Windows and Linux. Open a file, see saved changes automatically, and resize text with Ctrl+scroll.\n\n${changes}\n\n## Downloads\n\n- Windows: use the \`-setup.exe\` installer for .md registration, or \`-portable.exe\` to run without installation.\n- Ubuntu/Debian: install the \`.deb\` package.\n- Other Linux desktops: use the \`.AppImage\` or extract the \`.tar.gz\` archive.\n- Verify downloaded files against \`SHA256SUMS.txt\`.\n\nWindows requires its own confirmation to replace a protected default-app choice. Setup includes that step. Linux registers MDView as the current user's Markdown default on first launch.\n\n[Installation and default-app instructions](https://github.com/Simonsbs/MDView/blob/${tag}/docs/installation.md) · [Source and licence](https://github.com/Simonsbs/MDView/tree/${tag})\n\nPackages are unsigned. The release includes application, Electron and Chromium licence notices.\n`);
console.log(`Prepared release notes for ${tag}.`);
