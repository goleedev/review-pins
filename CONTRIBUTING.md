# Contributing to Review Pins

Thanks for helping. Bug reports with clear steps are the most useful contribution right now.

## Reporting issues

Use the issue templates. Please include your OS, VS Code version, Review Pins version, and the exact steps. Do not paste private source code, absolute paths, tokens or other secrets; a small, made-up example is enough.

## Building

Requirements: Node.js 20.19+ and npm, Git, and VS Code 1.100+.

```sh
npm ci
npm test            # compile + unit tests
npm run test:host   # integration tests in a real VS Code host
npm run package     # builds review-pins-<version>.vsix
```

Open the folder in VS Code and press **F5** (**Run Review Pins**) to start an Extension Development Host. Edit TypeScript in `src/`; generated JavaScript goes to the ignored `dist/` folder.

`npm run test:host` downloads a VS Code test build by default. To use an installed build instead (macOS example):

```sh
VSCODE_EXECUTABLE='/Applications/Visual Studio Code.app/Contents/MacOS/Code' npm run test:host
```

More notes, including host-test troubleshooting, are in [docs/development.md](docs/development.md). Design notes are in [docs/architecture.md](docs/architecture.md), and the manual release checklist is in [docs/manual-testing.md](docs/manual-testing.md).

## Pull requests

- Keep changes small and focused, with tests (`test/core.test.ts` for logic, `test/host-runner.ts` for VS Code behavior).
- Do not change the stored pin format without a backwards-compatible plan.
- Keep privacy guarantees: no telemetry, no network calls, no automatic sending of pin data, and no automatic resolving or verifying.
- Run `npm test`, `npm run test:host` and `npm run package` before opening a pull request.

By contributing, you agree that your contributions are licensed under the MIT License.
