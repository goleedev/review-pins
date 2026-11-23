import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Anchor, compare, LocationStatus, MAX_EXCERPT, normalize, relativeSafe } from './domain';
const exec = promisify(execFile);
export type Repository = { root: string; gitDir: string; commit: string | null; branch: string | null };
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], { timeout: 5_000, maxBuffer: 512_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });
  return stdout.trim();
}
export async function repository(folder: string): Promise<Repository> {
  let root: string;
  try { root = await fs.realpath(await git(folder, ['rev-parse', '--show-toplevel'])); }
  catch { throw new Error('Open a local Git repository or worktree. Git must be installed.'); }
  const gitDir = await fs.realpath(await git(folder, ['rev-parse', '--absolute-git-dir']));
  const commit = await git(folder, ['rev-parse', '--verify', 'HEAD']).catch(() => null);
  const branch = await git(folder, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => null);
  return { root, gitDir, commit, branch };
}
export async function safeFile(root: string, relative: string): Promise<string> {
  if (!relativeSafe(relative)) throw new Error('File path is outside this worktree.');
  const real = await fs.realpath(path.join(root, relative));
  const inside = path.relative(root, real);
  if (!relativeSafe(inside)) throw new Error('Symlink points outside this worktree.');
  return real;
}
// The file's current text at an anchor's saved line range (same path and size guards as inspect). Null when unreadable or out of range.
export async function currentLines(root: string, anchor: Anchor): Promise<string | null> {
  try {
    const file = await safeFile(root, anchor.path);
    const st = await fs.stat(file);
    if (!st.isFile() || st.size > 2_000_000) return null;
    const all = normalize(await fs.readFile(file, 'utf8')).split('\n');
    if (anchor.end >= all.length) return null;
    return all.slice(anchor.start, anchor.end + 1).join('\n').slice(0, MAX_EXCERPT);
  } catch { return null; }
}
export async function inspect(root: string, anchor: Anchor): Promise<LocationStatus> {
  try {
    const file = await safeFile(root, anchor.path);
    const st = await fs.stat(file);
    if (!st.isFile() || st.size > 2_000_000) return 'unavailable';
    return compare(anchor, await fs.readFile(file, 'utf8'));
  } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable'; }
}
