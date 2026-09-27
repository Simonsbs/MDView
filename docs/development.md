# Development

Install Node.js 24 LTS (minimum 22.22.1), Git and npm, then run:

```sh
npm ci
npm start
npm start -- /path/to/notes.md
```

Linux UI tests require Electron's system libraries and a display or Xvfb. CI's exact setup is in [.github/workflows/build.yml](../.github/workflows/build.yml).

## Architecture

The app uses plain JavaScript, Electron, markdown-it, ProseMirror and esbuild. It has no application server. Viewing remains the default; visual editing is explicitly entered and saved.

| Path | Responsibility |
| --- | --- |
| `src/main.cjs` | Window, file picker, IPC, resources and startup |
| `src/document.cjs` | Loading, watching, conflict-checked saves, encoding and recovery |
| `src/atomic-replace.cjs` | Atomic file replacement, preserving Windows file security metadata |
| `src/default-app.cjs` | Windows registration and Linux desktop/MIME defaults |
| `src/preload.cjs` | Narrow bridge for the sandboxed renderer |
| `src/renderer.js` | Rendering, scroll retention, keyboard and wheel input |
| `src/editor.js` | Visual editor, formatting commands, tables and task controls |
| `src/editor-markdown.js` | CommonMark/GFM schema, safe parsing and Markdown serialization |
| `src/index.html`, `src/styles.css` | Layout and styling |
| `assets/installer.nsh` | Windows setup registration and removal |
| `tests/`, `scripts/` | Verification, packaging and release tooling |

The editor keeps a draft until Save (Ctrl+S); Edit uses Ctrl+E. Saving keeps the editor, selection and undo history intact and advances the saved-document baseline. Cancel, opening another document and closing the window protect changes made since the last save with a discard confirmation. Saving is restricted to the currently opened document and checks its identity and on-disk content before replacing it. Outside changes keep the draft available and block the save.

Changed documents preserve their UTF-8 or BOM-marked UTF-16 encoding, BOM and newline style. An unchanged editor document does not write the file. Serialization may normalize source whitespace, list markers and reference links. Unsupported table structures throw before writing. Both the viewer and editor disable raw HTML; editor link and image attributes are validated.

Windows saves use the built-in Windows PowerShell to call .NET File.Replace; file paths are passed as child-process environment data. Linux uses an atomic rename. A failed replacement leaves the draft available in the editor.

## Tests

```sh
npm test
npm run test:ui
```

The filesystem suite exercises real saves, conflict detection, replacement, deletion, recovery, switching and encoding. Markdown tests cover editing round trips, task state, table alignment and escaping, and unsupported structures. Association tests isolate registration calls and XDG directories. Playwright launches the actual app to check viewing, editing, saving, cancellation, unsaved-change prompts, live refresh and appearance controls. Native file-picker selections and external browser launches are stubbed while exercising real IPC.

UI tests pass `--no-default-registration` so test runs cannot change a developer's desktop preferences. Installation and association checks are separate.

```sh
xvfb-run -a npm run test:ui
```

To test a package, set `MDVIEW_EXECUTABLE` to its executable and run `node node_modules/@playwright/test/cli.js test`. On Linux, `bash scripts/verify-linux.sh` extracts the archive, checks executable permissions and runs the UI suite under Xvfb.

## Packages

```sh
npm run dist:win             # On Windows
npm run dist:linux           # On Linux
npm run dist:linux:archive   # Also works on Windows
npm run checksums
```

Outputs go to `release/`. Windows setup and portable launchers have separate filenames. Linux produces AppImage, `.deb` and `.tar.gz` assets. Archive executable permissions are written explicitly because Windows metadata does not retain them.

For installer changes, verify installation, removal, registration, quoted paths and the packaged viewer. Check the Windows Default apps handoff. On Linux, check `xdg-mime query default text/markdown` in an isolated profile and verify `.txt` is unchanged.

## Dependencies and icons

Commit the lockfile with dependency changes. Run `npm run notices`, `npm audit --omit=dev` and both platforms' tests. Electron is pinned in `package.json`.

Icons are committed assets. `scripts/generate-icon.ps1` regenerates them on Windows using System.Drawing.
