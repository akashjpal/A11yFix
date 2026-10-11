import { Router } from 'express';
import { setFix, getFix, updateFixStatus, getScan, getIssue } from '../store/memory.js';
import { getOrCreateFixBranch, commitAndPush } from '../services/gitService.js';
import { createPullRequest, hasPushAccess, ensureFork, waitForFork } from '../services/githubService.js';
import { runBuild, rerunAxe } from '../services/verifier.js';
import { applyPatch } from '../services/patchValidator.js';
import { restartApp } from '../services/repoManager.js';

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

    // CRITICAL: restart the app so verification tests the NEW code.
    // Vite serves stale modules until the dev server is restarted.
    const scan = getScan(fix.scanId);
    let appUrl = fix.appUrl;
    if (scan?.appProcess) {
      const restarted = await restartApp(fix.repoPath, fix.scanId, scan.appProcess);
      appUrl = restarted.url;
      scan.appProcess = restarted.process;
      scan.appUrl = restarted.url;
      scan.appPort = restarted.port;
    } else {
      console.warn('[fixes] No app process handle on scan — verifying against existing server (may be stale)');
    }

    // Verify the fix against the RESTARTED app — pass the original issue so
    // we can check the SPECIFIC element is fixed, not just the total count
    const issue = getIssue(fix.scanId, fix.issueId);
    const verification = await rerunAxe(fix.repoPath, appUrl, fix.routes || [], issue);

    // GATE: do not create a PR if the fix didn't actually work
    if (issue && verification.targetFixed === false) {
      updateFixStatus(fixId, 'failed', {
        error: 'Verification failed — the issue is still present after the fix',
        verification
      });
      return res.status(422).json({
        error: 'Fix did not resolve the issue — PR not created',
        verification
      });
    }

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

    await commitAndPush(fix.repoPath, branchName, `fix: ${fix.summary} [${fix.issueId}]`, fork);

    // Create PR (base branch auto-detected; head comes from fork if read-only token)
    const pr = await createPullRequest({
      owner,
      repo,
      headBranch: branchName,
      title: fix.summary,
      body: `Automated accessibility fix.

Rule: ${fix.ruleId}
Issue: ${fix.issueId}

## Verification (axe re-scan after fix)
- ${verification.targetFixed === true ? '✅ Target issue resolved' : '⚠️ Target issue not individually tracked'}
- Remaining violations (all rules): ${verification.violationCount}
${Object.entries(verification.perRule || {}).map(([r, c]) => `- ${r}: ${c}`).join('\n')}
${verification.newViolations?.length ? `\n⚠️ Same rule still fires on other elements (pre-existing, not introduced by this fix):\n${verification.newViolations.map(v => `- ${v.html}`).join('\n')}` : ''}`
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




