# Architecture

`extension.ts` adapts native VS Code commands, Tree View, decorations, input boxes, and read-only virtual documents to the core. There is no webview or model runtime.

- `domain.ts`: question/note types, creation snapshots, explicit handoff, Markdown serialization, runtime schema checks.
- `repository.ts`: bounded read-only Git calls, canonical worktree identity, path containment, saved-location inspection.
- `store.ts`: worktree-bound state, revision checks, exclusive writes, temporary file replacement and corruption preservation.

The creation anchor and session are immutable evidence. The current anchor can change only through explicit reattachment; the target session can change through handoff. Question state and code-location state are independent.

Data writes acquire a lock before reading the latest revision. Two windows cannot silently commit changes from the same revision. The UI also checks that an edited pin has not changed while an input was open. Conflicts remain visible and require refresh/retry. Writes do not automatically recover locks left by a crashed host.

Handoff is an explicit sequence: select → inspect locations → preview → validate revision/location statuses → copy → persist target. Clipboard and disk cannot participate in one atomic transaction. If the clipboard succeeds but persistence fails, the user is told that the target was not saved. A copied prompt is never marked as sent.

Language model tools are registered with the stable `vscode.lm.registerTool` API and declared under `contributes.languageModelTools`. The read tools (`reviewPins_listPins`, `reviewPins_getPinContext`) refresh, read the current worktree's state, and render text through `domain.ts`; they never write, never take the command busy lock, and look up pins only in the open worktree. Context output keeps the saved snapshot and the current file text (`repository.currentLines`, read only when the location needs review) in separate sections, and labels pin text and code as untrusted material.

Answers are optional, append-only records on question pins (`answers`), so v0.1.0 data loads without migration and older builds keep the field when they rewrite a pin. `domain.ts` owns the rules (`addAnswer`, `verifyAnswer`, `answerState`) for every client: commands, chat tools, and later adapters. A verification stores `anchorKey` of the code it was checked against; it counts only while the current anchor has the same key and the location is unchanged. Verification and question resolution are independent. The propose tool shares the command's save path (preview → modal → revision-checked write); the modal is the approval boundary because VS Code's tool confirmation can be set to auto-approve.

Location matching compares the saved line range plus adjacent context. It is intentionally conservative: line drift is flagged rather than guessed. Snapshots may become stale after checking and do not prove runtime behavior. Creation commit metadata is not a complete dirty-worktree snapshot.
