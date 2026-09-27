const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { rename } = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const runFile = promisify(execFile);

// File.Replace uses Windows ReplaceFile, which keeps the destination's ACLs,
// encryption and other security metadata. Renaming a fresh file would lose them.
// The command is constant: document paths never become PowerShell source text.
const replacementScript = `
$ErrorActionPreference = 'Stop'
try {
  $mdviewSource = $env:MDVIEW_SAVE_REPLACEMENT
  $mdviewTarget = $env:MDVIEW_SAVE_TARGET
  $mdviewExpected = $env:MDVIEW_SAVE_EXPECTED_SHA256
  $mdviewHasher = [Security.Cryptography.SHA256]::Create()
  try {
    $mdviewActual = [BitConverter]::ToString($mdviewHasher.ComputeHash([IO.File]::ReadAllBytes($mdviewTarget))).Replace('-', '').ToLowerInvariant()
  } finally {
    $mdviewHasher.Dispose()
  }
  if ($mdviewActual -ne $mdviewExpected) {
    [Console]::Error.WriteLine('MDVIEW_SAVE_CONFLICT')
    exit 3
  }
  [IO.File]::Replace($mdviewSource, $mdviewTarget, [NullString]::Value, $false)
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;
const encodedScript = Buffer.from(replacementScript, 'utf16le').toString('base64');

async function atomicReplace(temporary, target, originalBytes) {
  if (process.platform !== 'win32') return rename(temporary, target);
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    await runFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript], {
      shell: false,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 64 * 1024,
      env: {
        ...process.env,
        MDVIEW_SAVE_REPLACEMENT: temporary,
        MDVIEW_SAVE_TARGET: target,
        MDVIEW_SAVE_EXPECTED_SHA256: createHash('sha256').update(originalBytes).digest('hex'),
      },
    });
  } catch (error) {
    if (error.code === 3 && String(error.stderr).includes('MDVIEW_SAVE_CONFLICT')) {
      throw Object.assign(new Error('The file changed outside MDView. Your edits have been kept. Reload the file before saving again.'), { code: 'DOCUMENT_CONFLICT' });
    }
    const detail = error.killed ? 'The Windows file replacement timed out.'
      : error.code === 'ENOENT' ? 'Windows PowerShell is unavailable.'
        : String(error.stderr || 'Windows could not complete the file replacement.').trim();
    throw new Error(`Could not safely replace the file. ${detail} Your edits have been kept.`);
  }
}

module.exports = { atomicReplace };
