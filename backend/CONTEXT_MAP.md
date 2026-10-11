# A11yFix — Context Map

> Single source of truth for the A11yFix backend architecture, packages, runtime, and API surface.
> Referenced from `AGENTS.md`. Keep this file updated when architecture or endpoints change.
> Future work is tracked in `ENHANCEMENT_PLAN.md` (project-rules compliance + visual testing).

---

## 1. What A11yFix Is

A11yFix is an AI-powered accessibility repair tool for GitHub repositories. The backend:

1. **Clones & runs** a (team-controlled) React/Vite demo repository.
2. **Scans** its routes with Playwright + axe-core to collect real WCAG violations.
3. **Generates minimal code patches** for a selected issue using the Ling 3.0 Flash model via **OpenRouter**.
4. **Applies the patch** on a dedicated Git branch, **verifies it against a restarted app** (build + targeted axe re-scan with a pass/fail gate), and **opens a GitHub Pull Request** — directly if the token has push access, otherwise via a **fork under the bot account** (Dependabot-style).

The frontend is a separate concern (teammate's responsibility). The backend exposes a JSON REST API and never returns patch contents or secrets to the client.

---

## 2. Architecture

```
                        ┌──────────────────────────────────────────────┐
                        │                 Express App                  │
                        │                src/server.js                 │
                        └──────┬───────────────────────┬───────────────┘
                               │                       │
              /api/scans/*     │                       │  /api/fixes/*
                               ▼                       ▼
                    ┌──────────────────┐    ┌──────────────────┐
                    │  routes/scans.js │    │  routes/fixes.js │
                    │  (fire-and-forget│    │  (fix + PR flow, │
                    │   runScanJob)    │    │   verification   │
                    └────────┬─────────┘    │   gate)          │
                             │              └────────┬─────────┘
                             ▼                       │
                    ┌──────────────────┐            │
                    │  jobs/runner.js  │            │
                    │  clone→install→  │            │
                    │  start→SCAN→     │            │
                    │  completed       │            │
                    └────────┬─────────┘            │
                             │                      │
        ┌────────────────────┼──────────────────────┼─────────────────────┐
        ▼                    ▼                      ▼                     ▼
┌───────────────┐   ┌────────────────┐   ┌────────────────────┐   ┌────────────────┐
│ repoManager   │   │    scanner     │   │      aiFix         │   │ gitService +   │
│ clone/install │   │ Playwright +   │   │ OpenRouter         │   │ githubService  │
│ /start/RESTART│   │ axe-core       │   │ (ling-3.0-flash)   │   │ branch/commit/ │
│ app, kill tree│   │                │   │ + repoStyle-aware │   │ push (fork or  │
└───────────────┘   └────────────────┘   └────────────────────┘   │ origin) + PR   │
                             │                       │             └────────────────┘
                             ▼                       ▼                     │
                    ┌────────────────┐   ┌────────────────────┐            ▼
                    │ patchValidator │   │     verifier       │   ┌────────────────┐
                    │ syntax + scope │   │ build + targeted   │   │  store/memory  │
                    │                │   │ axe re-scan +      │   │ in-memory Maps │
                    │                │   │ targetFixed GATE   │   │ (scan.appProcess│
                    └────────────────┘   └────────────────────┘   │  handle kept)  │
                                                                  └────────────────┘
```

### Workflow state machine (scan)

```
queued → cloning → installing → starting → scanning → completed
                                            └────────→ failed
```

**Invariant (race-condition fix):** the axe scan runs INSIDE `runScanJob` *before* the
`completed` status is set. When the API reports `completed`, issues are guaranteed present.

### Workflow state machine (fix)

```
generating → generated → applying → completed (PR created)
     │                        │
     └──→ failed              └──→ failed (build failed / verification gate / PR error)
```

PR creation requires the fix to be in `generated` status (explicit user approval step).

### PR-step pipeline (routes/fixes.js)

```
applyPatch → runBuild → restartApp (kill tree + fresh port) → rerunAxe (targeted)
    → GATE: targetFixed === false ? 422, no PR : commit → push → createPR
```

Push target selection: `hasPushAccess()` → push to `origin`; otherwise fork under the
bot account (`ensureFork` + `waitForFork`) and force-push to a dedicated `a11yfix-fork`
remote with the token embedded in the URL. PR head is `botLogin:branch` against upstream.
Retries are idempotent: force-push overwrites stale branches; an existing open PR is
returned with `status: "existing"` instead of erroring.

---

## 3. File Structure

```
HackoctoverFest/
├── package.json                  # type: module; scripts: start, dev
├── .env.example                  # template for required env vars
├── .gitignore                    # node_modules/, tmp/, .env
├── CONTEXT_MAP.md                # this file
├── AGENTS.md                     # agent instructions (references this file)
├── ENHANCEMENT_PLAN.md           # planned: rules compliance + visual testing
├── scripts/
│   └── test-api.mjs              # end-to-end API test (health→scan→fix→PR in one go)
├── tmp/                          # per-scan clones (gitignored)
└── src/
    ├── index.js                  # entry point: dotenv + http server on PORT
    ├── server.js                 # Express app: JSON body, route wiring, /api/health
    ├── routes/
    │   ├── scans.js              # POST /api/scans, GET scan/issue endpoints
    │   └── fixes.js              # GET fix status, POST pull-request (apply→build→
    │                             #   restart→verify GATE→commit→push→PR)
    ├── jobs/
    │   └── runner.js             # background scan pipeline (clone→install→start→
    │                             #   axe scan→completed; stores appProcess handle)
    ├── services/
    │   ├── repoManager.js        # URL validation, clone, framework detect, npm install,
    │   │                         #   start dev server, killProcessTree, restartApp
    │   ├── scanner.js            # Playwright navigation + axe-core violation collection
    │   ├── aiFix.js              # OpenRouter prompt + API call → { summary, filePath,
    │   │                         #   newContent }; requires a11yfix: <issueId> comment
    │   ├── repoStyle.js          # heuristic repo convention analysis (indent, quotes,
    │   │                         #   semicolons, component style, CSS approach) →
    │   │                         #   style-guide string injected into fix prompt
    │   ├── patchValidator.js     # syntax/scope validation + file write (applyPatch)
    │   ├── gitService.js         # branch create, commit, push to origin OR fork remote
    │   ├── githubService.js      # hasPushAccess, ensureFork, waitForFork, PR creation
    │   │                         #   (direct or fork-based, idempotent on retry)
    │   └── verifier.js           # npm run build + targeted axe re-scan (targetFixed,
    │                             #   newViolations, perRule)
    ├── store/
    │   └── memory.js             # in-memory Maps: scans, issues, fixes + status helpers
    └── utils/
        └── ids.js                # uid(prefix) — unique ID generator
```

---

## 4. Packages

| Package | Purpose |
|---|---|
| `express` | HTTP API server |
| `dotenv` | Load `.env` (PORT, API keys, demo repo URL, routes) |
| `playwright` | Headless Chromium to render the target app |
| `@axe-core/playwright` | `AxeBuilder` — WCAG violation detection on rendered pages |
| `simple-git` | Clone, branch, commit, push |
| `@octokit/rest` | GitHub REST API — Pull Request creation |

Runtime requirements: **Node.js 18+** (uses global `fetch`), **git** on PATH, and Playwright browsers (`npx playwright install chromium` if not already installed).

---

## 5. How to Run

```powershell
# 1. Install dependencies
npm install

# 2. (First time only) Install Playwright's Chromium
npx playwright install chromium

# 3. Configure environment
Copy-Item .env.example .env
#    then fill in: OPENROUTER_API_KEY, GITHUB_TOKEN, DEMO_REPO_URL, ROUTES

# 4. Start the backend
npm start          # or: npm run dev  (watch mode)

# 5. Verify
curl.exe http://localhost:3000/api/health
# → {"status":"ok","timestamp":"..."}

# 6. (Optional) Run the full pipeline end-to-end in one command
node scripts/test-api.mjs
#    flags: --repo <url> | --issue-index N | --skip-scan --scan-id X --issue-id Y
```

### Environment variables

| Variable | Required for | Description |
|---|---|---|
| `PORT` | server | Default `3000` |
| `OPENROUTER_API_KEY` | AI fixes | OpenRouter API key (https://openrouter.ai) |
| `OPENROUTER_MODEL` | AI fixes | Default `inclusionai/ling-3.0-flash` (paid tier) |
| `GITHUB_TOKEN` | PR creation | Bot-account token; push access optional — fork flow handles read-only tokens |
| `DEMO_REPO_URL` | scans | Team-controlled React/Vite demo repository |
| `ROUTES` | scans | Comma-separated routes to scan, e.g. `/,/contact,/products` |

---

## 6. API Endpoints

Base URL: `http://localhost:3000`

| Method | Endpoint | Purpose | Success | Errors |
|---|---|---|---|---|
| `GET` | `/api/health` | Liveness check | `200` `{ status, timestamp }` | — |
| `POST` | `/api/scans` | Start scanning a repository | `202` `{ scanId, status: "queued" }` | `400` missing repoUrl, `500` |
| `GET` | `/api/scans/:scanId` | Scan progress/status | `200` `{ scanId, status, progress, repoUrl, appUrl, error }` | `404` |
| `GET` | `/api/scans/:scanId/issues` | All accessibility findings | `200` `{ issues[], count }` | `404` |
| `GET` | `/api/scans/:scanId/issues/:issueId` | One finding | `200` issue object | `404` |
| `POST` | `/api/scans/:scanId/issues/:issueId/fixes` | Generate an AI fix | `202` `{ fixId, status: "generating" }` | `404`, `500` |
| `GET` | `/api/fixes/:fixId` | Fix status + summary | `200` `{ fixId, status, summary, filePath, error }` | `404` |
| `POST` | `/api/fixes/:fixId/pull-request` | Apply fix, build, restart app, verify (gate), create PR | `200` `{ fixId, status: "completed", prUrl, verification }` | `404`, `409` (not generated), `422` (verification failed — issue not fixed), `500` |

### PR response `verification` object

```json
{
  "violationCount": 3,          // total remaining violations (all rules, all routes)
  "targetFixed": true,          // ← the specific issue is gone (PR gate)
  "targetStillPresent": [],     // original element still violating (empty = fixed)
  "newViolations": [],          // same rule on OTHER elements (pre-existing, not regressions)
  "perRule": { "color-contrast": 3 }
}
```

If `targetFixed === false`, the API returns `422` and no PR is created — the fix is
marked `failed` with the verification details attached.

### Example flow

```powershell
# Start a scan
curl.exe -X POST http://localhost:3000/api/scans `
  -H "Content-Type: application/json" `
  -d '{\"repoUrl\":\"https://github.com/your-org/demo-repo.git\"}'
# → {"scanId":"scan_...","status":"queued"}

# Poll until completed
curl.exe http://localhost:3000/api/scans/scan_...

# List findings
curl.exe http://localhost:3000/api/scans/scan_.../issues

# Generate a fix for one issue
curl.exe -X POST http://localhost:3000/api/scans/scan_.../issues/issue_.../fixes
# → {"fixId":"fix_...","status":"generating"}

# Poll fix status
curl.exe http://localhost:3000/api/fixes/fix_...

# Approve → apply patch + create PR
curl.exe -X POST http://localhost:3000/api/fixes/fix_.../pull-request
# → {"prUrl":"https://github.com/...","verification":{...}}
```

### Issue object shape (returned by the scan)

```json
{
  "issueId": "issue_color-contrast_...",
  "ruleId": "color-contrast",
  "description": "Elements must have sufficient color contrast",
  "impact": "serious",
  "wcagTags": ["wcag2a", "wcag143"],
  "page": "http://localhost:5173/",
  "htmlSnippet": "<div class=\"hero\">...</div>",
  "target": [".hero"],
  "helpUrl": "https://dequeuniversity.com/rules/axe/..."
}
```

---

## 7. Design Decisions & Constraints (MVP)

- **In-memory storage** — no database; all state lives in `Map`s and is lost on restart.
- **Polling, not WebSockets** — long operations return an ID immediately (`202`); clients poll the status endpoints.
- **Full-file patches** — the model returns the complete corrected file (safer to validate than diffs for the MVP). Each fix MUST include a traceability comment `a11yfix: <issueId> (<ruleId>)` next to the changed code, in the file's native comment syntax; the commit message also carries `[<issueId>]`.
- **Manual DOM→source mapping** — axe-core finds DOM elements, not source files; `resolveSourceFile` in `routes/scans.js` walks the repo (skipping node_modules/dist/build/.git), extracts src/href/text from the axe `htmlSnippet`, and greps for matches. `issue.filePath` overrides the heuristic.
- **Controlled repos only** — only the team's demo repository is cloned/run. Never run arbitrary public repositories (dependency install scripts execute arbitrary code).
- **Secrets stay server-side** — `OPENROUTER_API_KEY` and `GITHUB_TOKEN` are read from `.env` only; the API never returns patch contents or credentials.
- **Verification before PR (gate)** — the app is RESTARTED after the patch (Vite serves stale modules otherwise), then axe re-scans. The PR is only created if `targetFixed === true`.
- **Fork-based PR flow** — the bot token may be read-only on the target repo. In that case the fix branch is force-pushed to a fork under the bot account and the PR is opened with `head: "bot:branch"` against the upstream repo (Dependabot-style). Push access is detected via `repos.get` permissions.
- **Scan/complete invariant** — the axe scan runs inside `runScanJob` before `completed` is set; pollers never see `completed` with missing issues.

## 8. Known Gaps / Next Steps

See `ENHANCEMENT_PLAN.md` for the full plan. Summary:

- ~~`verifier.rerunAxe` needs the app URL of the *patched* build~~ — DONE (restartApp + targeted verification gate).
- ~~Dev-server processes are not tracked~~ — DONE (`scan.appProcess` handle + `killProcessTree`).
- Project-rules compliance (eslint/prettier-aware prompts, SEARCH/REPLACE patches, lint gate, repair loop) — planned (Phases 1–3).
- Visual testing (baseline screenshots, pixelmatch diff, layout-shift check) — planned (Phases 4–5).
- `tmp/` working directories are not auto-cleaned after scans.
- No automated tests yet; end-to-end verification is via `node scripts/test-api.mjs`.
