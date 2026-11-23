# Manual checks

Use disposable local Git worktrees. Do not use confidential code when recording screenshots or sharing handoff text.

- [ ] F5 starts the extension, commands appear, and an empty view explains the first action.
- [ ] Create a question and a note from selected saved lines. With no selection, capture the current line.
- [ ] Pin source files stay unchanged. Reload VS Code and find the same pins.
- [ ] Use keyboard navigation to open a pin, edit it, and return to code.
- [ ] Set label A, create a question, then set label B. Existing origin A stays intact.
- [ ] Hand off only selected unresolved questions to A-1. Read the preview before copying. Notes and resolved questions are absent.
- [ ] The handoff preview shows relative paths (`"sample.ts", line 2`), a worktree folder name, and location labels (STALE/MISSING/UNVERIFIED). No /Users/… path, pin ID or 40-character commit hash appears.
- [ ] Cancel the handoff; targets remain unchanged.
- [ ] After copying, origin remains A and target becomes A-1. No external session is opened or called.
- [ ] Add an answer. It remains open until explicitly resolved. Reopen a resolved question.
- [ ] Insert a line above pinned code, change the code, and delete the file. Stale/missing pins open saved details instead of highlighting a guessed location.
- [ ] Reattach a stale pin using selected lines. Details retain the original code and origin label.
- [ ] Open a second worktree with the same file names. Its pins remain separate.
- [ ] Try an unsaved document, dirty file, symlink outside the worktree, nested repo, non-Git folder, and multi-root workspace. Errors explain the unsupported case without changing source files.
- [ ] Inspect handoff code containing Markdown fences. It remains clearly quoted as review material.
- [ ] Empty view (new repo, no pins) shows numbered first-use steps with Add Question / Add Note buttons. A non-Git folder shows the reason (for example “Open a local Git repository or worktree…”) at the top of the view instead. After the first pin is created, the “Session: … · local labels only” line appears.
- [ ] Hover a pin: a trash icon appears; its tooltip says Delete Pin. Cancel the dialog (Esc and Cancel): pin stays. Confirm: pin is removed. Context-menu Delete behaves the same.
- [ ] With a screen reader (VoiceOver), a pin row reads kind, text, file, line, and location state; the trash icon announces Delete Pin.
- [ ] Ask AI (Copy Prompt) on a question and on a note: the preview tab is titled “Ask AI (Copy Prompt)” and shows an “AI Instructions” section, then “Pin Context” (type, relative file and lines, location, sessions, worktree folder name, pin text) and “Saved Code”. No absolute path (no /Users/…), pin ID or 40-character commit hash appears; a branch and 7-character commit appear only for stale/missing locations. The dialog button reads “Copy AI Prompt” and says nothing is sent automatically. Cancel copies nothing (clipboard unchanged). Copy AI Prompt copies exactly the preview. No chat opens; pin is not resolved.
- [ ] Copy with Context on a pin: the preview tab is titled “Copy with Context” and shows only “Pin Context” (no AI Instructions). The button reads “Copy Context” and copies exactly the preview.
- [ ] Shift the pinned code, then Ask AI (Copy Prompt): preview and copied text say STALE. Delete the file: MISSING.
- [ ] Edit the pinned file while the preview is open, then confirm: copy is refused with a “changed” message.
- [ ] Copilot Agent tools (requires GitHub Copilot Chat, signed in): in Chat → Agent mode → Configure Tools, “List Review Pins” and “Get Review Pin Context” are listed. Ask “List my open Review Pins questions”; the agent calls List Review Pins and shows ids, files, lines, and location state. Ask it to explain one; it calls Get Review Pin Context. No pin is resolved, no answer is recorded, no file changes.
- [ ] Shift a pinned line, then ask the agent about that pin: the tool output says STALE and shows the current text at the saved lines separately from the saved code; the agent's answer should reflect that uncertainty.
- [ ] Open a second worktree in another window and ask for a pin id from the first: the tool says no such pin in the current worktree.
- [ ] Without Copilot installed (or signed out), Review Pins works normally and no errors appear.
- [ ] Attach Answer… on an open question: choose Copilot, paste from the clipboard, read the preview (“will be saved as Pending verification”), Cancel: nothing is saved. Repeat and Save: the tree shows “1 answer pending”; the question stays open; the existing Edit Answer note is unchanged.
- [ ] Attach a second answer as “Written by me” (typed): View Answers lists both, labelled Copilot answer (AI) / Manual answer, both Pending verification.
- [ ] Mark Answer Verified…: Cancel leaves it pending. Confirm: it shows Verified, tree shows “1 verified answer, 1 pending”, question still open.
- [ ] Resolve, then Reopen: all answers remain.
- [ ] Insert a line above the pinned code and save: the verified answer shows “Verified for earlier code; re-check”, and Mark Answer Verified… refuses until the pin is reattached. After reattaching, verify again.
- [ ] Copilot Agent: ask it to answer a pin, then “save that answer to the pin”. A preview and a Review Pins dialog appear. Cancel: Copilot is told nothing was saved. Save as Copilot Answer: the answer appears as pending. Copilot cannot verify or resolve.
- [ ] Install the VSIX into a clean profile and repeat the core create → restart → handoff → resolve flow.

Packaging and automated host tests do not replace these interaction checks. Record any checks not performed before describing release readiness.
