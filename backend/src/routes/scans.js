import { Router } from 'express';
import { join } from 'path';
import { readFileSync, readdirSync } from 'fs';
import { runScanJob } from '../jobs/runner.js';
import { createScan, updateScanStatus, getScan, getIssue, setFix, updateFixStatus } from '../store/memory.js';
import { scanDemoApp } from '../services/scanner.js';
import { generateFix } from '../services/aiFix.js';
import { analyzeRepoStyle } from '../services/repoStyle.js';
import { validatePatch } from '../services/patchValidator.js';
import { uid } from '../utils/ids.js';

const router = Router();

// POST /api/scans — Start scanning a repository
router.post('/', async (req, res) => {
  try {
    const { repoUrl, routes } = req.body;

    if (!repoUrl) {
      return res.status(400).json({ error: 'repoUrl is required' });
    }

    const scanId = uid('scan');
    const scanRoutes = routes || process.env.ROUTES?.split(',').map(r => r.trim()) || ['/'];

    const scan = createScan(scanId, { repoUrl, routes: scanRoutes, status: 'queued', progress: 0 });

    // Start background job — the axe scan runs INSIDE runScanJob, before the
    // 'completed' status is set, so pollers never see completed with 0 issues
    runScanJob(scanId, repoUrl, scanRoutes).catch(err => {
      updateScanStatus(scanId, 'failed', 0);
      const scanRecord = getScan(scanId);
      if (scanRecord) scanRecord.error = err.message;
    });

    res.status(202).json({ scanId, status: 'queued', message: 'Scan started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scans/:scanId — Check scan progress
router.get('/:scanId', (req, res) => {
  const scan = getScan(req.params.scanId);
  if (!scan) {
    return res.status(404).json({ error: 'Scan not found' });
  }
  res.json({
    scanId: scan.id,
    status: scan.status,
    progress: scan.progress,
    repoUrl: scan.repoUrl,
    appUrl: scan.appUrl,
    error: scan.error,
    createdAt: scan.createdAt
  });
});

// GET /api/scans/:scanId/issues — Retrieve all accessibility findings
router.get('/:scanId/issues', (req, res) => {
  const scan = getScan(req.params.scanId);
  if (!scan) {
    return res.status(404).json({ error: 'Scan not found' });
  }
  res.json({ issues: scan.issues, count: scan.issues.length });
});

// GET /api/scans/:scanId/issues/:issueId — Retrieve one issue
router.get('/:scanId/issues/:issueId', (req, res) => {
  const issue = getIssue(req.params.scanId, req.params.issueId);
  if (!issue) {
    return res.status(404).json({ error: 'Issue not found' });
  }
  res.json(issue);
});

// POST /api/scans/:scanId/issues/:issueId/fixes — Generate an AI fix
router.post('/:scanId/issues/:issueId/fixes', async (req, res) => {
  try {
    const { scanId, issueId } = req.params;
    const scan = getScan(scanId);
    if (!scan) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    const issue = getIssue(scanId, issueId);
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    const fixId = uid('fix');
    const fixRecord = {
      fixId,
      scanId,
      issueId,
      ruleId: issue.ruleId,
      status: 'generating',
      summary: null,
      filePath: null,
      newContent: null,
      // carry scan context so the PR step can use it
      repoPath: scan.repoPath,
      repoUrl: scan.repoUrl,
      appUrl: scan.appUrl,
      routes: scan.routes,
      createdAt: new Date().toISOString()
    };
    setFix(fixId, fixRecord);

    // Background job for AI fix generation
    (async () => {
      try {
        updateFixStatus(fixId, 'generating');

        // Resolve the source file: explicit mapping > heuristic search > fallback
        const sourceFile = issue.filePath || resolveSourceFile(scan.repoPath, issue);
        let sourceCode = '';
        try {
          const { readFileSync } = await import('fs');
          sourceCode = readFileSync(join(scan.repoPath, sourceFile), 'utf-8');
        } catch {
          sourceCode = '// Source file not found for demo';
        }

        // Repo coding-practice analysis — computed once per scan, reused by
        // every fix in this scan so the AI patches match the repo's own style
        if (!scan.styleGuide) {
          scan.styleGuide = analyzeRepoStyle(scan.repoPath);
        }

        const result = await generateFix(issue, sourceCode, sourceFile, scan.styleGuide);

        // Validate the patch
        const validation = validatePatch({ ...result, repoPath: scan.repoPath, filePath: sourceFile });
        if (!validation.valid) {
          updateFixStatus(fixId, 'failed', { error: validation.errors.join(', ') });
          return;
        }

        updateFixStatus(fixId, 'generated', {
          summary: result.summary,
          filePath: sourceFile,
          newContent: result.newContent
        });
      } catch (err) {
        updateFixStatus(fixId, 'failed', { error: err.message });
      }
    })();

    res.status(202).json({ fixId, status: 'generating', message: 'AI fix generation started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Heuristic: find the source file containing the flagged element.
// Uses distinctive parts of the axe HTML snippet (src attr, tag + text) to grep the repo.
function resolveSourceFile(repoPath, issue) {
  try {
    // Collect candidate source files
    const exts = ['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.html'];
    const skipDirs = ['node_modules', 'dist', 'build', '.git'];
    const files = [];
    (function walk(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!skipDirs.includes(entry.name)) walk(join(dir, entry.name));
        } else if (exts.some(ext => entry.name.endsWith(ext))) {
          files.push(join(dir, entry.name));
        }
      }
    })(repoPath);

    // Build search patterns from the HTML snippet
    const snippet = issue.htmlSnippet || '';
    const patterns = [];

    // src/href attribute values (e.g. /hacktoberfest-banner.png)
    const attrMatch = snippet.match(/(?:src|href)="([^"]+)"/);
    if (attrMatch) patterns.push(attrMatch[1]);

    // Visible text content (e.g. "Register Now", "Home")
    const textMatch = snippet.match(/>([^<>]+)</);
    if (textMatch && textMatch[1].trim().length > 2) patterns.push(textMatch[1].trim());

    for (const f of files) {
      const content = readFileSync(f, 'utf-8');
      if (patterns.some(p => content.includes(p))) {
        // Return path relative to the repo root, with forward slashes
        const normalized = f.replace(/\\/g, '/');
        const normalizedRoot = repoPath.replace(/\\/g, '/').replace(/\/$/, '');
        return normalized.startsWith(normalizedRoot + '/')
          ? normalized.slice(normalizedRoot.length + 1)
          : normalized;
      }
    }
  } catch (err) {
    console.error('resolveSourceFile error:', err.message);
  }
  return 'src/App.jsx';
}

export default router;
export { router };
