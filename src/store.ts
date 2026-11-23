import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { State, validateState } from './domain';

export class PinStore {
  readonly file: string;
  constructor(readonly directory: string, readonly root: string) { this.file = path.join(directory, 'pins.json'); }
  async read(): Promise<State> {
    try {
      const stat = await fs.stat(this.file);
      if (stat.size > 24_000_000) throw new Error('Pin storage is too large. Original data was preserved.');
      return validateState(JSON.parse(await fs.readFile(this.file, 'utf8')) as unknown, this.root);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, root: this.root, revision: 0, defaultSession: null, pins: [] };
      if (e instanceof SyntaxError) throw new Error('Pin storage contains invalid JSON. Original data was preserved.');
      throw e;
    }
  }
  async update(expectedRevision: number, transform: (state: State) => State): Promise<State> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = `${this.file}.lock`;
    let handle;
    try { handle = await fs.open(lock, 'wx', 0o600); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Pin storage is locked by another write. Retry after refreshing. If an extension host crashed, close all Review Pins windows before removing ${lock}.`);
      throw e;
    }
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      const current = await this.read();
      if (current.revision !== expectedRevision) throw new Error('Pins changed in another window. Refresh and try again.');
      const next = validateState({ ...transform(structuredClone(current)), revision: current.revision + 1 }, this.root);
      const serialized = JSON.stringify(next, null, 2);
      if (Buffer.byteLength(serialized, 'utf8') > 24_000_000) throw new Error('Pin storage reached its 24 MB limit. Remove unneeded pins before adding more.');
      const out = await fs.open(temporary, 'wx', 0o600);
      try { await out.writeFile(serialized); await out.sync(); } finally { await out.close(); }
      await fs.rename(temporary, this.file);
      return next;
    } finally {
      await handle.close();
      await fs.rm(temporary, { force: true });
      await fs.unlink(lock);
    }
  }
}
