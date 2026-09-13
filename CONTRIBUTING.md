# Contributing

MDView stays focused on opening Markdown, following saved changes and adjusting text size. Reliability, rendering, accessibility, installation and platform fixes are welcome. Discuss features that add controls or configuration in an issue first.

1. Check existing issues and pull requests.
2. Fork the repository and create a branch from `main`.
3. Follow [development setup](docs/development.md).
4. Make a focused change and add a meaningful regression test for changed behaviour.
5. Add user-visible changes to the Unreleased section of [CHANGELOG.md](CHANGELOG.md).
6. Open a pull request describing the problem, resulting behaviour and validation.

Use two-space indentation for JavaScript/JSON, LF line endings and existing module conventions. Avoid unnecessary dependencies and unrelated formatting. Keep application text concise and accessible.

Run `npm test` and `npm run test:ui`. Headless Linux uses `xvfb-run -a npm run test:ui`. Packaging and association changes need the relevant packaged-app checks in [development](docs/development.md).

Do not commit packages, `node_modules`, profiles, credentials or private documents. Bug reports should include a minimal shareable Markdown example.

Contributions use the project's [MIT licence](LICENSE). Preserve third-party notices and run `npm run notices` after production dependency updates. No separate contributor licence agreement is required.

Follow the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through [SECURITY.md](SECURITY.md), not public issues.
