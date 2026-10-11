import { Router } from 'express';
import { getFix, getScan, getIssue, updateFixStatus } from '../store/memory.js';
import { runVisualTest } from '../services/visualTest.js';
import { generateTests, writeTestFile, runTests } from '../services/testGen.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const router = Router();

// Derive CSS selectors for the fixed elements from the issue's axe target
function targetSelectorsFor(issue) {
  if (!issue?.target?.length) return [];
  // axe targets are like [".nav-link.active[aria-current=\"page\"]"] — usable
  // directly as Playwright CSS selectors in most cases
  return issue.target.slice(0, 3);
}

// POST /api/fixes/:fixId/visual-test — before/after screenshots + diff + layout check
router.post('/:fixId/visual-test', async (req, res) => {
  const { fixId } = req.params;
  try {
    const fix = getFix(fixId);
    if (!fix) return res.status(404).json({ error: 'Fix not found' });

    const scan = getScan(fix.scanId);
    if (!scan?.appUrl) return res.status(409).json({ error: 'Scan has no running app — run a scan first' });

    const issue = getIssue(fix.scanId, fix.issueId);
    const selectors = targetSelectorsFor(issue);

    const result = await runVisualTest(fix, scan, selectors, scan.appUrl);

    // Persist result on the fix record
    updateFixStatus(fixId, fix.status, { visual: result });

    res.json({ fixId, visual: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fixes/:fixId/visual-test — retrieve the last visual test result (no re-run)
router.get('/:fixId/visual-test', (req, res) => {
  const { fixId } = req.params;
  const fix = getFix(fixId);
  if (!fix) return res.status(404).json({ error: 'Fix not found' });

  const visual = fix.visual || null;
  res.json({ fixId, visual });
});

// POST /api/fixes/:fixId/tests/generate — AI writes Playwright tests for the changed section
router.post('/:fixId/tests/generate', async (req, res) => {
  const { fixId } = req.params;
  try {
    const fix = getFix(fixId);
    if (!fix) return res.status(404).json({ error: 'Fix not found' });
    if (!fix.newContent) return res.status(409).json({ error: 'Fix has no generated content yet' });

    const issue = getIssue(fix.scanId, fix.issueId);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const scan = getScan(fix.scanId);
    if (!scan?.appUrl) return res.status(409).json({ error: 'Scan has no running app' });

    // Original file content = current file BEFORE this fix's content is applied.
    // If the fix was already applied (PR flow ran), the original is gone from the
    // working tree — so we reconstruct from git (the branch was created from main).
    let originalCode = '';
    try {
      originalCode = readFileSync(join(fix.repoPath, fix.filePath), 'utf-8');
    } catch {
      originalCode = '// original content unavailable';
    }

    const testCode = await generateTests(
      issue, originalCode, fix.newContent, fix.filePath, scan.appUrl, fix.routes || ['/']
    );

    const testFile = writeTestFile(fix.repoPath, fixId, testCode);

    updateFixStatus(fixId, fix.status, { testFile, testCode });

    res.json({
      fixId,
      testFile,
      testCode,
      message: 'Tests generated. POST /api/fixes/:fixId/tests/run to execute them.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/fixes/:fixId/tests/run — execute the generated tests
router.post('/:fixId/tests/run', async (req, res) => {
  const { fixId } = req.params;
  try {
    const fix = getFix(fixId);
    if (!fix) return res.status(404).json({ error: 'Fix not found' });
    if (!fix.testFile) return res.status(409).json({ error: 'No tests generated yet — call /tests/generate first' });

    const scan = getScan(fix.scanId);
    if (!scan?.appUrl) return res.status(409).json({ error: 'Scan has no running app' });

    const result = await runTests(fix.repoPath, fix.testFile, scan.appUrl);

    updateFixStatus(fixId, fix.status, {
      testResult: { success: result.success, ranAt: new Date().toISOString() }
    });

    res.json({
      fixId,
      passed: result.success,
      output: result.stdout || result.stderr
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
export { router };
