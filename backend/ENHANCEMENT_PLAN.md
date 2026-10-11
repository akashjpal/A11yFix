# A11yFix Enhancement Plan — Project Rules Compliance + Visual Testing

> Status: PLANNED | Created: 2026-10-11
> Two gaps this plan closes:
> 1. **AI fixes ignore project conventions** — the prompt is generic; the model rewrites files however it likes.
> 2. **No visual verification** — a fix can pass build + axe while breaking the page's appearance.

---

## Current pipeline (what exists today)

```
scan → issue → generateFix (generic prompt, full-file rewrite)
     → validatePatch (brace balance only)
     → [PR step] applyPatch → runBuild → rerunAxe (violation count only) → createPR
```

**Problems:**
- Prompt knows nothing about the project's lint rules, formatting, framework idioms, or conventions.
- Model returns the **entire file** — high risk of unintended rewrites (reformatting, renaming, reordering).
- Verification = "does it compile" + "did the axe count drop". A fix that adds `alt="image"` but shifts the hero layout 40px would pass today.

---

## Target pipeline

```
                    ┌──────────────────────────────────────────────┐
                    │            REPAIR LOOP (max 3 attempts)      │
                    ▼                                              │
generate ──► validatePatch ──► lintCheck ──► formatCheck ───────────┤
             (structure)      (eslint)     (prettier)               │
                                    │                               │
                                    ▼ pass                          │
             applyPatch ──► runBuild ──► rerunAxe ──► visualDiff ───┤
             (working tree)  (tsc/vite)  (rule gone?  (screenshots   │
                                          no NEW      before/after) │
                                          issues?)                  │
                                    │ all gates pass                │
                                    ▼                               │
                              createPR ◄────────────────────────────┘
                              (with evidence attached)
```

Every gate that fails feeds its **actual error output** back into the AI prompt for a targeted repair — not a blind retry.

---

## Part A — Project rules compliance

### A1. Project rules extraction (`src/services/rulesExtractor.js` — NEW)

At scan time (after clone, before scan), walk the repo and build a `projectRules` object:

| Source | What we extract |
|---|---|
| `eslint.config.*` / `.eslintrc*` | enabled rules, parser options, plugin list |
| `.prettierrc*` / `prettier.config.*` | printWidth, semi, quotes, etc. |
| `.editorconfig` | indent style/size, charset, line endings |
| `tsconfig.json` | strict mode, JSX style, path aliases |
| `package.json` | framework + versions (React 18? Vue? Svelte?), lint scripts |
| `CONTRIBUTING.md` / `AGENTS.md` / `CLAUDE.md` | human-written conventions (first ~100 lines) |
| `README.md` | code style section if present |

Store on the scan record: `scan.projectRules`. Cheap to compute, no new deps (just file reads + JSON parse).

### A2. Constrained prompt rewrite (`src/services/aiFix.js` — MODIFY)

Replace the generic prompt with a rules-aware one:

```
You are fixing ONE accessibility violation in this project.

## Project conventions (MUST follow)
- Framework: React 18 + TypeScript 5 (from package.json)
- ESLint rules in effect: <relevant subset, e.g. react/jsx-*, @typescript-eslint/*>
- Formatting: 2-space indent, single quotes, semicolons (from .prettierrc/.editorconfig)
- Project notes: <from CONTRIBUTING/AGENTS.md if present>

## Change policy
1. Change ONLY the minimal lines needed to fix the violation.
2. Do NOT reformat, reorder, rename, or "improve" anything else.
3. Match the file's existing style exactly (look at surrounding code).
4. Use the project's idioms (e.g. className not class, aria-* per JSX spec).

## Output format — SEARCH/REPLACE blocks, not the whole file:
<<<<<<< SEARCH
[exact existing lines]
=======
[replacement lines]
>>>>>>> REPLACE
```

**Key change: SEARCH/REPLACE blocks instead of full-file rewrites.** This mechanically guarantees "minimal change" — anything the model doesn't touch stays byte-identical. Add a `applySearchReplace(sourceCode, response)` parser in `patchValidator.js` that:
- finds each SEARCH block verbatim in the source (fail loudly if not found — hallucinated context)
- applies replacements
- errors if a SEARCH block matches zero or multiple locations

