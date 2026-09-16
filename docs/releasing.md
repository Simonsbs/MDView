# Releasing

The package version, changelog and Git tag must agree. Use Semantic Versioning. Version 1.0.0 is the initial public release. The current release is 1.1.0.

## Prepare

1. Start from a clean `main` with passing CI.
2. Run `npm version <version> --no-git-tag-version` to update the package and lockfile.
3. Move Unreleased notes to a dated `## [<version>] - YYYY-MM-DD` changelog section. Update comparison links and version examples.
4. Run `npm ci`, `npm run notices`, `npm test` and UI tests. Check changed installers, including associations and removal.
5. Commit the preparation.

## Publish

```sh
git tag -a v1.1.0 -m "MDView 1.1.0"
git push origin main
git push origin v1.1.0
```

Substitute the version being released. GitHub Actions tests both platforms, builds packages natively and checks the packaged apps. For a matching version tag, a final job generates checksums and notes, then publishes a GitHub Release after both platforms pass.

Actions are pinned. Only the release job has repository-write permission. It uses GitHub's scoped `GITHUB_TOKEN`, without a personal token.

## Assets

- `MDView-<version>-windows-x64-setup.exe`
- `MDView-<version>-windows-x64-portable.exe`
- `MDView-<version>-linux-x64.AppImage`
- `MDView-<version>-linux-x64.deb`
- `MDView-<version>-linux-x64.tar.gz`
- `SHA256SUMS.txt`

GitHub provides source archives for the tag. Packages include the project licence, changelog, README, third-party notices and Electron/Chromium notices.

## Recovery

If publication fails after builds pass, download the `packages-*` workflow artifacts into `release/` on the matching tagged checkout:

```sh
node scripts/checksums.mjs --require-all
node scripts/release-notes.mjs
```

Inspect `gh release view v<version>` first. If absent, create a draft using `gh release create` with `--verify-tag`, `--draft` and `--notes-file release/RELEASE_NOTES.md`, uploading all packages and checksums. Verify assets before publishing. Finish an existing draft instead of creating a duplicate. Changed published binaries require a new version.

Check that the public tag matches the commit, all assets download, checksums match, README links work and CI is green. Keep unsigned-package and platform limitations accurate.
