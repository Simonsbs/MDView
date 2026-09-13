# Development

Install Node.js 24 LTS (minimum 22.22.1), Git and npm, then run:

```sh
npm ci
npm start
npm start -- /path/to/notes.md
```

Linux UI tests require Electron's system libraries and a display or Xvfb. CI's exact setup is in [.github/workflows/build.yml](../.github/workflows/build.yml).

## Architecture

The app uses plain JavaScript, Electron, markdown-it and esbuild. It has no application server.

| Path | Responsibility |
| --- | --- |
| `src/main.cjs` | Window, file picker, IPC, resources and startup |
| `src/document.cjs` | Read-only loading, watching, polling and recovery |
| `src/default-app.cjs` | Windows registration and Linux desktop/MIME defaults |
| `src/preload.cjs` | Narrow bridge for the sandboxed renderer |
| `src/renderer.js` | Rendering, scroll retention, keyboard and wheel input |
| `src/index.html`, `src/styles.css` | Layout and styling |
| `assets/installer.nsh` | Windows setup registration and removal |
| `tests/`, `scripts/` | Verification, packaging and release tooling |

## Tests

```sh
npm test
npm run test:ui
```

The filesystem suite exercises real saves, replacement, deletion, recovery, switching and encoding. Association tests isolate registration calls and XDG directories. Playwright launches the actual app to check rendering, opening, live refresh, scrolling, zoom and links. Native file-picker selections and external browser launches are stubbed while exercising real IPC.

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
