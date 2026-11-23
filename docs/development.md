# Development notes

Use Node.js 20.19+ and npm.

```sh
npm ci
npm test
npm run package
```

Open this folder in VS Code and press **F5** using **Run Review Pins**. In the new Extension Development Host window, open a local Git folder and use the commands above. Generated JavaScript lives in ignored `dist/`; edit the TypeScript files in `src/`.

Install the resulting `review-pins-0.1.0.vsix` through **Extensions: Install from VSIX…**, or:

```sh
code --install-extension review-pins-0.1.0.vsix
```

The `publisher` value in `package.json` is only a namespace until a Marketplace publisher with that name is created and owned by the maintainer.

### Integration tests

```sh
npm run test:host
```

This normally downloads a VS Code test build. With `@vscode/test-electron` 2.5 and VS Code 1.147, the cached build may fail with `spawn … Contents/MacOS/Electron ENOENT` (the app binary is named `Code`); use an installed build as shown below. To use an installed macOS build instead:

```sh
VSCODE_EXECUTABLE='/Applications/Visual Studio Code.app/Contents/MacOS/Code' npm run test:host
```

Tests use a temporary Git workspace and isolated user data. They do not modify your normal VS Code profile or install into it.


## Releasing

See `docs/manual-testing.md` for release verification and `docs/architecture.md` for the module boundaries. Record any manual checks not performed before describing a release as ready.

## Host test troubleshooting

- Do not run `Code --version` from the app bundle to check for VS Code: `Contents/MacOS/Code` is the Electron binary, so it starts a full instance and never exits. Use `Contents/Resources/app/bin/code` for CLI calls.
- Wrap runs in a hard timeout (for example `perl -e 'alarm 180; exec @ARGV' npm run test:host`; macOS has no `timeout`). A killed run can leave test instances behind; stop them with `pkill -f review-pins-host-` before retrying.
- Set `REVIEW_PINS_HOST_FAILURE_FILE=/some/path` to have the runner write `<path>.started` when it begins and the assertion stack to `<path>` on failure. VS Code can exit before the failure reaches the console.
- The test stubs `vscode.window` prompts, so the runner must live inside the extension folder under test (it does for `npm run test:host`).
