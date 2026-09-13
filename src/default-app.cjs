const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdir, writeFile, readFile, access } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const run = promisify(execFile);

function windowsRegistration(executable) {
  if (/["\r\n]/.test(executable)) throw new Error('Unsupported application path.');
  const command = `"${executable}" "%1"`;
  const classes = 'HKCU\\Software\\Classes';
  const capabilities = 'HKCU\\Software\\MDView\\Capabilities';
  return [
    [`${classes}\\MDView.Markdown`, null, 'Markdown document'],
    [`${classes}\\MDView.Markdown\\DefaultIcon`, null, `"${executable}",0`],
    [`${classes}\\MDView.Markdown\\shell\\open\\command`, null, command],
    [`${classes}\\.md\\OpenWithProgids`, 'MDView.Markdown', ''],
    [`${classes}\\Applications\\MDView.exe`, 'FriendlyAppName', 'MDView'],
    [`${classes}\\Applications\\MDView.exe\\shell\\open\\command`, null, command],
    [`${classes}\\Applications\\MDView.exe\\SupportedTypes`, '.md', ''],
    [capabilities, 'ApplicationName', 'MDView'],
    [capabilities, 'ApplicationDescription', 'Read Markdown files with automatic refresh.'],
    [`${capabilities}\\FileAssociations`, '.md', 'MDView.Markdown'],
    ['HKCU\\Software\\RegisteredApplications', 'MDView', 'Software\\MDView\\Capabilities'],
  ].map(([key, name, value]) => ['add', key, ...(name === null ? ['/ve'] : ['/v', name]), '/t', 'REG_SZ', '/d', value, '/f']);
}

function desktopEntry(executable, icon) {
  if (/[\r\n]/.test(executable + icon)) throw new Error('Unsupported application path.');
  // Desktop Exec fields have their own escaping rules, independent of the shell.
  const quoted = executable.replace(/\\/g, '\\\\\\\\').replace(/"/g, '\\\\"').replace(/`/g, '\\\\`').replace(/\$/g, '\\\\$').replace(/%/g, '%%');
  const stringValue = value => value.replace(/\\/g, '\\\\');
  return `[Desktop Entry]\nType=Application\nName=MDView\nComment=Read Markdown files with automatic refresh\nExec="${quoted}" %f\nTryExec=${stringValue(executable)}\nIcon=${stringValue(icon)}\nTerminal=false\nCategories=Office;\nMimeType=text/markdown;\n`;
}

async function registerDefault({ platform = process.platform, executable, icon, env = process.env, execute = run } = {}) {
  if (platform === 'win32') {
    const registryTool = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    for (const args of windowsRegistration(executable)) await execute(registryTool, args, { windowsHide: true });
    return { needsWindowsConfirmation: true };
  }
  if (platform !== 'linux') throw new Error('Default-app registration is supported on Windows and Linux.');
  const dataHome = env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const applications = path.join(dataHome, 'applications');
  await mkdir(applications, { recursive: true });
  const mimeDirectory = path.join(dataHome, 'mime');
  await mkdir(path.join(mimeDirectory, 'packages'), { recursive: true });
  await writeFile(path.join(mimeDirectory, 'packages', 'mdview-markdown.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info"><mime-type type="text/markdown"><comment>Markdown document</comment><sub-class-of type="text/plain"/><glob pattern="*.md"/></mime-type></mime-info>\n');
  await execute('update-mime-database', [mimeDirectory], { env });
  // Installed .deb packages already provide a desktop entry that uninstalls cleanly.
  let systemEntry = false;
  if (executable === '/opt/MDView/mdview') {
    try { await access('/usr/share/applications/mdview.desktop'); systemEntry = true; } catch {}
  }
  if (!systemEntry) {
    const installedIcon = path.join(dataHome, 'icons', 'hicolor', '256x256', 'apps', 'mdview.png');
    await mkdir(path.dirname(installedIcon), { recursive: true });
    await writeFile(installedIcon, await readFile(icon));
    await writeFile(path.join(applications, 'mdview.desktop'), desktopEntry(executable, installedIcon));
  }
  try { await execute('update-desktop-database', [applications], { env }); } catch {}
  await execute('xdg-mime', ['default', 'mdview.desktop', 'text/markdown'], { env });
  const result = await execute('xdg-mime', ['query', 'default', 'text/markdown'], { env });
  if (result.stdout.trim() !== 'mdview.desktop') throw new Error('The desktop did not select MDView. Choose it in your file manager using Open With.');
  return { needsWindowsConfirmation: false };
}

module.exports = { windowsRegistration, desktopEntry, registerDefault };
