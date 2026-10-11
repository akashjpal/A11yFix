/**
 * A11yFix — end-to-end API test script
 * Runs the full pipeline in one go:
 *   health → scan (poll) → issues → generate fix (poll) → PR creation
 *
 * Usage:
 *   node scripts/test-api.mjs
 *   node scripts/test-api.mjs --repo https://github.com/akashjpal/Hackoctober-fest-sample-website.git
 *   node scripts/test-api.mjs --skip-scan --scan-id scan_xxx --issue-id issue_yyy   # reuse an existing scan
 */

const BASE = process.env.API_BASE || 'http://localhost:3000';
const REPO_URL = process.env.DEMO_REPO_URL || 'https://github.com/akashjpal/Hackoctober-fest-sample-website.git';

// ---- CLI args ----------------------------------------------------------
const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}
const skipScan = args.includes('--skip-scan');
const existingScanId = argValue('--scan-id');
const existingIssueId = argValue('--issue-id');
const issueIndex = parseInt(argValue('--issue-index') || '0', 10);

// ---- helpers ----------------------------------------------------------
const log = (step, msg) => console.log(`\n[${step}] ${msg}`);
const ok = (msg) => console.log(`  ✅ ${msg}`);
const warn = (msg) => console.log(`  ⚠️  ${msg}`);
const fail = (msg) => console.log(`  ❌ ${msg}`);

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function poll(path, { intervalMs = 3000, timeoutMs = 300000, doneStates, label }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { status, body } = await api(path);
    if (status === 404) throw new Error(`${label}: 404 — ${JSON.stringify(body)}`);
    const state = body.status;
    process.stdout.write(`  … ${label}: ${state} (${Math.round((Date.now() - start) / 1000)}s)\r`);
    if (doneStates.includes(state)) {
      process.stdout.write('\n');
      return body;
    }
    if (state === 'failed') {
      process.stdout.write('\n');
      throw new Error(`${label} failed: ${body.error || 'unknown error'}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`${label}: timed out after ${timeoutMs / 1000}s`);
}

// ---- pipeline ---------------------------------------------------------
async function main() {
  console.log('='.repeat(70));
  console.log('A11yFix API end-to-end test');
  console.log(`Base: ${BASE}`);
  console.log(`Repo: ${REPO_URL}`);
  console.log('='.repeat(70));

  // 1. Health
  log('1/6', 'Health check');
  const health = await api('/api/health');
  if (health.status !== 200) {
    fail(`Health check failed: ${health.status}`);
    process.exit(1);
  }
  ok(`Server is up: ${JSON.stringify(health.body)}`);

  // 2. Start scan (or reuse existing)
  let scanId, issueId;
  if (skipScan && existingScanId) {
    scanId = existingScanId;
    log('2/6', `Reusing existing scan ${scanId} (--skip-scan)`);
  } else {
    log('2/6', 'Starting scan (background job — cloning, installing, starting app, axe scan)');
    const start = await api('/api/scans', {
      method: 'POST',
      body: JSON.stringify({ repoUrl: REPO_URL })
    });
    if (start.status !== 202) {
      fail(`Scan start failed: ${start.status} ${JSON.stringify(start.body)}`);
      process.exit(1);
    }
    scanId = start.body.scanId;
    ok(`Scan started: ${scanId}`);
  }

  // 3. Poll scan until completed
  log('3/6', 'Polling scan status');
  const scan = await poll(`/api/scans/${scanId}`, {
    label: 'scan',
    doneStates: ['completed'],
    timeoutMs: 420000 // clone + npm install + dev server + axe can take a while
  });
  ok(`Scan completed — appUrl: ${scan.appUrl}`);

  // 4. Fetch issues
  log('4/6', 'Fetching issues');
  const issuesRes = await api(`/api/scans/${scanId}/issues`);
  const issues = issuesRes.body.issues || [];
  if (issues.length === 0) {
    warn('No accessibility issues found — nothing to fix. Pipeline ends here.');
    return;
  }
  ok(`Found ${issues.length} issue(s):`);
  issues.forEach((i, idx) =>
    console.log(`     [${idx}] ${i.ruleId} (${i.impact}) — ${i.issueId}`)
  );

  // Pick the issue to fix
  if (existingIssueId) {
    issueId = existingIssueId;
    console.log(`  Using issue from --issue-id: ${issueId}`);
  } else {
    const chosen = issues[issueIndex] || issues[0];
    issueId = chosen.issueId;
    console.log(`  Testing fix for issue [${issueIndex}]: ${chosen.ruleId} — ${issueId}`);
  }

  // 5. Generate AI fix
  log('5/6', 'Generating AI fix (OpenRouter)');
  const fixStart = await api(`/api/scans/${scanId}/issues/${issueId}/fixes`, { method: 'POST' });
  if (fixStart.status !== 202) {
    fail(`Fix generation failed to start: ${fixStart.status} ${JSON.stringify(fixStart.body)}`);
    process.exit(1);
  }
  const fixId = fixStart.body.fixId;
  ok(`Fix generation started: ${fixId}`);

  const fix = await poll(`/api/fixes/${fixId}`, {
    label: 'fix',
    doneStates: ['generated'],
    timeoutMs: 180000
  });
  ok(`Fix generated — file: ${fix.filePath}`);
  console.log(`  Summary: ${fix.summary}`);

  // 6. Create PR (apply → build → restart app → verify → commit → PR)
  log('6/6', 'Creating PR (apply patch, build, restart app, verify, push, PR)');
  const prRes = await api(`/api/fixes/${fixId}/pull-request`, { method: 'POST' });
  if (prRes.status !== 200) {
    fail(`PR creation failed: ${prRes.status} ${JSON.stringify(prRes.body)}`);
    process.exit(1);
  }
  ok(`PR created: ${prRes.body.prUrl}`);
  console.log(`  Verification: ${JSON.stringify(prRes.body.verification)}`);

  console.log('\n' + '='.repeat(70));
  console.log('🎉 FULL PIPELINE PASSED');
  console.log('='.repeat(70));
  console.log(`  scanId:  ${scanId}`);
  console.log(`  issueId: ${issueId}`);
  console.log(`  fixId:   ${fixId}`);
  console.log(`  PR:      ${prRes.body.prUrl}`);
}

main().catch(err => {
  fail(err.message);
  process.exit(1);
});
