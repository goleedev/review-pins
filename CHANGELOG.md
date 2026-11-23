# Changelog

## 0.1.0

First public release.

### Pins
- Add questions and notes to selected lines of saved code. Questions are open or resolved; notes are reference records.
- Review Pins view grouped by Questions, Notes and Resolved, then by file, with editor markers, hover actions (Details, Edit, Delete) and first-use guidance.
- Pins are stored per Git worktree in VS Code extension storage. Source files and Git are never modified.
- Each pin keeps its origin: session label, branch, commit and the original code. Reattaching or handing off never rewrites it.

### Code changes
- Changed, moved and deleted code is reported as STALE or MISSING, with the saved code shown instead of a guessed location. Reattaching is explicit.
- Files with CRLF line endings or a UTF-8 byte-order mark are compared correctly.
- Workspaces opened through a symbolic link open pinned files under the workspace path, reusing the existing editor tab.

### AI
- Language model tools for GitHub Copilot Agent mode and other VS Code chat clients: **List Review Pins** and **Get Review Pin Context** (read-only), and **Propose Review Pin Answer**, which saves only after you approve it in Review Pins' own dialog.
- Answers with human verification: **Attach Answer…**, **View Answers**, **Mark Answer Verified…**. Answers are append-only, start as pending verification, never resolve a question, and show *re-check* once the pinned code changes or the pin is reattached.
- **Ask AI (Copy Prompt)**, **Copy with Context** and **Hand Off Questions** copy a previewed prompt after confirmation. Copied text uses repository-relative paths and omits absolute paths, internal pin IDs and full commit hashes. The pin details view likewise shows only the worktree folder name and a short commit.

### Safety
- Concurrent writes from several windows are detected; corrupt or unsupported storage is preserved and reported, never reset.
- No accounts, telemetry or network calls by the extension.

### Known limitations
- Tested on macOS with VS Code 1.147 only. Windows, Linux, VSCodium and older VS Code versions are untested.
- One local workspace folder; no remote or multi-root workspaces. Pins are not migrated if a worktree directory moves.
