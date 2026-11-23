# Review Pins

A local VS Code extension: attach questions and review notes to changed code, find them again, and hand unresolved questions to a coding agent session.

## Product scope (v0.1, frozen)

- Questions have open/resolved state; notes are reference records.
- Each pin keeps the session it was created in, the current target session, and the worktree.
- Unresolved questions can be bundled, previewed, and copied for handoff. Copy is not send: the extension never runs an agent by itself.
- When code changes or a file is deleted, a pin is shown as stale or missing. Reconnecting is explicit.
- Questions can carry append-only answers (manual or AI) that stay pending until a person verifies them. Answers never resolve a question.
- Language model tools let a chat agent (for example Copilot Agent mode) list pins, read one pin, and propose an answer that is saved only after user approval.
- Out of scope: automatic agent execution, automatic resolve or verify, automatic recovery across complex rebases, MCP and other provider integrations.

## Current state

- v0.1.0 is feature-frozen; unit tests and VS Code host integration tests pass; the VSIX builds.
- Next milestone: publish v0.1.0 to GitHub and the VS Code Marketplace with no new features.

## Commands

- Install: `npm install`
- Build: `npm run compile`
- Unit tests: `npm test`
- Integration tests (VS Code host): `npm run test:host`
- Package VSIX: `npm run package`

## Invariants

- Keep Git and source files unchanged. Pin data belongs in extension global storage, keyed by worktree.
- Keep worktree identity separate from branch labels and optional session labels.
- Preserve pin creation evidence; reattaching or handing off must not rewrite origin.
- Never imply a copied prompt was sent, answered, or verified.
- Validate persisted data and fail visibly on corruption or concurrent writes.

## Working rules

- Run `npm test` and `npm run package` after relevant changes. Run `npm run test:host` for VS Code integration changes.
- Run tests before and after every refactor step. A refactor must not change behavior unless the task says so.
- Keep changes small and reviewable: one concern per commit.
- Do not add features while the v0.1 scope is frozen. Propose them in a list instead.
- UI quality matters as much as correctness: keyboard flow, focus handling, empty/error/stale states, and accessibility.
- Record scope decisions ("we are not doing X") in this file. Put short design rationale in `docs/notes/`.
- Never commit secrets, private planning notes, or employer code.
