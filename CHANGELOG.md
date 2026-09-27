# Changelog

User-visible changes are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

No changes yet.

## [1.2.0] - 2026-09-27

### Added

- Optional WYSIWYG editing with Edit/Ctrl+E, explicit Save/Ctrl+S and Cancel. The app still opens in viewing mode.
- Save and Ctrl+S keep editing mode open, preserving the cursor position and undo history. Cancel returns to the preview, with confirmation for changes since the last save.
- Formatting controls for headings, bold, italic, strikethrough, inline code, lists, tasks, quotes, code blocks, links, images and tables, plus row/column insertion and undo/redo.
- Unsaved-change confirmations when cancelling, opening another file or closing, and save protection when another app changes the file.
- Saves preserve encoding, byte-order marks and newline style. Entering and leaving editing without changes preserves the original bytes.

### Editing boundaries

- Visual edits may normalize Markdown list markers, reference links and whitespace. Unsupported complex table edits are rejected without saving.
- Raw HTML remains literal text, and saving is restricted to the currently opened document.

## [1.1.0] - 2026-09-16

### Added

- A toolbar switch for light and dark mode, with your choice remembered across launches. The app follows the system appearance until you choose a theme.
- A reading-width slider from 20% to 100% of the available window width, starting at 80%. Full width removes the previous fixed maximum, and your choice is remembered across launches.
- Keyboard support for the width slider and a toolbar that wraps to keep the controls usable in narrow windows.

### Changed

- Preserve the current reading position when adjusting the width. Live refresh and Ctrl+scroll text sizing continue to work with either theme and any width.

## [1.0.0] - 2026-09-13

### Added

- Initial open-source release under the MIT licence.
- Markdown viewing on Windows and Linux, with native file picking, drag and drop, Ctrl+O, and command-line opening.
- Automatic refresh after normal saves and atomic replacement, with scroll position and text size preserved.
- Ctrl+scroll text sizing from 50% to 300%.
- Tables, task lists, code blocks, images, links, UTF-8 and UTF-16 support, and system light/dark appearance.
- Recovery from temporarily missing or unreadable files without discarding the last preview.
- Windows installer and portable executable; Linux AppImage, Debian package and portable archive.
- `.md` default-app registration: Windows setup registration with the required Windows confirmation, and Linux user-level registration on first launch.
- Installation, contribution, security and release documentation, source and packaged-app tests, and GitHub Actions builds and releases.
- SHA-256 package checksums and third-party licence notices.

### Boundaries

- x64 builds; files up to 32 MB.
- Raw HTML is displayed as text. Mermaid and code syntax highlighting are not supported.
- Windows packages are unsigned. Linux packages require a compatible graphical desktop.
- Windows default selection uses the system's own confirmation and cannot be silently forced by the installer.

[Unreleased]: https://github.com/Simonsbs/MDView/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Simonsbs/MDView/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Simonsbs/MDView/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Simonsbs/MDView/releases/tag/v1.0.0
