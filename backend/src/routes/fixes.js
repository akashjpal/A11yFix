import { Router } from 'express';
import { setFix, getFix, updateFixStatus } from '../store/memory.js';
import { getOrCreateFixBranch, commitAndPush } from '../services/gitService.js';
import { createPullRequest, hasPushAccess, ensureFork, waitForFork } from '../services/githubService.js';
import { runBuild, rerunAxe } from '../services/verifier.js';
import { applyPatch } from '../services/patchValidator.js';

const router = Router();

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
  const { fixId } = req.params;
  try {
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

    // Determine push target: upstream (if we have push access) or bot's fork
    const { owner, repo } = parseRepoUrl(fix.repoUrl);
    const canPush = await hasPushAccess(owner, repo);
    let fork = null;
    if (!canPush) {
      console.log(`[fixes] No push access to ${owner}/${repo} — forking under bot account`);
      fork = await ensureFork(owner, repo);
      await waitForFork(owner, repo);
    }

    await commitAndPush(fix.repoPath, branchName, `fix: ${fix.summary}`, fork);

    // Create PR (base branch auto-detected; head comes from fork if read-only token)
    const pr = await createPullRequest({
      owner,
      repo,
      headBranch: branchName,
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




