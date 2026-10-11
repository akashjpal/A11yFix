# AGENTS.md — A11yFix Backend

Instructions for AI coding agents working in this repository.

## Project Overview

A11yFix is an AI-powered accessibility repair tool for GitHub repositories. This workspace contains the **backend only**: an Express API that clones a controlled React/Vite demo repo, scans it with Playwright + axe-core, generates code patches with the Gemma model, and opens GitHub Pull Requests with verified fixes.

## Required Reading

**Before making any changes, read [`CONTEXT_MAP.md`](./CONTEXT_MAP.md)** — it is the single source of truth for:

- Architecture and module responsibilities (section 2)
- File structure (section 3)
- Packages and runtime requirements (section 4)
- How to run the project and required environment variables (section 5)
- Complete API endpoint reference with example requests (section 6)
- Design decisions, constraints, and known gaps (sections 7–8)

## Ground Rules for Agents

1. **Keep `CONTEXT_MAP.md` up to date.** If you change the architecture, add/remove endpoints, add packages, or alter the run instructions, update the corresponding section of `CONTEXT_MAP.md` in the same change.
2. **ES modules only.** `package.json` sets `"type": "module"` — use `import`/`export`, never `require`.
3. **In-memory storage.** All state lives in `src/store/memory.js` Maps. Do not introduce a database without updating the design decisions section.
4. **Secrets stay server-side.** Never return `GEMINI_API_KEY`, `GITHUB_TOKEN`, or patch contents (`newContent`) from any API response.
5. **Controlled repos only.** The backend must only clone/run the team's demo repository. Do not add support for executing arbitrary public repositories.
6. **Approval gate.** PR creation (`POST /api/fixes/:fixId/pull-request`) must only proceed when the fix is in `generated` status.
7. **Long operations are background jobs.** Return `202` with an ID immediately; expose progress via the status endpoints. Do not block requests on clone/install/scan/AI operations.
8. **Verify before committing.** Run `node --check` on changed files and confirm `import('./src/server.js')` loads cleanly before declaring work done.

## Common Commands

```powershell
npm install                        # install dependencies
npm start                          # start server (http://localhost:3000)
npm run dev                        # start with watch mode
node --check <file>                # syntax-check a file
curl.exe http://localhost:3000/api/health   # health check
```

## Tech Stack

Node.js (ES modules) · Express · Playwright · @axe-core/playwright · simple-git · @octokit/rest · Google AI API (Gemma model) · dotenv
