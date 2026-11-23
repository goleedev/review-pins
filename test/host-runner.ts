import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { State } from '../src/domain';
// Failures are also written synchronously to a file when REVIEW_PINS_HOST_FAILURE_FILE is set: the host can exit before stderr is flushed.
export async function run(): Promise<void> {
  const file = process.env.REVIEW_PINS_HOST_FAILURE_FILE;
  if (file) fsSync.writeFileSync(`${file}.started`, 'runner started\n');
  try { await scenario(); }
  catch (e) {
    const ed = vscode.window.activeTextEditor;
    const where = `active editor: ${ed?.document.uri.toString() ?? 'none'} selection: ${ed ? `${ed.selection.start.line}:${ed.selection.start.character}-${ed.selection.end.line}:${ed.selection.end.character}` : 'n/a'} text: ${JSON.stringify(ed?.document.getText().slice(0, 80))}`;
    if (file) fsSync.writeFileSync(file, `${e instanceof Error ? e.stack ?? e.message : String(e)}\n${where}\n`);
    throw e;
  }
}
// Breadcrumbs show how far a run got if the host exits without reporting (only when REVIEW_PINS_HOST_FAILURE_FILE is set).
const mark = (step: string): void => { const f = process.env.REVIEW_PINS_HOST_FAILURE_FILE; if (f) fsSync.appendFileSync(`${f}.started`, `${step}\n`); };
async function scenario(): Promise<void> {
  const extension = vscode.extensions.getExtension('goleedev.review-pins'); assert.ok(extension);
  const api = await extension.activate() as { refresh(): Promise<void>; viewMessage(): string | undefined; snapshot(): State; addPin(kind: 'question' | 'note', body: string): Promise<void> };
  mark('activated');
  // TC-01 regression: VS Code renders viewsWelcome only when the tree is empty AND TreeView.message is unset or empty.
  await api.refresh();
  assert.equal(api.snapshot().pins.length, 0);
  assert.ok(!api.viewMessage(), `empty view must have no message so the welcome content renders (got ${JSON.stringify(api.viewMessage())})`);
  const folder = vscode.workspace.workspaceFolders![0]!;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'sample.ts'));
  const editor = await vscode.window.showTextDocument(doc);
  editor.selection = new vscode.Selection(1, 0, 1, doc.lineAt(1).text.length);
  await api.addPin('question', 'What happens if save fails?');
  await api.addPin('note', 'Review save behavior.');
  assert.equal(api.snapshot().pins.length, 2);
  await api.refresh(); assert.equal(api.snapshot().pins.length, 2);
  assert.match(api.viewMessage() ?? '', /^Session: Unassigned/, 'session line returns once pins exist');
  mark('pins created');
  // Copilot Agent tools: registered through the stable vscode.lm API and callable without a chat client.
  const toolText = async (name: string, input: object) => (await vscode.lm.invokeTool(name, { input, toolInvocationToken: undefined })).content.map(p => p instanceof vscode.LanguageModelTextPart ? p.value : '').join('');
  for (const name of ['reviewPins_listPins', 'reviewPins_getPinContext']) assert.ok(vscode.lm.tools.some(x => x.name === name && x.inputSchema), `${name} is registered with a schema`);
  const qPin = api.snapshot().pins.find(p => p.kind === 'question')!, nPin = api.snapshot().pins.find(p => p.kind === 'note')!;
  const listed = await toolText('reviewPins_listPins', {});
  assert.ok(listed.includes(`- id: ${qPin.id} | question (open) | "sample.ts", line 2 | location: Unchanged`) && listed.includes(`- id: ${nPin.id} | note`), listed);
  assert.ok(!listed.includes(folder.uri.fsPath) && !listed.includes(await fs.realpath(folder.uri.fsPath)), 'no absolute worktree path');
  assert.ok(!(await toolText('reviewPins_listPins', { kind: 'question' })).includes(nPin.id), 'kind filter');
  await assert.rejects(toolText('reviewPins_listPins', { status: 'closed' }), /status must be/);
  const ctx = await toolText('reviewPins_getPinContext', { pinId: qPin.id });
  assert.match(ctx, /## Saved Code[\s\S]*if \(ready\) save\(\);[\s\S]*## Current File\n\nThe file text at these lines still matches/);
  assert.match(ctx, /> What happens if save fails\?/); assert.ok(!ctx.includes(folder.uri.fsPath));
  await assert.rejects(toolText('reviewPins_getPinContext', { pinId: '00000000-0000-4000-8000-000000000000' }), /No pin with this id in the current worktree/);
  await assert.rejects(toolText('reviewPins_getPinContext', {}), /pinId is required/);
  assert.equal(api.snapshot().pins.length, 2, 'tools changed nothing'); assert.equal(api.snapshot().revision, 2, 'no write happened');
  mark('lm tools');
  const q = api.snapshot().pins.find(p => p.kind === 'question')!;
  await vscode.commands.executeCommand('reviewPins.resolve', { type: 'pin', pin: q });
  const resolved = api.snapshot().pins.find(p => p.id === q.id)!;
  assert.ok(resolved.kind === 'question' && resolved.status === 'resolved');
  await vscode.commands.executeCommand('reviewPins.reopen', { type: 'pin', pin: resolved });
  const reopened = api.snapshot().pins.find(p => p.id === q.id)!;
  assert.ok(reopened.kind === 'question' && reopened.status === 'open');
  mark('resolve/reopen');
  await vscode.commands.executeCommand('reviewPins.details', { type: 'pin', pin: reopened });
  assert.equal(vscode.window.activeTextEditor?.document.uri.scheme, 'review-pins');
  const detailsText = vscode.window.activeTextEditor!.document.getText();
  assert.match(detailsText, /Code at creation/);
  // Details privacy: worktree folder name only and a short commit, never the absolute root or full hash.
  const detailsRoot = await fs.realpath(vscode.workspace.workspaceFolders![0]!.uri.fsPath);
  assert.ok(!detailsText.includes(detailsRoot), 'details omit the absolute worktree path');
  assert.ok(detailsText.includes(`Worktree: ${JSON.stringify(path.basename(detailsRoot))}`), 'details name the worktree folder');
  assert.ok(reopened.origin.commit, 'fixture repo has a commit');
  assert.ok(!detailsText.includes(reopened.origin.commit), 'details omit the full commit hash');
  assert.ok(detailsText.includes(`commit ${reopened.origin.commit.slice(0, 7)}`), 'details show the short commit');
  await vscode.commands.executeCommand('reviewPins.open', { type: 'pin', pin: reopened });
  assert.equal(vscode.window.activeTextEditor?.document.uri.scheme, 'file');
  // Symlinked workspace: the pin opens under the workspace path, and never as a second document for the same file.
  const folderPath = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
  assert.notEqual(folderPath, detailsRoot, 'host workspace is opened through a symlink');
  assert.equal(vscode.window.activeTextEditor!.document.uri.fsPath, path.join(folderPath, reopened.anchor.path), 'pin opens under the workspace path');
  const sameFile = (await Promise.all(vscode.workspace.textDocuments.filter(d => d.uri.scheme === 'file').map(d => fs.realpath(d.uri.fsPath).catch(() => '')))).filter(r => r === path.join(detailsRoot, reopened.anchor.path));
  assert.equal(sameFile.length, 1, 'no duplicate document for the pinned file');
  mark('details/open');
  // Handoff regression (F2): the final confirmation must be modal, because run() holds its busy flag until the prompt settles.
  const w = vscode.window as unknown as Record<string, unknown>, original = { pick: w.showQuickPick, input: w.showInputBox, info: w.showInformationMessage };
  const infoCalls: unknown[][] = [];
  w.showQuickPick = async (items: unknown[]) => items;
  w.showInputBox = async () => 'A-1';
  w.showInformationMessage = async (...args: unknown[]) => { infoCalls.push(args); return 'Copy and Set Target'; };
  try {
    await vscode.env.clipboard.writeText('sentinel');
    await vscode.commands.executeCommand('reviewPins.handoff');
    const confirm = infoCalls.find(c => c[0] === 'Copy this handoff?'); assert.ok(confirm, 'handoff confirmation was shown');
    assert.equal((confirm[1] as { modal?: boolean }).modal, true, 'handoff confirmation must be modal');
    const copied = await vscode.env.clipboard.readText();
    assert.match(copied, /What happens if save fails\?/); assert.doesNotMatch(copied, /Review save behavior\./);
    assert.ok(!copied.includes(folder.uri.fsPath) && !copied.includes(await fs.realpath(folder.uri.fsPath)), 'handoff has no absolute worktree path');
    assert.ok(!copied.includes(q.id), 'handoff has no pin UUID'); assert.match(copied, /## 1\. "sample.ts", line 2\n/);
    assert.equal(api.snapshot().pins.find(p => p.id === q.id)!.target?.label, 'A-1');
    assert.equal(api.snapshot().pins.find(p => p.id === q.id)!.origin.session, null, 'origin session is untouched');
    assert.ok(!infoCalls.some(c => String(c[0]).startsWith('Finish or cancel')), 'no command was blocked by a stuck busy flag');
    infoCalls.length = 0;
    await vscode.commands.executeCommand('reviewPins.refresh');
    assert.ok(!infoCalls.some(c => String(c[0]).startsWith('Finish or cancel')), 'commands still run after handoff');
  } finally { w.showQuickPick = original.pick; w.showInputBox = original.input; w.showInformationMessage = original.info; }
  mark('handoff');
  // BOM regression (F1) against the real editor: getText() must agree with the BOM-preserving disk read.
  const bomPath = vscode.Uri.joinPath(folder.uri, 'bom.cs').fsPath;
  await fs.writeFile(bomPath, '﻿using System;\nclass A {}\n');
  const bomDoc = await vscode.workspace.openTextDocument(bomPath), bomEditor = await vscode.window.showTextDocument(bomDoc);
  assert.equal(bomDoc.getText().charCodeAt(0), 'u'.charCodeAt(0), 'VS Code strips the BOM from getText()');
  bomEditor.selection = new vscode.Selection(0, 0, 0, bomDoc.lineAt(0).text.length);
  await api.addPin('question', 'BOM line one');
  const bomPin = api.snapshot().pins.find(p => p.body === 'BOM line one')!;
  await vscode.commands.executeCommand('reviewPins.open', { type: 'pin', pin: bomPin });
  assert.equal(vscode.window.activeTextEditor?.document.uri.scheme, 'file', 'pin on a BOM file line 1 opens its code, not stale details');
  mark('bom');
  // AI context and Delete: preview first, copy/delete only on modal confirmation, cancel changes nothing.
  const answers: Record<string, string | undefined> = {};
  const prompts: unknown[][] = [];
  const prompt = async (...args: unknown[]) => { prompts.push(args); return answers[String(args[0])]; };
  const orig2 = { info: w.showInformationMessage, warn: w.showWarningMessage };
  w.showInformationMessage = prompt; w.showWarningMessage = prompt;
  const note = api.snapshot().pins.find(p => p.kind === 'note')!;
  try {
    await vscode.env.clipboard.writeText('sentinel');
    answers['Copy this AI prompt to the clipboard?'] = 'Copy AI Prompt';
    await vscode.commands.executeCommand('reviewPins.askAI', { type: 'pin', pin: reopened });
    const askPrompt = prompts.find(c => c[0] === 'Copy this AI prompt to the clipboard?'); assert.ok(askPrompt, 'ask-AI confirmation shown');
    assert.equal((askPrompt[1] as { modal?: boolean }).modal, true, 'ask-AI confirmation is modal');
    assert.deepEqual(askPrompt.slice(2), ['Copy AI Prompt'], 'action-specific button');
    assert.match((askPrompt[1] as { detail: string }).detail, /Nothing is sent to an AI chat automatically/);
    assert.match(vscode.window.activeTextEditor!.document.uri.path, /Ask AI \(Copy Prompt\)/, 'preview title names the mode');
    assert.equal(vscode.window.activeTextEditor?.document.uri.scheme, 'review-pins', 'preview opened before copying');
    let copied = await vscode.env.clipboard.readText();
    assert.equal(copied, vscode.window.activeTextEditor!.document.getText(), 'copied text is exactly the preview'); assert.match(copied, /^# Review Pin: question\n\n## AI Instructions\n[\s\S]*\n## Pin Context\n/); assert.match(copied, /What happens if save fails\?/);
    assert.match(copied, /if \(ready\) save\(\);/); assert.match(copied, /- File: "sample.ts", line 2\n/); assert.match(copied, /- Location: Unchanged/);
    assert.match(copied, /target "A-1"/); assert.match(copied, /^## Saved Code$/m);
    // Privacy: no absolute worktree path, pin UUID or full commit in what reaches the clipboard.
    const root = await fs.realpath(folder.uri.fsPath);
    assert.ok(!copied.includes(root) && !copied.includes(folder.uri.fsPath), 'no absolute worktree path');
    assert.ok(!copied.includes(reopened.id), 'no pin UUID');
    assert.doesNotMatch(copied, /[0-9a-f]{40}/, 'no full commit SHA');
    assert.match(copied, new RegExp(`- Worktree: "${path.basename(root)}"`), 'worktree identified by folder name only');
    await vscode.env.clipboard.writeText('sentinel'); prompts.length = 0;
    answers['Copy this pin context to the clipboard?'] = undefined; // user dismisses the modal
    await vscode.commands.executeCommand('reviewPins.copyContext', { type: 'pin', pin: note });
    assert.ok(prompts.some(c => c[0] === 'Copy this pin context to the clipboard?'));
    assert.equal(await vscode.env.clipboard.readText(), 'sentinel', 'cancel copies nothing');
    answers['Copy this pin context to the clipboard?'] = 'Copy Context';
    await vscode.commands.executeCommand('reviewPins.copyContext', { type: 'pin', pin: note });
    copied = await vscode.env.clipboard.readText();
    assert.match(copied, /^# Review Pin: note\n\n## Pin Context\n/); assert.doesNotMatch(copied, /AI Instructions/); assert.ok(!copied.includes(note.id));
    assert.deepEqual(prompts.filter(c => c[0] === 'Copy this pin context to the clipboard?').map(c => c[2]), ['Copy Context', 'Copy Context'], 'action-specific button'); assert.match(copied, /Review save behavior\./);
    assert.equal(api.snapshot().pins.length, 3, 'copying changes no pins');
    answers['Delete this pin permanently?'] = undefined;
    await vscode.commands.executeCommand('reviewPins.delete', { type: 'pin', pin: note });
    assert.ok(api.snapshot().pins.some(p => p.id === note.id), 'cancelled delete keeps the pin');
    answers['Delete this pin permanently?'] = 'Delete';
    await vscode.commands.executeCommand('reviewPins.delete', { type: 'pin', pin: note });
    assert.ok(!api.snapshot().pins.some(p => p.id === note.id), 'confirmed delete removes the pin');
    assert.ok(prompts.filter(c => c[0] === 'Delete this pin permanently?').every(c => (c[1] as { modal?: boolean }).modal === true), 'delete confirmation is modal');
    assert.ok(!prompts.some(c => String(c[0]).startsWith('Finish or cancel')), 'no command blocked by busy flag');
  } finally { w.showInformationMessage = orig2.info; w.showWarningMessage = orig2.warn; }
  mark('ai-context/delete');
  // AI-02: answer capture and human verification through the real commands and the propose tool.
  type QPin = Extract<State['pins'][number], { kind: 'question' }>;
  const question = () => api.snapshot().pins.find(p => p.id === q.id) as QPin;
  const node = () => ({ type: 'pin', pin: question() });
  const picks: Record<string, (items: { label: string }[]) => unknown> = {}, modal: Record<string, string | undefined> = {}, inputs: string[] = [], errors: string[] = [];
  const orig3 = { pick: w.showQuickPick, info: w.showInformationMessage, input: w.showInputBox, err: w.showErrorMessage };
  w.showQuickPick = async (items: { label: string }[], o: { title: string }) => picks[o.title]!(await items);
  w.showInformationMessage = async (m: string) => modal[m];
  w.showInputBox = async () => inputs.shift();
  w.showErrorMessage = async (m: string) => { errors.push(m); return undefined; };
  try {
    const rev0 = api.snapshot().revision;
    await vscode.env.clipboard.writeText('Await save() and surface the error.');
    picks['Who produced this answer?'] = items => items.find(i => i.label.includes('Copilot'));
    picks['Answer text'] = items => items.find(i => i.label.includes('Paste'));
    modal['Save this answer to the question?'] = undefined; // cancel
    await vscode.commands.executeCommand('reviewPins.attachAnswer', node());
    assert.match(vscode.window.activeTextEditor!.document.getText(), /^# Answer preview[\s\S]*Copilot answer \(AI\) · will be saved as Pending verification[\s\S]*> Await save\(\)/, 'preview shown before saving');
    assert.equal(question().answers, undefined, 'cancel saves nothing'); assert.equal(api.snapshot().revision, rev0, 'cancel writes nothing');
    modal['Save this answer to the question?'] = 'Save Answer';
    await vscode.commands.executeCommand('reviewPins.attachAnswer', node());
    let qa = question();
    assert.equal(qa.answers?.length, 1); assert.equal(qa.answers![0]!.source, 'copilot'); assert.equal(qa.answers![0]!.verification, 'pending');
    assert.equal(qa.status, 'open', 'attaching does not resolve'); assert.equal(qa.answer, '', 'legacy answer note untouched');
    picks['Who produced this answer?'] = items => items.find(i => i.label.includes('Written by me'));
    picks['Answer text'] = items => items.find(i => i.label.includes('Type'));
    inputs.push('Checked manually: errors are logged.');
    await vscode.commands.executeCommand('reviewPins.attachAnswer', node());
    qa = question();
    assert.deepEqual(qa.answers!.map(a => [a.source, a.verification]), [['copilot', 'pending'], ['manual', 'pending']], 'second answer appended, first kept');
    picks['Which answer did you verify?'] = items => items[0];
    modal['Mark this answer as verified?'] = undefined;
    await vscode.commands.executeCommand('reviewPins.verifyAnswer', node());
    assert.equal(question().answers![0]!.verification, 'pending', 'cancelled verification changes nothing');
    modal['Mark this answer as verified?'] = 'Mark Verified';
    await vscode.commands.executeCommand('reviewPins.verifyAnswer', node());
    qa = question();
    assert.equal(qa.answers![0]!.verification, 'verified'); assert.equal(qa.answers![1]!.verification, 'pending'); assert.equal(qa.status, 'open', 'verifying does not resolve');
    await vscode.commands.executeCommand('reviewPins.resolve', node());
    await vscode.commands.executeCommand('reviewPins.reopen', node());
    assert.deepEqual(question().answers, qa.answers, 'resolve → reopen keeps answer history');
    await vscode.commands.executeCommand('reviewPins.viewAnswers', node());
    assert.match(vscode.window.activeTextEditor!.document.getText(), /## Answers \(2\)[\s\S]*Copilot answer \(AI\) · Verified[\s\S]*Manual answer · Pending verification/);
    // Propose tool: the agent can only propose; Review Pins' own modal decides.
    const rev1 = api.snapshot().revision;
    modal['Save the chat agent’s answer to this Review Pin?'] = undefined;
    assert.match(await toolText('reviewPins_proposeAnswer', { pinId: q.id, answer: 'Agent says: wrap save() in try/catch.' }), /declined[\s\S]*Nothing was changed/);
    assert.equal(api.snapshot().revision, rev1, 'declined proposal writes nothing');
    modal['Save the chat agent’s answer to this Review Pin?'] = 'Save as Copilot Answer';
    assert.match(await toolText('reviewPins_proposeAnswer', { pinId: q.id, answer: 'Agent says: wrap save() in try/catch.' }), /pending verification[\s\S]*only the user can verify/);
    qa = question();
    assert.equal(qa.answers!.length, 3); assert.deepEqual([qa.answers![2]!.source, qa.answers![2]!.verification, qa.answers![2]!.sourceLabel], ['copilot', 'pending', undefined]); assert.equal(qa.status, 'open');
    await assert.rejects(toolText('reviewPins_proposeAnswer', { pinId: '00000000-0000-4000-8000-000000000000', answer: 'x' }), /No pin with this id in the current worktree/);
    await assert.rejects(toolText('reviewPins_proposeAnswer', { pinId: q.id }), /answer is required/);
    assert.match(await toolText('reviewPins_getPinContext', { pinId: q.id }), /## Saved Answers[\s\S]*1\. Copilot answer \(AI\) · Verified[\s\S]*3\. Copilot answer \(AI\) · Pending verification/);
    assert.ok(!errors.length, errors.join('; '));
  } finally { w.showQuickPick = orig3.pick; w.showInformationMessage = orig3.info; w.showInputBox = orig3.input; w.showErrorMessage = orig3.err; }
  mark('answers');
  await fs.writeFile(doc.uri.fsPath, '// shifted\nconst ready = true;\nif (ready) save();\n');
  await api.refresh();
  await vscode.commands.executeCommand('reviewPins.open', { type: 'pin', pin: reopened });
  assert.equal(vscode.window.activeTextEditor?.document.uri.scheme, 'review-pins');
  assert.match(vscode.window.activeTextEditor!.document.getText(), /Location needs review/);
  w.showInformationMessage = async (m: string) => m === 'Copy this pin context to the clipboard?' ? 'Copy Context' : undefined;
  try { await vscode.commands.executeCommand('reviewPins.copyContext', { type: 'pin', pin: reopened }); }
  finally { w.showInformationMessage = orig2.info; }
  assert.match(await vscode.env.clipboard.readText(), /- Location: STALE:[\s\S]*## Saved Code/, 'stale location is labelled in copied context');
  const staleCtx = await toolText('reviewPins_getPinContext', { pinId: reopened.id });
  assert.match(staleCtx, /1\. Copilot answer \(AI\) · Verified for earlier code; re-check/, 'verification does not carry over to changed code');
  { const errs: string[] = []; const o = { pick: w.showQuickPick, err: w.showErrorMessage }; w.showErrorMessage = async (m: string) => { errs.push(m); return undefined; }; w.showQuickPick = async () => undefined;
    const before = api.snapshot().revision;
    try { await vscode.commands.executeCommand('reviewPins.verifyAnswer', { type: 'pin', pin: api.snapshot().pins.find(p => p.id === reopened.id) }); }
    finally { w.showErrorMessage = o.err; w.showQuickPick = o.pick; }
    assert.ok(errs.some(m => /pinned code needs review/.test(m)), 'cannot verify against stale code'); assert.equal(api.snapshot().revision, before); }
  assert.match(staleCtx, /- Location: STALE:/);
  assert.match(staleCtx, /## Current File\n\nText on disk at the saved line range now[\s\S]*```\nconst ready = true;\n```/, 'current text at the saved line shown separately from saved code');
  mark('stale');
  await fs.unlink(doc.uri.fsPath);
  await api.refresh();
  await vscode.commands.executeCommand('reviewPins.details', { type: 'pin', pin: reopened });
  assert.match(vscode.window.activeTextEditor!.document.getText(), /File missing/);
  assert.match(await toolText('reviewPins_getPinContext', { pinId: reopened.id }), /- Location: MISSING:[\s\S]*Only the saved snapshot is available/);
  mark('missing');
  console.log('HOST_TEST_PASS: activation, real editor pins, in-host refresh (not a restart), resolve/reopen, modal handoff + clipboard, ask-AI/copy-with-context preview + modal copy + cancel, modal delete + cancel, readonly details, code navigation, stale and missing-file handling, read-only LM tools (list/filter/context/stale/missing/errors), answer capture (cancel/save/append/manual), verification (cancel/verify/stale refusal/outdated), resolve-reopen history, propose tool (decline/save/errors).');
}
