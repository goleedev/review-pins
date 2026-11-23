import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { addAnswer, AnswerInput, answerSourceLabel, answerState, answerStateLabel, answerSummary, renderAnswerPreview, renderAnswers, verifyAnswer, Anchor, capture, ContextMode, createPin, fence, filterPins, ListInput, renderPinContext, renderPinList, renderToolContext, worktreeLabel, handoff, hash, LocationStatus, Pin, quote, renderHandoff, samePath, Session, State } from './domain';
import { currentLines, inspect, repository, Repository, safeFile } from './repository';
import { PinStore } from './store';

type Group = { type: 'group'; key: string; label: string; pins: Pin[] };
type FileNode = { type: 'file'; key: string; file: string; pins: Pin[] };
type PinNode = { type: 'pin'; pin: Pin };
type Node = Group | FileNode | PinNode;
const statusLabel: Record<LocationStatus, string> = { unchanged: 'Location matches saved code', needsReview: 'Location needs review', missing: 'File missing', unavailable: 'Location unavailable' };
class PinTree implements vscode.TreeDataProvider<Node> {
  readonly changes = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changes.event;
  constructor(private app: App) {}
  getChildren(node?: Node): Node[] {
    const pins = this.app.state?.pins ?? [];
    if (!node) {
      if (!pins.length) return [];
      return [
        { type: 'group', key: 'open', label: 'Questions', pins: pins.filter(p => p.kind === 'question' && p.status === 'open') },
        { type: 'group', key: 'notes', label: 'Notes', pins: pins.filter(p => p.kind === 'note') },
        { type: 'group', key: 'resolved', label: 'Resolved', pins: pins.filter(p => p.kind === 'question' && p.status === 'resolved') }
      ];
    }
    if (node.type === 'group') return [...new Set(node.pins.map(p => p.anchor.path))].sort().map(file => ({ type: 'file', key: `${node.key}:${file}`, file, pins: node.pins.filter(p => p.anchor.path === file) }));
    if (node.type === 'file') return node.pins.map(pin => ({ type: 'pin', pin }));
    return [];
  }
  getParent(node: Node): Node | undefined {
    if (node.type === 'group') return undefined;
    const pin = node.type === 'pin' ? node.pin : node.pins[0];
    if (!pin) return undefined;
    const key = pin.kind === 'note' ? 'notes' : pin.status === 'resolved' ? 'resolved' : 'open';
    const group = this.getChildren().find(n => n.type === 'group' && n.key === key) as Group | undefined;
    if (node.type === 'file') return group;
    return group ? this.getChildren(group).find(n => n.type === 'file' && n.file === pin.anchor.path) : undefined;
  }
  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === 'group') {
      const item = new vscode.TreeItem(node.label, node.key === 'resolved' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
      item.id = node.key; item.description = String(node.pins.length); return item;
    }
    if (node.type === 'file') {
      const item = new vscode.TreeItem(node.file, vscode.TreeItemCollapsibleState.Expanded);
      item.id = node.key; item.iconPath = new vscode.ThemeIcon('file-code'); return item;
    }
    const p = node.pin, state = this.app.statuses.get(p.id) ?? 'unavailable';
    const item = new vscode.TreeItem(p.body.replace(/\s+/g, ' '));
    item.id = p.id;
    item.contextValue = p.kind === 'question' ? `pin-question-${p.status}` : 'pin-note';
    const answers = answerSummary(p, state);
    item.description = `${p.anchor.start + 1} · ${p.kind === 'question' ? p.target?.label ?? 'Unassigned' : 'Note'}${state !== 'unchanged' ? ' · check location' : ''}${answers ? ` · ${answers}` : ''}`;
    item.iconPath = new vscode.ThemeIcon(state !== 'unchanged' ? 'warning' : p.kind === 'note' ? 'note' : p.status === 'resolved' ? 'pass' : 'question');
    item.tooltip = `${p.body}\n\n${p.anchor.path}:${p.anchor.start + 1}\n${statusLabel[state]}\nOrigin: ${p.origin.session?.label ?? 'Unassigned'}${answers ? `\nAnswers: ${answers}` : ''}`;
    item.accessibilityInformation = { label: `${p.kind === 'question' ? `${p.status === 'resolved' ? 'Resolved question' : 'Question'}` : 'Note'}: ${p.body.replace(/\s+/g, ' ')}. ${p.anchor.path} line ${p.anchor.start + 1}. ${statusLabel[state]}.${answers ? ` ${answers}.` : ''}` };
    item.command = { command: 'reviewPins.open', title: 'Open Pin', arguments: [node] };
    return item;
  }
}
class Documents implements vscode.TextDocumentContentProvider {
  private values = new Map<string, string>();
  provideTextDocumentContent(uri: vscode.Uri): string { return this.values.get(uri.toString()) ?? 'This preview expired. Generate it again from Review Pins.'; }
  async show(title: string, content: string): Promise<void> {
    const uri = vscode.Uri.from({ scheme: 'review-pins', path: `/${title}-${randomUUID().slice(0, 8)}.md` });
    this.values.set(uri.toString(), content);
    // Keep previews for open documents; discard older closed previews.
    const opened = new Set(vscode.workspace.textDocuments.map(d => d.uri.toString()));
    for (const key of this.values.keys()) if (this.values.size > 30 && key !== uri.toString() && !opened.has(key)) this.values.delete(key);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
  }
}
class App implements vscode.Disposable {
  state?: State;
  repo?: Repository;
  store?: PinStore;
  statuses = new Map<string, LocationStatus>();
  private editorPaths = new Map<string, string>();
  readonly tree = new PinTree(this);
  readonly view = vscode.window.createTreeView('reviewPins.list', { treeDataProvider: this.tree, showCollapseAll: true });
  readonly docs = new Documents();
  readonly questionDecoration = vscode.window.createTextEditorDecorationType({ overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'), after: { contentText: '  ? review', color: new vscode.ThemeColor('editorInfo.foreground'), fontStyle: 'italic' } });
  readonly noteDecoration = vscode.window.createTextEditorDecorationType({ after: { contentText: '  · note', color: new vscode.ThemeColor('descriptionForeground'), fontStyle: 'italic' } });
  private generation = 0;
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(readonly context: vscode.ExtensionContext) {}
  dispose(): void { if (this.timer) clearTimeout(this.timer); this.view.dispose(); this.tree.changes.dispose(); this.questionDecoration.dispose(); this.noteDecoration.dispose(); }
  affects(uri: vscode.Uri): boolean {
    if (!this.repo || uri.scheme !== 'file') return false;
    const real = this.editorPaths.get(uri.toString()) ?? uri.fsPath;
    return (this.state?.pins ?? []).some(p => samePath(path.join(this.repo!.root, p.anchor.path), real));
  }
  schedule(): void { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { void this.refresh(); }, 180); }
  private latest: Promise<void> = Promise.resolve();
  // A superseded refresh discards its result, so it must wait for the newest one; otherwise callers (run, API) can read stale state.
  refresh(): Promise<void> {
    const gen = ++this.generation;
    const result = this.load(gen).then(() => gen === this.generation ? undefined : this.latest);
    this.latest = result;
    return result;
  }
  private async load(gen: number): Promise<void> {
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace to use Review Pins.');
      if (vscode.env.remoteName || folders?.length !== 1 || folders[0]?.uri.scheme !== 'file') throw new Error('Open one local Git folder. Multi-root and remote workspaces are not supported yet.');
      const repo = await repository(folders[0].uri.fsPath);
      // All windows for the same canonical worktree share one versioned store.
      const store = new PinStore(path.join(this.context.globalStorageUri.fsPath, 'worktrees', hash(repo.root)), repo.root);
      const state = await store.read();
      const editorPaths = new Map<string, string>();
      for (const doc of vscode.workspace.textDocuments) if (doc.uri.scheme === 'file') {
        const real = await fs.realpath(doc.uri.fsPath).catch(() => undefined);
        if (real) editorPaths.set(doc.uri.toString(), real);
      }
      const statuses = new Map<string, LocationStatus>();
      // Check saved ranges and their neighboring context; never guess moved locations.
      for (const pin of state.pins) statuses.set(pin.id, await this.location(repo.root, pin.anchor));
      if (gen !== this.generation) return;
      this.repo = repo; this.store = store; this.state = state; this.statuses = statuses; this.editorPaths = editorPaths;
      // VS Code hides viewsWelcome whenever TreeView.message is set, so leave it unset while there are no pins.
      this.view.message = state.pins.length ? `Session: ${state.defaultSession?.label ?? 'Unassigned'} · local labels only` : undefined;
      this.view.description = path.basename(repo.root);
      this.view.badge = { value: state.pins.filter(p => p.kind === 'question' && p.status === 'open').length, tooltip: 'Unresolved questions' };
    } catch (e) {
      if (gen !== this.generation) return;
      this.repo = undefined; this.store = undefined; this.state = undefined; this.statuses.clear();
      this.view.message = e instanceof Error ? e.message : String(e); this.view.badge = undefined;
    }    this.tree.changes.fire(undefined); this.decorate();
  }
  async location(root: string, anchor: Anchor): Promise<LocationStatus> {
    const uri = vscode.Uri.file(path.join(root, anchor.path));
    for (const doc of vscode.workspace.textDocuments) if (doc.uri.scheme === 'file' && doc.isDirty) {
      const real = await fs.realpath(doc.uri.fsPath).catch(() => undefined);
      if (real && samePath(real, uri.fsPath)) return 'needsReview';
    }
    return inspect(root, anchor);
  }
  decorate(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      const questions: vscode.DecorationOptions[] = [], notes: vscode.DecorationOptions[] = [];
      const editorPath = this.editorPaths.get(editor.document.uri.toString());
      if (!editor.document.isDirty && this.repo && editorPath && editor.document.uri.scheme === 'file') {
        for (const p of this.state?.pins ?? []) {
          if (!samePath(path.join(this.repo.root, p.anchor.path), editorPath) || this.statuses.get(p.id) !== 'unchanged' || p.anchor.end >= editor.document.lineCount) continue;
          const range = new vscode.Range(p.anchor.start, 0, p.anchor.end, editor.document.lineAt(p.anchor.end).text.length);
          const hover = new vscode.MarkdownString(); hover.appendText(`${p.kind === 'question' ? 'Question' : 'Note'}: ${p.body}`);
          if (p.kind === 'note') notes.push({ range, hoverMessage: hover });
          else if (p.status === 'open') questions.push({ range, hoverMessage: hover });
        }
      }
      editor.setDecorations(this.questionDecoration, questions); editor.setDecorations(this.noteDecoration, notes);
    }
  }
  ready(): { state: State; store: PinStore; repo: Repository } {
    if (!this.state || !this.store || !this.repo) throw new Error(this.view.message ?? 'Open one trusted local Git folder.');
    return { state: this.state, store: this.store, repo: this.repo };
  }
  async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) { void vscode.window.showInformationMessage('Finish or cancel the current Review Pins action first.'); return; }
    this.busy = true;
    try { await this.refresh(); this.ready(); await action(); }
    catch (e) { void vscode.window.showErrorMessage(`Review Pins: ${e instanceof Error ? e.message : String(e)}`); }
    finally { this.busy = false; await this.refresh(); }
  }
  async selection(): Promise<Anchor> {
    const { repo } = this.ready(), editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file' || editor.document.isUntitled) throw new Error('Select lines in a saved, local code file.');
    if (editor.document.isDirty) throw new Error('Save the file before creating or reattaching a pin.');
    const real = await fs.realpath(editor.document.uri.fsPath);
    const relative = path.relative(repo.root, real);
    await safeFile(repo.root, relative);
    const nested = await repository(path.dirname(editor.document.uri.fsPath));
    if (nested.root !== repo.root) throw new Error('Open the nested repository separately before pinning its code.');
    if ((await fs.stat(editor.document.uri.fsPath)).size > 2_000_000) throw new Error('Files over 2 MB are not supported in this version.');
    const { start, end, isEmpty } = editor.selection;
    const last = !isEmpty && end.character === 0 && end.line > start.line ? end.line - 1 : end.line;
    return capture(relative, editor.document.getText(), start.line, last);
  }
  async addPin(kind: Pin['kind'], suppliedBody?: string): Promise<void> {
    const { state, store, repo } = this.ready();
    const anchor = await this.selection();
    const body = suppliedBody ?? await vscode.window.showInputBox({ title: kind === 'question' ? 'Ask about this code' : 'Note about this code', prompt: 'Saved locally. No AI request is sent.', validateInput: v => !v.trim() || v.length > 2_000 ? 'Enter 1–2,000 characters.' : undefined });
    if (body === undefined) return;
    const pin = createPin(kind, body, anchor, state.defaultSession, repo.commit, repo.branch);
    await store.update(state.revision, s => ({ ...s, pins: [...s.pins, pin] }));
    await this.refresh();
    await Promise.resolve(this.view.reveal({ type: 'pin', pin }, { select: true, focus: false })).catch(() => undefined);
  }
  async choose(node?: Node, predicate: (p: Pin) => boolean = () => true): Promise<Pin | undefined> {
    const { state } = this.ready();
    if (node?.type === 'pin') return state.pins.find(p => p.id === node.pin.id && predicate(p));
    const choices = state.pins.filter(predicate).map(p => ({ label: p.body.replace(/\s+/g, ' '), description: `${p.anchor.path}:${p.anchor.start + 1}`, pin: p }));
    if (!choices.length) { void vscode.window.showInformationMessage('No matching pins yet.'); return; }
    return (await vscode.window.showQuickPick(choices, { title: 'Choose a pin', matchOnDescription: true }))?.pin;
  }
  async mutate(pin: Pin, change: (p: Pin) => Pin | undefined): Promise<void> {
    const { state, store } = this.ready();
    if (JSON.stringify(state.pins.find(p => p.id === pin.id)) !== JSON.stringify(pin)) throw new Error('This pin changed while you were editing. Refresh and retry.');
    await store.update(state.revision, s => ({ ...s, pins: s.pins.flatMap(p => p.id === pin.id ? (() => { const v = change(p); return v ? [{ ...v, updatedAt: new Date().toISOString() }] : []; })() : [p]) }));
  }
  async details(pin: Pin): Promise<void> {
    const { repo } = this.ready(), status = await this.location(repo.root, pin.anchor), worktree = worktreeLabel(repo.root, os.homedir());
    // Same privacy rules as copied text: folder name only, short commit; details tabs are easy to screenshot or share.
    const origin = [pin.origin.branch && `branch ${JSON.stringify(pin.origin.branch)}`, pin.origin.commit && `commit ${pin.origin.commit.slice(0, 7)}`].filter(Boolean).join(', ');
    await this.docs.show('Pin', [
      `# ${pin.kind === 'question' ? 'Question' : 'Note'}`, '', quote(pin.body), '',
      `Location: ${statusLabel[status]}`, `Current anchor: ${JSON.stringify(pin.anchor.path)}:${pin.anchor.start + 1}–${pin.anchor.end + 1}`,
      ...(worktree ? [`Worktree: ${JSON.stringify(worktree)}`] : []), `Origin session: ${JSON.stringify(pin.origin.session?.label ?? 'Unassigned')}`, `Target session: ${JSON.stringify(pin.target?.label ?? 'Unassigned')}`,
      `Saved on: ${origin || 'No commit'}`, `Created: ${pin.createdAt}`,
      ...(pin.kind === 'question' ? [`Question state: ${pin.status}`, '', '## Answer note', pin.answer ? quote(pin.answer) : 'No answer recorded.',
        '', `## Answers (${pin.answers?.length ?? 0})`, '', ...(pin.answers?.length ? renderAnswers(pin, status) : ['No answers attached. Use “Attach Answer…” to add one.', '']),
        'Answers are review material. A pending answer is unverified; a verification applies only to the code it was checked against.'] : []),
      '', '## Code at creation', `Path: ${JSON.stringify(pin.origin.anchor.path)}:${pin.origin.anchor.start + 1}`, fence(pin.origin.anchor.excerpt),
      ...(JSON.stringify(pin.origin.anchor) !== JSON.stringify(pin.anchor) ? ['', '## Manually reattached snapshot', fence(pin.anchor.excerpt)] : []),
      '', 'Location matches do not verify program behavior. If the location needs review, select the correct lines in the code editor and run “Review Pins: Reattach Pin to Selected Lines”.'
    ].join('\n'));
  }
  // Pins resolve to real paths. When the workspace was opened through a symlink (for example macOS /tmp),
  // open the file under the path VS Code already uses, so it reuses the open tab instead of adding a duplicate.
  async editorUri(file: string): Promise<vscode.Uri> {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== 'file') continue;
      const real = await fs.realpath(doc.uri.fsPath).catch(() => undefined);
      if (real && samePath(real, file)) return doc.uri;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    const base = folder && await fs.realpath(folder.uri.fsPath).catch(() => undefined);
    if (folder && base) {
      const relative = path.relative(base, file);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return vscode.Uri.file(path.join(folder.uri.fsPath, relative));
    }
    return vscode.Uri.file(file);
  }
  async open(pin: Pin): Promise<void> {
    const { repo } = this.ready();
    if (await this.location(repo.root, pin.anchor) !== 'unchanged') { await this.details(pin); return; }
    const file = await safeFile(repo.root, pin.anchor.path);
    const doc = await vscode.workspace.openTextDocument(await this.editorUri(file));
    const editor = await vscode.window.showTextDocument(doc, { preview: true });
    const range = new vscode.Range(pin.anchor.start, 0, pin.anchor.end, doc.lineAt(pin.anchor.end).text.length);
    editor.selection = new vscode.Selection(range.start, range.end); editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
  // Preview first, copy only after a modal confirmation. Nothing is sent anywhere and no pin is changed.
  async copyContext(pin: Pin, mode: ContextMode): Promise<void> {
    const { state, store, repo } = this.ready();
    const status = await this.location(repo.root, pin.anchor);
    const text = renderPinContext(pin, status, mode, worktreeLabel(repo.root, os.homedir()));
    await this.docs.show(mode === 'ask' ? 'Ask AI (Copy Prompt)' : 'Copy with Context', text);
    const button = mode === 'ask' ? 'Copy AI Prompt' : 'Copy Context';
    // Modal for the same reason as the handoff prompt: run() holds busy until this settles.
    const choice = await vscode.window.showInformationMessage(mode === 'ask' ? 'Copy this AI prompt to the clipboard?' : 'Copy this pin context to the clipboard?', { modal: true, detail: `${mode === 'ask' ? 'Includes AI instructions and the pin context' : 'Includes the pin context only, without AI instructions'}: the saved code excerpt and file location${status === 'unchanged' ? '' : ' (marked as not verified)'}. Review the preview first.\n\nNothing is sent to an AI chat automatically. It is only copied; paste it yourself.` }, button);
    if (choice !== button) return;
    if ((await store.read()).revision !== state.revision) throw new Error('Pins changed while the preview was open. Try again.');
    if (await this.location(repo.root, pin.anchor) !== status) throw new Error('The code location changed while the preview was open. Try again.');
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage(mode === 'ask' ? 'AI prompt copied. Nothing was sent; paste it into your AI chat yourself.' : 'Pin context copied. Nothing was sent.');
  }
  // Read-only tool backends: they refresh, read the current worktree's state, and never write or take the busy lock.
  async toolList(input: ListInput): Promise<string> {
    await this.refresh();
    const { state, repo } = this.ready();
    return renderPinList(filterPins(state.pins, input ?? {}), this.statuses, worktreeLabel(repo.root, os.homedir()), input ?? {});
  }
  async toolContext(pinId: unknown): Promise<string> {
    if (typeof pinId !== 'string' || !pinId.trim()) throw new Error('pinId is required. Get it from the List Review Pins tool.');
    await this.refresh();
    const { state, repo } = this.ready();
    const pin = state.pins.find(p => p.id === pinId.trim());
    if (!pin) throw new Error('No pin with this id in the current worktree. Pins from other worktrees are not available here; list pins again.');
    const status = await this.location(repo.root, pin.anchor);
    return renderToolContext(pin, status, worktreeLabel(repo.root, os.homedir()), status === 'needsReview' ? await currentLines(repo.root, pin.anchor) : null);
  }
  // Shared save path for every answer source (command or chat tool): preview, modal approval, then an append-only write.
  // Returns false when the user cancels; nothing is written in that case.
  async saveAnswer(pinId: string, input: AnswerInput, approve: () => Thenable<AnswerInput | undefined>): Promise<boolean> {
    const { state, store, repo } = this.ready();
    addAnswer(state, pinId, input); // validate before showing anything
    const pin = state.pins.find(p => p.id === pinId)!;
    await this.docs.show('Answer preview', renderAnswerPreview(pin, input, await this.location(repo.root, pin.anchor)));
    const approved = await approve();
    if (!approved) return false;
    await store.update(state.revision, s => addAnswer(s, pinId, approved).state);
    return true;
  }
  async attachAnswer(node?: Node): Promise<void> {
    const pin = await this.choose(node, p => p.kind === 'question' && p.status === 'open');
    if (!pin) return;
    const who = await vscode.window.showQuickPick([
      { label: '$(sparkle) Copilot', description: 'AI answer', source: 'copilot' as const },
      { label: '$(sparkle) Another AI tool…', description: 'AI answer; name the tool next (optional)', source: 'ai' as const },
      { label: '$(person) Written by me', description: 'Manual answer', source: 'manual' as const }
    ], { title: 'Who produced this answer?' });
    if (!who) return;
    const sourceLabel = who.source === 'ai' ? await vscode.window.showInputBox({ title: 'AI tool name (optional)', prompt: 'For example, Claude Code. Leave empty if unsure.', validateInput: v => v.trim().length > 80 ? 'Keep it under 80 characters.' : undefined }) : undefined;
    if (who.source === 'ai' && sourceLabel === undefined) return;
    const clip = (await vscode.env.clipboard.readText()).trim();
    const how = await vscode.window.showQuickPick([
      { label: '$(clippy) Paste from clipboard', description: clip ? clip.replace(/\s+/g, ' ').slice(0, 60) : '(clipboard is empty)', paste: true },
      { label: '$(edit) Type the answer', description: 'Single line', paste: false }
    ], { title: 'Answer text' });
    if (!how) return;
    const text = how.paste ? clip : await vscode.window.showInputBox({ title: 'Answer', prompt: 'Saved as pending verification. Does not resolve the question.', validateInput: v => !v.trim() || v.length > 8_000 ? 'Enter 1–8,000 characters.' : undefined });
    if (text === undefined) return;
    if (!text) throw new Error('The clipboard is empty. Copy the answer first, or type it.');
    const input: AnswerInput = { text, source: who.source, ...(sourceLabel?.trim() ? { sourceLabel } : {}) };
    const existing = pin.kind === 'question' ? pin.answers?.length ?? 0 : 0;
    const saved = await this.saveAnswer(pin.id, input, async () => await vscode.window.showInformationMessage('Save this answer to the question?', { modal: true, detail: `It is saved as pending verification. The question stays open until you resolve it.${existing ? ` It is added next to the ${existing} existing answer${existing > 1 ? 's' : ''}; nothing is replaced.` : ''}` }, 'Save Answer') === 'Save Answer' ? input : undefined);
    if (saved) void vscode.window.showInformationMessage('Answer saved as pending verification.');
  }
  async verify(node?: Node): Promise<void> {
    const needs = (p: Pin) => p.kind === 'question' && !!p.answers?.some(a => answerState(p, a, this.statuses.get(p.id) ?? 'unavailable') !== 'verified');
    const pin = await this.choose(node, needs);
    if (!pin || pin.kind !== 'question' || !pin.answers?.length) { if (node) void vscode.window.showInformationMessage('This question has no answer waiting for verification.'); return; }
    const { state, store, repo } = this.ready();
    const status = await this.location(repo.root, pin.anchor);
    if (status !== 'unchanged') throw new Error('The pinned code needs review. Reattach the pin to the current code, then verify the answer.');
    await this.details(pin);
    const pick = await vscode.window.showQuickPick(pin.answers.filter(a => answerState(pin, a, status) !== 'verified').map(a => ({ label: answerSourceLabel(a), description: answerStateLabel[answerState(pin, a, status)], detail: a.text.replace(/\s+/g, ' ').slice(0, 120), answer: a })), { title: 'Which answer did you verify?' });
    if (!pick) return;
    if (await vscode.window.showInformationMessage('Mark this answer as verified?', { modal: true, detail: 'Confirm that you checked it against the current code. This does not resolve the question; a later code change or reattachment makes this verification outdated.' }, 'Mark Verified') !== 'Mark Verified') return;
    await store.update(state.revision, s => verifyAnswer(s, pin.id, pick.answer.id, status));
    void vscode.window.showInformationMessage('Answer marked as verified. Resolve the question when you are done.');
  }
  // Chat-tool entry point: the agent can only propose. Review Pins' own modal is the approval boundary (not VS Code's tool confirmation, which can be set to always allow).
  async proposeAnswer(pinId: unknown, text: unknown): Promise<string> {
    if (typeof pinId !== 'string' || !pinId.trim()) throw new Error('pinId is required. Get it from the List Review Pins tool.');
    if (typeof text !== 'string' || !text.trim()) throw new Error('answer is required: pass the full answer text.');
    if (this.busy) throw new Error('Review Pins is busy with another action. Ask the user to finish it, then try again.');
    this.busy = true;
    try {
      await this.refresh();
      const draft: AnswerInput = { text, source: 'ai', sourceLabel: 'chat agent' };
      const saved = await this.saveAnswer(pinId.trim(), draft, async () => {
        const choice = await vscode.window.showInformationMessage('Save the chat agent’s answer to this Review Pin?', { modal: true, detail: 'Review the preview first. It is saved as pending verification and the question stays open. Choose who produced it.' }, 'Save as Copilot Answer', 'Save as Other AI Answer');
        return choice === 'Save as Copilot Answer' ? { text, source: 'copilot' } : choice === 'Save as Other AI Answer' ? { text, source: 'ai' } : undefined;
      });
      return saved ? 'The user saved this answer to the pin as pending verification. The question is still open; only the user can verify the answer or resolve the question.' : 'The user declined to save the answer. Nothing was changed.';
    } finally { this.busy = false; await this.refresh(); }
  }
  async session(): Promise<Session | undefined> {
    const { state } = this.ready();
    const label = await vscode.window.showInputBox({ title: 'Session label', value: state.defaultSession?.label ?? '', prompt: 'A local label, such as A-1. This does not connect to an agent.', validateInput: v => !v.trim() || v.trim().length > 80 ? 'Enter a label of 1–80 characters.' : undefined });
    if (label === undefined) return;
    const existing = [state.defaultSession, ...state.pins.flatMap(p => [p.target, p.origin.session])].find(s => s?.label === label.trim());
    return existing ?? { id: randomUUID(), label: label.trim() };
  }
  async handOff(): Promise<void> {
    const { state, store, repo } = this.ready();
    const questions = state.pins.filter(p => p.kind === 'question' && p.status === 'open');
    if (!questions.length) { void vscode.window.showInformationMessage('No unresolved questions to hand off.'); return; }
    const selected = await vscode.window.showQuickPick(questions.map(pin => ({ label: pin.body.replace(/\s+/g, ' '), description: `${pin.target?.label ?? 'Unassigned'} · ${pin.anchor.path}:${pin.anchor.start + 1}`, picked: (pin.target?.id ?? null) === (state.defaultSession?.id ?? null), pin })), { title: 'Questions to carry into the next session', canPickMany: true, matchOnDescription: true });
    if (!selected?.length) return;
    const target = await this.session(); if (!target) return;
    const pins = selected.map(s => s.pin), ids = pins.map(p => p.id);
    const statuses = new Map<string, LocationStatus>();
    for (const p of pins) statuses.set(p.id, await this.location(repo.root, p.anchor));
    const text = renderHandoff(pins, target, statuses, worktreeLabel(repo.root, os.homedir()));
    await this.docs.show('Handoff', text);
    // Must be modal: run() holds its busy flag until this settles, and a toast that auto-hides leaves the promise pending, blocking every command.
    const choice = await vscode.window.showInformationMessage('Copy this handoff?', { modal: true, detail: 'Review the preview first. Copying does not send it to an agent.' }, 'Copy and Set Target');
    if (choice !== 'Copy and Set Target') return;
    const latest = await store.read();
    if (latest.revision !== state.revision) throw new Error('Pins changed while the preview was open. Prepare a fresh handoff.');
    for (const p of pins) if (await this.location(repo.root, p.anchor) !== statuses.get(p.id)) throw new Error('A code location changed while the preview was open. Prepare a fresh handoff.');
    await vscode.env.clipboard.writeText(text);
    try { await store.update(state.revision, s => handoff(s, ids, target)); }
    catch (e) { throw new Error(`Questions were copied, but the target label was NOT saved. Refresh and retry. ${e instanceof Error ? e.message : String(e)}`); }
    void vscode.window.showInformationMessage(`Copied ${pins.length} question${pins.length === 1 ? '' : 's'} for ${target.label}. Paste into that session yourself.`);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const app = new App(context);
  context.subscriptions.push(app, vscode.workspace.registerTextDocumentContentProvider('review-pins', app.docs));
  const cmd = (name: string, action: (node?: Node) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(`reviewPins.${name}`, (node?: Node) => app.run(() => action(node))));
  cmd('addQuestion', () => app.addPin('question'));
  cmd('addNote', () => app.addPin('note'));
  cmd('refresh', () => app.refresh());
  cmd('open', async node => { const p = await app.choose(node); if (p) await app.open(p); });
  cmd('details', async node => { const p = await app.choose(node); if (p) await app.details(p); });
  cmd('edit', async node => {
    const p = await app.choose(node); if (!p) return;
    const body = await vscode.window.showInputBox({ title: 'Edit pin', value: p.body, validateInput: v => !v.trim() || v.length > 2_000 ? 'Enter 1–2,000 characters.' : undefined });
    if (body !== undefined) await app.mutate(p, pin => ({ ...pin, body: body.trim() }));
  });
  cmd('delete', async node => { const p = await app.choose(node); if (p && await vscode.window.showWarningMessage('Delete this pin permanently?', { modal: true, detail: p.body }, 'Delete') === 'Delete') await app.mutate(p, () => undefined); });
  cmd('answer', async node => {
    const p = await app.choose(node, p => p.kind === 'question'); if (p?.kind !== 'question') return;
    const answer = await vscode.window.showInputBox({ title: 'Answer note', prompt: 'Saving an answer does not resolve the question.', value: p.answer, validateInput: v => v.length > 8_000 ? 'Keep answers under 8,000 characters.' : undefined });
    if (answer !== undefined) await app.mutate(p, pin => pin.kind === 'question' ? { ...pin, answer } : pin);
  });
  for (const [command, status] of [['resolve', 'resolved'], ['reopen', 'open']] as const) cmd(command, async node => { const p = await app.choose(node, p => p.kind === 'question' && p.status !== status); if (p) await app.mutate(p, pin => pin.kind === 'question' ? { ...pin, status } : pin); });
  cmd('setSession', async () => { const { state, store } = app.ready(); const session = await app.session(); if (session) await store.update(state.revision, s => ({ ...s, defaultSession: session })); });
  cmd('handoff', () => app.handOff());
  cmd('attachAnswer', node => app.attachAnswer(node));
  cmd('viewAnswers', async node => { const p = await app.choose(node, p => p.kind === 'question'); if (p) await app.details(p); });
  cmd('verifyAnswer', node => app.verify(node));
  cmd('askAI', async node => { const p = await app.choose(node); if (p) await app.copyContext(p, 'ask'); });
  cmd('copyContext', async node => { const p = await app.choose(node); if (p) await app.copyContext(p, 'copy'); });
  cmd('reattach', async () => {
    const anchor = await app.selection(); // Capture before Quick Pick changes editor focus.
    const p = await app.choose(); if (!p) return;
    if (await vscode.window.showWarningMessage(`Attach this pin to ${anchor.path}:${anchor.start + 1}?`, { modal: true, detail: 'The original code and origin session will be preserved.' }, 'Reattach') === 'Reattach') await app.mutate(p, pin => ({ ...pin, anchor }));
  });
  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => app.schedule()), vscode.workspace.onDidChangeWorkspaceFolders(() => app.schedule()), vscode.workspace.onDidSaveTextDocument(d => { if (app.affects(d.uri)) app.schedule(); }), vscode.workspace.onDidChangeTextDocument(e => {
    if (app.affects(e.document.uri)) { app.decorate(); app.schedule(); }
  }));
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(watcher, watcher.onDidChange(uri => { if (app.affects(uri)) app.schedule(); }), watcher.onDidDelete(uri => { if (app.affects(uri)) app.schedule(); }), watcher.onDidCreate(uri => { if (app.affects(uri)) app.schedule(); }), vscode.window.onDidChangeWindowState(e => { if (e.focused) app.schedule(); }));
  // Read-only tools for Copilot Agent mode and other chat clients (stable vscode.lm API). Nothing is sent unless a chat client calls them.
  const text = (s: string) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(s)]);
  context.subscriptions.push(
    vscode.lm.registerTool<ListInput>('reviewPins_listPins', {
      prepareInvocation: () => ({ invocationMessage: 'Reading Review Pins' }),
      invoke: async options => text(await app.toolList(options.input))
    }),
    vscode.lm.registerTool<{ pinId: string; answer: string }>('reviewPins_proposeAnswer', {
      prepareInvocation: () => ({ invocationMessage: 'Asking you to review an answer for a Review Pin' }),
      invoke: async options => text(await app.proposeAnswer(options.input?.pinId, options.input?.answer))
    }),
    vscode.lm.registerTool<{ pinId: string }>('reviewPins_getPinContext', {
      prepareInvocation: () => ({ invocationMessage: 'Reading a Review Pin and its saved code' }),
      invoke: async options => text(await app.toolContext(options.input?.pinId))
    })
  );
  await app.refresh();
  // Small API used by integration tests and other local extensions. The same input validation applies.
  return { refresh: () => app.refresh(), viewMessage: () => app.view.message, snapshot: () => structuredClone(app.ready().state), addPin: async (kind: Pin['kind'], body: string) => { await app.refresh(); await app.addPin(kind, body); } };
}
export function deactivate() {}