### A3. Post-generation lint gate (`src/services/lintGate.js` — NEW)

After applying the patch to a **temp copy** of the file (not the working tree yet):

1. If the project has eslint installed → run `npx eslint <file> --no-eslintrc` NO — run with project config: `npx eslint <file> -f json`, parse errors.
2. If the project has prettier → `npx prettier --check <file>`.
3. If TypeScript project → `npx tsc --noEmit <file>` scoped check (or rely on the build gate).

Return structured results: `{ passed, errors: [{ line, message, ruleId }] }`.

**No eslint/prettier in the target project?** Fall back to a "style consistency check": compare indentation character, quote style, and semicolon usage of the changed lines vs. the original file — flag mismatches.

### A4. Repair loop (`src/jobs/fixPipeline.js` — NEW, orchestrator)

Extract the fix flow from the route into a job with a bounded loop:

```
attempt = 0
while (attempt < 3):
    response = generateFix(issue, source, rules, attemptErrors)   # attemptErrors = [] on first pass
    patch = parseSearchReplace(response)
    if !patch.valid: attemptErrors = patch.errors; continue
    lint = lintGate(patch.appliedContent)
    if !lint.passed: attemptErrors = lint.errors; continue
    break
if attempt == 3: mark fix 'failed' with all gate outputs (transparent to user)
```

The repair prompt includes the exact lint/tsc errors with line numbers — the model fixes its own mistakes, which converges fast (usually 1 extra attempt).

### A5. PR body shows compliance evidence

PR body gains a section:

```
## Compliance checks
- ✅ eslint: 0 errors (project config)
- ✅ prettier: formatted per project config
- ✅ tsc: no type errors
- 🔁 Repair attempts: 1 (fixed eslint react/jsx-aria-props)
```

Reviewers see the fix was held to the project's standards — great demo material.

---

## Part B — Visual testing

### B1. Baseline capture at scan time (`src/services/visualBaseline.js` — NEW)

During the initial scan (before any fix), for each route:

1. `page.goto(route)` at fixed viewport **1280×720** (and optionally 375×667 mobile)
2. Wait for `networkidle` + 500ms settle
3. Disable animations/transitions via injected CSS (`*, *::before, *::after { animation: none !important; transition: none !important; }`) — kills flaky diffs
4. `page.screenshot({ fullPage: true })` → save to `tmp/<scanId>/baseline/<route-hash>.png`
5. Also capture **element bounding boxes** for the issue's target element (from axe's `target` selector): `{ x, y, width, height }` → `baseline/layout.json`

Store `baselineDir` on the scan record.

### B2. Post-fix capture + comparison (`src/services/visualDiff.js` — NEW)

After patch + rebuild + app restart (the verifier already restarts nothing today — see B4), for the same routes:

1. Same screenshot procedure → `tmp/<scanId>/after/<route-hash>.png`
2. Compare with **pixelmatch** (~5KB, zero native deps):

```js
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const diff = new PNG({ width, height });
const changedPixels = pixelmatch(before, after, diff, threshold: 0.1);
const diffRatio = changedPixels / (width * height);
```

3. Save `diff.png` (pixelmatch writes a highlighted diff image) → attach to PR.

### B3. Layout-shift check (cheap + high signal)

Pixel diff alone flags every cosmetic change. The **targeted** check:

- Re-query the issue's target element bounding box after the fix
- Compare against baseline: if center moved > 8px or size changed > 10% → layout regression
- Also check the element's **siblings** (previous/next element positions) — catches content pushing neighbors around

Result: `{ pixelDiffRatio, layoutShift: boolean, shiftedElements: [...] }`

### B4. App restart correctness (prerequisite bug)

`rerunAxe` today hits the **still-running pre-fix app** — the dev server serves the old code until restarted (Vite HMR only helps if the file watcher picks it up in the cloned tmp dir; unreliable). The PR step must:

1. Kill the old app process (store the child process handle on the scan record)
2. `npm run build` (already exists)
3. Restart the app (reuse `startApp` from repoManager with a NEW port)
4. Wait for server ready
5. Then rerunAxe + visual capture

Without this, both the axe re-check and visual diff are testing the **old** code. This is a correctness bug to fix regardless.

### B5. Visual gate policy

