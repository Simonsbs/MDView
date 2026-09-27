# Security policy

Security fixes target the latest stable release. Upgrade older versions before reporting a previously fixed issue. No response time is guaranteed.

## Reporting

Use [GitHub private vulnerability reporting](https://github.com/Simonsbs/MDView/security/advisories/new). Include the version, OS, reproduction steps, impact and a minimal sample. Do not post working exploits, credentials or private documents in public issues.

If private reporting is unavailable, open an issue requesting a private channel without vulnerability details.

## Boundaries

- Markdown HTML is disabled; the renderer is sandboxed and isolated from Node.js. Resources use a restricted custom protocol.
- MDView reads selected documents and referenced images. Remote images contact their hosts. Clicked web links open the browser.
- Visual editing writes only when Save is requested and only to the currently opened file. Save requests cannot supply another destination path. Document identity and on-disk changes are checked before replacement; conflicts retain the draft without overwriting the changed file.
- Raw HTML remains text in the editor, and link and image attributes are validated. Unsupported table structures fail before saving.
- Default registration writes application registration and Markdown associations. It does not bypass Windows UserChoice protection or disable the Electron sandbox.
- Binaries are unsigned. Download from the repository's releases and compare checksums. There is no automatic updater.

Dependency updates require source and packaged-app verification. Electron and Chromium notices are retained in distributed binaries.
