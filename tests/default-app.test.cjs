const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { windowsRegistration, desktopEntry, registerDefault } = require('../src/default-app.cjs');
const run = promisify(execFile);

test('Windows registration quotes executable and document paths and leaves UserChoice protected', async () => {
  const executable = 'C:\\Program Files\\MDView\\MDView.exe';
  const calls = [];
  const result = await registerDefault({ platform: 'win32', executable, execute: async (...args) => calls.push(args) });
  assert.equal(result.needsWindowsConfirmation, true);
  assert.ok(calls.some(([, args]) => args.includes('"C:\\Program Files\\MDView\\MDView.exe" "%1"')));
  assert.ok(calls.some(([, args]) => args.includes('HKCU\\Software\\RegisteredApplications')));
  assert.ok(calls.every(([, args]) => !args.some(arg => arg.includes('UserChoice'))));
  assert.ok(calls.every(([, args]) => !args.includes('.txt')));
  assert.throws(() => windowsRegistration('C:\\bad"path.exe'), /Unsupported/);
});

test('desktop registration quotes a path and advertises only Markdown', () => {
  const entry = desktopEntry('/home/user/My Apps/MDView.AppImage', '/tmp/icon.png');
  assert.ok(entry.includes('Exec="/home/user/My Apps/MDView.AppImage" %f'));
  assert.ok(entry.includes('MimeType=text/markdown;'));
  assert.ok(!entry.includes('MimeType=text/plain'));
  assert.throws(() => desktopEntry('/tmp/app\nExec=evil', '/tmp/icon'), /Unsupported/);
});

test('Linux registration installs a stable launcher/icon and verifies the requested default', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-association-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const icon = path.join(directory, 'source.png');
  await writeFile(icon, 'sample icon');
  const commands = [];
  const env = { ...process.env, XDG_DATA_HOME: path.join(directory, 'data'), XDG_CONFIG_HOME: path.join(directory, 'config') };
  await registerDefault({ platform: 'linux', executable: '/opt/My Apps/mdview', icon, env,
    execute: async (command, args) => { commands.push([command, ...args]); return { stdout: 'mdview.desktop\n' }; },
  });
  const desktop = await readFile(path.join(env.XDG_DATA_HOME, 'applications', 'mdview.desktop'), 'utf8');
  assert.ok(desktop.includes('Exec="/opt/My Apps/mdview" %f'));
  assert.ok(!desktop.includes(`Icon=${icon}\n`));
  assert.ok(commands.some(args => args.join(' ') === 'xdg-mime default mdview.desktop text/markdown'));
  assert.ok(commands.every(args => !args.includes('text/plain')));
  const xml = await readFile(path.join(env.XDG_DATA_HOME, 'mime/packages/mdview-markdown.xml'), 'utf8');
  assert.ok(xml.includes('glob pattern="*.md"'));
  assert.ok(!xml.includes('*.txt'));
});

test('Linux xdg tools report MDView for .md without changing the plain-text default', { skip: process.platform !== 'linux' }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-xdg-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { ...process.env, XDG_DATA_HOME: path.join(directory, 'data'), XDG_CONFIG_HOME: path.join(directory, 'config'), XDG_CURRENT_DESKTOP: '' };
  const textBefore = await run('xdg-mime', ['query', 'default', 'text/plain'], { env });
  const markdownFile = path.join(directory, 'document.md');
  const textFile = path.join(directory, 'document.txt');
  await writeFile(markdownFile, '# Sample');
  await writeFile(textFile, 'Sample');
  await registerDefault({ platform: 'linux', executable: process.execPath, icon: path.resolve('assets/icon.png'), env });
  assert.equal((await run('xdg-mime', ['query', 'default', 'text/markdown'], { env })).stdout.trim(), 'mdview.desktop');
  assert.equal((await run('xdg-mime', ['query', 'filetype', markdownFile], { env })).stdout.trim(), 'text/markdown');
  assert.equal((await run('xdg-mime', ['query', 'filetype', textFile], { env })).stdout.trim(), 'text/plain');
  assert.equal((await run('xdg-mime', ['query', 'default', 'text/plain'], { env })).stdout, textBefore.stdout);
});
