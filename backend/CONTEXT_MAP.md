# A11yFix — Context Map

> Single source of truth for the A11yFix backend architecture, packages, runtime, and API surface.
> Referenced from `AGENTS.md`. Keep this file updated when architecture or endpoints change.

---

## 1. What A11yFix Is

A11yFix is an AI-powered accessibility repair tool for GitHub repositories. The backend:

1. **Clones & runs** a (team-controlled) React/Vite demo repository.
2. **Scans** its routes with Playwright + axe-core to collect real WCAG violations.
3. **Generates minimal code patches** for a selected issue using the Gemma model (Google AI API).
4. **Applies the approved patch** on a dedicated Git branch, verifies it (build + axe re-scan), and **opens a GitHub Pull Request**.

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
                    └────────┬─────────┘    └────────┬─────────┘
                             │                       │
                             ▼                       ▼
                    ┌──────────────────┐    ┌──────────────────┐
                    │  jobs/runner.js  │    │  (inline async   │
                    │  (scan pipeline) │    │   fix/PR jobs)   │
                    └────────┬─────────┘    └────────┬─────────┘
                             │                       │
        ┌────────────────────┼───────────────────────┼─────────────────────┐
        ▼                    ▼                       ▼                     ▼
┌───────────────┐   ┌────────────────┐   ┌────────────────────┐   ┌────────────────┐
│ repoManager   │   │    scanner     │   │      aiFix         │   │ gitService +   │
│ clone/install │   │ Playwright +   │   │ Gemma via Google   │   │ githubService  │
│ /start app    │   │ axe-core       │   │ AI API             │   │ branch/PR      │
└───────────────┘   └────────────────┘   └────────────────────┘   └────────────────┘
                             │                       │                     │
                             ▼                       ▼                     ▼
                    ┌────────────────┐   ┌────────────────────┐   ┌────────────────┐
                    │ patchValidator │   │     verifier       │   │  store/memory  │
                    │ syntax + scope │   │ build + axe re-run │   │ in-memory Maps │
                    └────────────────┘   └────────────────────┘   └────────────────┘
```

### Workflow state machine (scan)

```
queued → cloning → installing → starting → scanning → completed
                                            └────────→ failed
```

### Workflow state machine (fix)

```
generating → generated → applying → completed (PR created)
     │                        │
     └──→ failed              └──→ failed (build/PR error)
```

PR creation requires the fix to be in `generated` status (explicit user approval step).

---

## 3. File Structure

```
HackoctoverFest/
├── package.json                  # type: module; scripts: start, dev
├── .env.example                  # template for required env vars
├── .gitignore                    # node_modules/, tmp/, .env
├── CONTEXT_MAP.md                # this file
├── AGENTS.md                     # agent instructions (references this file)
└── src/
    ├── index.js                  # entry point: dotenv + http server on PORT
    ├── server.js                 # Express app: JSON body, route wiring, /api/health
    ├── routes/
    │   ├── scans.js              # POST /api/scans, GET scan/issue endpoints
    │   └── fixes.js              # POST fixes, GET fix status, POST pull-request
    ├── jobs/
    │   └── runner.js             # background scan pipeline (clone→install→start)
    ├── services/
    │   ├── repoManager.js        # URL validation, clone, framework detect, npm install, start dev server
    │   ├── scanner.js            # Playwright navigation + axe-core violation collection
    │   ├── aiFix.js              # Gemma prompt + API call → { summary, filePath, newContent }
    │   ├── patchValidator.js     # syntax/scope validation + file write (applyPatch)
    │   ├── gitService.js         # branch create, commit, push (simple-git)
    │   ├── githubService.js      # PR creation via @octokit/rest
    │   └── verifier.js           # npm run build + axe re-scan comparison
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
#    then fill in: GEMINI_API_KEY, GITHUB_TOKEN, DEMO_REPO_URL, ROUTES

# 4. Start the backend
npm start          # or: npm run dev  (watch mode)

# 5. Verify
curl.exe http://localhost:3000/api/health
# → {"status":"ok","timestamp":"..."}
```

### Environment variables

| Variable | Required for | Description |
|---|---|---|
| `PORT` | server | Default `3000` |
| `GEMINI_API_KEY` | AI fixes | Google AI Studio key for the Gemma model |
| `GITHUB_TOKEN` | PR creation | Token with push access to the demo repo |
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
| `POST` | `/api/fixes/:fixId/pull-request` | Apply approved fix, create PR | `200` `{ fixId, status: "completed", prUrl, verification }` | `404`, `409` (not approved/generated), `500` |

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
- **Full-file patches** — Gemma returns the complete corrected file (safer to validate than diffs for the MVP).
- **Manual DOM→source mapping** — axe-core finds DOM elements, not source files; for the demo, the source file is mapped manually (`issue.filePath` or fallback `src/App.jsx`).
- **Controlled repos only** — only the team's demo repository is cloned/run. Never run arbitrary public repositories (dependency install scripts execute arbitrary code).
- **Secrets stay server-side** — `GEMINI_API_KEY` and `GITHUB_TOKEN` are read from `.env` only; the API never returns patch contents or credentials.
- **Verification before PR** — `npm run build` must pass; axe re-scan results are attached to the PR response.

## 8. Known Gaps / Next Steps

- `tmp/` working directories are not auto-cleaned after scans.
- Dev-server processes started by `repoManager.startApp` are not tracked/killed on scan completion.
- `verifier.rerunAxe` needs the app URL of the *patched* build (currently reuses the scan's app URL).
- No automated tests yet; end-to-end verification is manual via the example flow above.
