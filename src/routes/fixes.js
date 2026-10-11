import { Router } from 'express';
import { join } from 'path';
import { setFix, getFix, updateFixStatus, getScan, getIssue } from '../store/memory.js';
import { generateFix } from '../services/aiFix.js';
import { validatePatch, applyPatch } from '../services/patchValidator.js';
import { getOrCreateFixBranch, commitAndPush } from '../services/gitService.js';
import { createPullRequest } from '../services/githubService.js';
import { runBuild, rerunAxe } from '../services/verifier.js';
import { uid } from '../utils/ids.js';

const router = Router();

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
      status: 'generating',
      summary: null,
      filePath: null,
      newContent: null,
      createdAt: new Date().toISOString()
    };
    setFix(fixId, fixRecord);

    // Background job for AI fix generation
    (async () => {
      try {
        updateFixStatus(fixId, 'generating');

        // For MVP: use a manual source file mapping
        const sourceFile = issue.filePath || 'src/App.jsx';
        let sourceCode = '';
        try {
          const { readFileSync } = await import('fs');
          sourceCode = readFileSync(join(scan.repoPath, sourceFile), 'utf-8');
        } catch {
          sourceCode = '// Source file not found for demo';
        }

        const result = await generateFix(issue, sourceCode, sourceFile);

        // Validate the patch
        const validation = validatePatch({ ...result, repoPath: scan.repoPath, filePath: sourceFile });
        if (!validation.valid) {
          updateFixStatus(fixId, 'failed', { error: validation.errors.join(', ') });
          return;
        }

        fixRecord.status = 'generated';
        fixRecord.summary = result.summary;
        fixRecord.filePath = sourceFile;
        fixRecord.newContent = result.newContent;
        setFix(fixId, fixRecord);
      } catch (err) {
        updateFixStatus(fixId, 'failed', { error: err.message });
      }
    })();

    res.status(202).json({ fixId, status: 'generating', message: 'AI fix generation started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fixes/:fixId — Check fix status
router.get('/:fixId', (req, res) => {
  const fix = getFix(req.params.fixId);
  if (!fix) {
    return res.status(404).json({ error: 'Fix not found' });
  }
  res.json({
    fixId: fix.fixId,
    status: fix.status,
    summary: fix.summary,
    filePath: fix.filePath,
    error: fix.error,
    createdAt: fix.createdAt
  });
});

// POST /api/fixes/:fixId/pull-request — Apply the approved fix and create a PR
router.post('/:fixId/pull-request', async (req, res) => {
  try {
    const { fixId } = req.params;
    const fix = getFix(fixId);
    if (!fix) {
      return res.status(404).json({ error: 'Fix not found' });
    }
    if (fix.status !== 'generated') {
      return res.status(409).json({ error: `Fix must be in 'generated' status, current: ${fix.status}` });
    }

    updateFixStatus(fixId, 'applying');

    // Apply the patch
    await applyPatch(fix);

    // Run build verification
    const buildResult = await runBuild(fix.repoPath);
    if (!buildResult.success) {
      updateFixStatus(fixId, 'failed', { error: 'Build failed after applying patch', details: buildResult.error });
      return res.status(500).json({ error: 'Build verification failed' });
    }

    // Optional: rerun axe to verify the fix
    const verification = await rerunAxe(fix.repoPath, fix.appUrl, fix.routes || []);

    // Create branch and commit
    const branchName = `a11yfix/${fix.ruleId}-${fix.issueId}`;
    await getOrCreateFixBranch(fix.repoPath, fix.issueId, fix.ruleId);
    await commitAndPush(fix.repoPath, branchName, `fix: ${fix.summary}`);

    // Create PR
    const { owner, repo } = parseRepoUrl(fix.repoUrl);
    const pr = await createPullRequest({
      owner,
      repo,
      headBranch: branchName,
      baseBranch: 'main',
      title: fix.summary,
      body: `Automated accessibility fix.\n\nRule: ${fix.ruleId}\nIssue: ${fix.issueId}\nVerification: ${verification.violationCount} remaining violations`
    });

    updateFixStatus(fixId, 'completed', { prUrl: pr.prUrl, verification });

    res.json({
      fixId,
      status: 'completed',
      prUrl: pr.prUrl,
      verification
    });
  } catch (err) {
    updateFixStatus(fixId, 'failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

function parseRepoUrl(repoUrl) {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  return { owner: match?.[1], repo: match?.[2] };
}

export default router;
export { router };




