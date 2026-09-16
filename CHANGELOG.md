# Changelog

User-visible changes are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

No changes yet.

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

[Unreleased]: https://github.com/Simonsbs/MDView/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Simonsbs/MDView/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Simonsbs/MDView/releases/tag/v1.0.0
