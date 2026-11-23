# Screenshot demo

A small, made-up TypeScript project (`acme-checkout`) with seeded pins, used for the README screenshots. Nothing here ships in the VSIX, and setup never touches your normal VS Code profile or QA data.

## Setup

```sh
npm run compile
node demo/setup-demo.cjs
```

The script recreates `/tmp/rp-demo` (override with `DEMO_DIR`, keep it short): a Git repo on branch `feature/discounts`, an isolated profile (Default Dark Modern theme, no minimap, window title without paths, telemetry off), and six pins created through the extension's own storage code:

| Pin | File:line | State |
|---|---|---|
| Question: *What happens if percent is over 100? Should it be clamped?* | `src/pricing.ts:12–13` | open |
| Question: *Is free shipping inclusive at exactly 50?* | `src/pricing.ts:17` | open |
| Question: *Does this also wait after the final failed attempt?* | `src/retry.ts:8` | open |
| Note: *Totals are not rounded to cents here…* | `src/pricing.ts:8` | note |
| Note: *Consider an options object…* | `src/retry.ts:1` | note |
| Question: *Is subtotal safe for an empty cart?* | `src/pricing.ts:7` | resolved |

Install the VSIX into the demo profile and open it with the commands the script prints. Then resize the window to 1440×900 (for example with your window manager), and click the Review Pins icon in the activity bar.

Capture the window only (macOS: Cmd+Shift+4, Space, click the window) and save PNGs to `media/screenshots/`. Before saving, check that no username, home path, email or token is visible. The title bar should show only `acme-checkout — <file>`.

## The four screenshots

### 1. `01-pin-questions.png`: Pin your questions
- Editor: `src/pricing.ts`. Sidebar: Review Pins with Questions and Notes expanded, Resolved collapsed.
- Select the first question in the tree so the editor highlights lines 12–13 and the `? review` marker is visible.
- Optional: hover the question to show the Details / Edit / Delete buttons.

### 2. `02-track-changing-code.png`: Track changing code
- Run `node demo/setup-demo.cjs --stale` (edits line 12 of `pricing.ts` on disk).
- Click **Refresh** in the Review Pins toolbar. The clamp question shows a warning icon and "check location".
- Click the question: the details document opens with **Location: Location needs review** and **Code at creation** showing the original line. Keep the tree and the details side by side.

### 3. `03-review-with-copilot.png`: Review with Copilot (real interaction only)
- Requires GitHub Copilot Chat installed and signed in to the demo profile. Rerun `node demo/setup-demo.cjs` first for the original code.
- Chat → **Agent** mode → **Configure Tools**: enable the three Review Pins tools.
- Ask: *"Look at my open Review Pins questions and answer the one about percent over 100."*
- Capture when the chat shows the **List Review Pins** and **Get Review Pin Context** tool calls and Copilot's answer. Do not stage or edit the answer.

### 4. `04-verify-before-resolving.png`: Verify before resolving (real interaction only)
- Continue from 3: ask *"Save that answer to the pin."* and choose **Save as Copilot Answer** in the Review Pins dialog.
- Right-click the question → **View Answers**: the details show *Copilot answer (AI) · Pending verification*; the tree shows "1 answer pending".
- Optional second capture after **Mark Answer Verified…**: *Verified* and "1 verified answer", question still open.

When the files exist, replace the matching `<!-- Screenshot N … -->` comments in the top-level README with image links, for example `![Questions and notes next to code](media/screenshots/01-pin-questions.png)`. Marketplace rewrites relative image paths to the GitHub repository, so images appear only after they are pushed.
