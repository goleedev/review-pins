#!/usr/bin/env node
// Builds a disposable, non-sensitive demo for README screenshots. Never touches your normal VS Code profile or QA data.
//   npm run compile && node demo/setup-demo.cjs          -> fresh demo repo + isolated profile + seeded pins
//   node demo/setup-demo.cjs --stale                     -> edit pricing.ts so one pin becomes STALE (screenshot 2)
// Everything lives under DEMO_DIR (default /tmp/rp-demo; keep it short: VS Code's socket path limit is ~103 characters).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { capture, createPin, hash } = require('../dist/src/domain');
const { PinStore } = require('../dist/src/store');

const base = path.resolve(process.env.DEMO_DIR || '/tmp/rp-demo');
const repo = path.join(base, 'acme-checkout'), user = path.join(base, 'user'), ext = path.join(base, 'ext');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' }).toString().trim();

if (process.argv.includes('--stale')) {
  const file = path.join(repo, 'src/pricing.ts');
  const text = fs.readFileSync(file, 'utf8');
  const before = '  if (percent <= 0) return amount;';
  if (!text.includes(before)) throw new Error('pricing.ts was already changed; rerun without --stale to reset the demo.');
  fs.writeFileSync(file, text.replace(before, '  if (percent <= 0 || Number.isNaN(percent)) return amount;'));
  console.log('Edited src/pricing.ts: the applyDiscount question is now STALE. Save is not needed; the file is changed on disk.');
  process.exit(0);
}

fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(repo, { recursive: true });
fs.cpSync(path.join(__dirname, 'project'), repo, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', repo]);
git('add', '-A');
git('-c', 'user.name=Demo', '-c', 'user.email=demo@example.invalid', 'commit', '-qm', 'Add checkout pricing and retry helpers');
git('checkout', '-qb', 'feature/discounts');
const commit = git('rev-parse', 'HEAD');

// Isolated profile: Dark Modern, no minimap, no telemetry, short window title (no absolute path), workspace trust off for this demo only.
fs.mkdirSync(path.join(user, 'User'), { recursive: true });
fs.writeFileSync(path.join(user, 'User', 'settings.json'), JSON.stringify({
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'editor.minimap.enabled': false,
  'editor.fontSize': 14,
  'window.title': '${rootName}${separator}${activeEditorShort}',
  'window.restoreWindows': 'none',
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.autoUpdate': false,
  'security.workspace.trust.enabled': false,
  'git.openRepositoryInParentFolders': 'never'
}, null, 2));

// Seed pins with the extension's own domain and store code, exactly as the UI would store them.
const root = fs.realpathSync(repo);
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const line = (rel, needle) => { const i = read(rel).split('\n').findIndex(l => l.includes(needle)); if (i < 0) throw new Error(`${needle} not found`); return i; };
const at = (rel, needle, extra = 0) => { const i = line(rel, needle); return capture(rel, read(rel), i, i + extra); };
const A = { id: 'demo-session-a', label: 'A' };
const pins = [
  createPin('question', 'What happens if percent is over 100? Should it be clamped?', at('src/pricing.ts', 'if (percent <= 0)', 1), A, commit, 'feature/discounts'),
  createPin('question', 'Is free shipping inclusive at exactly 50?', at('src/pricing.ts', 'subtotalAmount >= 50'), A, commit, 'feature/discounts'),
  createPin('question', 'Does this also wait after the final failed attempt?', at('src/retry.ts', 'setTimeout'), A, commit, 'feature/discounts'),
  createPin('note', 'Totals are not rounded to cents here; 0.1 + 0.2 style errors can leak into orderTotal.', at('src/pricing.ts', 'items.reduce'), A, commit, 'feature/discounts'),
  createPin('note', 'Consider an options object instead of positional attempts and delayMs.', at('src/retry.ts', 'export async function withRetry'), A, commit, 'feature/discounts'),
  { ...createPin('question', 'Is subtotal safe for an empty cart?', at('src/pricing.ts', 'export function subtotal'), A, commit, 'feature/discounts'), status: 'resolved', answer: 'Yes. reduce starts from 0, so an empty cart returns 0.' }
];
const dir = path.join(user, 'User', 'globalStorage', 'goleedev.review-pins', 'worktrees', hash(root));
new PinStore(dir, root).update(0, s => ({ ...s, defaultSession: A, pins })).then(() => {
  const code = '"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"';
  console.log(`Demo ready: ${pins.length} pins in ${path.basename(root)} (branch feature/discounts).\n`);
  console.log('Install the VSIX into the demo profile and open the demo:');
  console.log(`  ${code} --user-data-dir ${user} --extensions-dir ${ext} --install-extension <path-to>/review-pins-0.1.0.vsix`);
  // Print the resolved path (macOS /tmp is a symlink to /private/tmp) so the window state matches the pin store.
  console.log(`  ${code} --user-data-dir ${user} --extensions-dir ${ext} ${root} ${path.join(root, 'src/pricing.ts')}`);
}).catch(e => { console.error(e); process.exit(1); });