| Result | Action |
|---|---|
| `diffRatio < 0.5%` AND no layout shift | ✅ pass — proceed to PR |
| `diffRatio 0.5–3%` AND no layout shift | ⚠️ pass with warning noted in PR body |
| layout shift on target element | ❌ feed screenshots + boxes into repair loop |
| `diffRatio > 3%` | ❌ fail — likely unintended rewrite; repair loop |

Thresholds in `.env`: `VISUAL_DIFF_WARN=0.005`, `VISUAL_DIFF_FAIL=0.03`, `LAYOUT_SHIFT_PX=8`.

### B6. (Optional, Phase 2) AI vision review

Send before/after/diff screenshots to a vision model (OpenRouter hosts vision models) with:

> "Screenshot 1 is before an accessibility fix, screenshot 2 is after. Did the visual layout change in any way a user would notice? Answer PASS or FAIL with reason."

Nice demo moment, but deterministic pixelmatch + layout boxes cover 90% of the value. Do this only after B1–B5 ship.

### B7. PR evidence

PR body gains:

```
## Visual verification
- ✅ Pixel diff: 0.12% (threshold 3%)
- ✅ Layout: target element stable (Δx=0, Δy=2px)
- 📷 [before](…) · [after](…) · [diff](…)   ← upload diff.png via PR comment or check run
```

Simplest attachment path: create a PR **check run** or upload images to the PR as a comment via the issues API (`octokit.issues.createComment` with markdown image links requires hosted URLs — alternative: commit the `diff.png` to the fix branch under `.a11yfix/evidence/` and link it by path).

---

## Implementation order

| Phase | Work | Files | Est. effort |
|---|---|---|---|
| **0** | Fix app-restart correctness (B4) — everything else depends on it | `repoManager.js`, `jobs/runner.js`, `routes/fixes.js` | ~1h |
| **1** | SEARCH/REPLACE patching + parser | `aiFix.js`, `patchValidator.js` | ~2h |
| **2** | Rules extraction + rules-aware prompt | `rulesExtractor.js` (new), `aiFix.js`, `jobs/runner.js` | ~2h |
| **3** | Lint gate + repair loop orchestration | `lintGate.js` (new), `fixPipeline.js` (new), `routes/scans.js` | ~3h |
| **4** | Visual baseline + diff + layout check + gate | `visualBaseline.js`, `visualDiff.js` (new), deps: `pixelmatch`, `pngjs` | ~3h |
| **5** | PR evidence (compliance + visual sections) | `routes/fixes.js`, `githubService.js` | ~1h |
| **6** | (Optional) AI vision review | `visualDiff.js` | ~2h |

**New npm deps:** `pixelmatch`, `pngjs` only. Everything else uses what's installed (playwright, simple-git, octokit).

## New env vars

```
VISUAL_DIFF_WARN=0.005
VISUAL_DIFF_FAIL=0.03
LAYOUT_SHIFT_PX=8
VIEWPORT_WIDTH=1280
VIEWPORT_HEIGHT=720
MAX_REPAIR_ATTEMPTS=3
```

## Store changes (`store/memory.js`)

- `scan.projectRules` — extracted conventions
- `scan.baselineDir` — baseline screenshot path
- `scan.appProcess` — child process handle (for restart)
- `fix.compliance` — `{ lint, format, tsc, repairAttempts }`
- `fix.visual` — `{ diffRatio, layoutShift, evidencePaths }`

## API changes

- `GET /api/fixes/:fixId` — response gains `compliance` and `visual` objects
- `GET /api/scans/:scanId` — gains `rulesExtracted: true/false`
- No breaking changes to existing endpoints

## Risks / notes

- **Flaky screenshots**: animations/hover states/fonts loading late. Mitigated by animation-disable CSS + networkidle + settle delay. Fonts: `document.fonts.ready` await.
- **eslint not installed in target repo**: `npx eslint` would try to download it — detect absence via `package.json` devDependencies and skip gracefully (style-consistency fallback).
- **tsc full-project check is slow**: use the build gate (already there) as the type check; per-file tsc only as a fast pre-check.
- **Full-page screenshots on long pages**: cap at 2× viewport height for diff speed, or diff in slices. Start with fullPage — fine for the demo repo.
