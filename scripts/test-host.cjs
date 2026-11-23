const { runTests } = require('@vscode/test-electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'review-pins-host-'));
  const workspace = path.join(base, 'workspace'); fs.mkdirSync(workspace);
  execFileSync('git', ['init', '-q', workspace]);
  // One commit so pins record origin.commit and privacy checks on commit hashes actually run.
  execFileSync('git', ['-C', workspace, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']);
  fs.writeFileSync(path.join(workspace, 'sample.ts'), 'const ready = true;\nif (ready) save();\n');
  // Open the workspace through a symlink (like macOS /tmp) so tests cover real-path vs. workspace-path handling.
  const link = path.join(base, 'link'); fs.symlinkSync(workspace, link, 'dir');
  try {
    await runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
      extensionDevelopmentPath: path.resolve(__dirname, '..'),
      extensionTestsPath: path.resolve(__dirname, '../dist/test/host-runner.js'),
      launchArgs: [link,'--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--user-data-dir', path.join(base, 'user'), '--extensions-dir', path.join(base, 'extensions')]
    });
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
