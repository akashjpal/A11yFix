import { exec } from 'child_process';
import { promisify } from 'util';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const execAsync = promisify(exec);

export async function runBuild(repoPath) {
  try {
    const { stdout, stderr } = await execAsync('npm run build', {
      cwd: repoPath,
      timeout: 60000,
      maxBuffer: 1024 * 1024 * 10
    });
    return { success: true, stdout, stderr };
  } catch (err) {
    return { success: false, error: err.message, stdout: err.stdout, stderr: err.stderr };
  }
}

/**
 * Verify a fix against the running app.
 *
 * Answers the REAL question — "is THIS specific issue gone?" — not just
 * "did the total violation count change". Checks:
 *   1. The specific rule no longer fires on the target element
 *   2. No NEW violations of the same rule appeared elsewhere
 *   3. Total violation count across all rules
 */
export async function rerunAxe(repoPath, appUrl, routes, targetIssue = null) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const result = {
    violationCount: 0,
    targetFixed: null,      // true = the specific issue is gone
    targetStillPresent: [], // the original element still violates the rule
    newViolations: [],      // same rule violating on OTHER elements (possible regressions)
    perRule: {}             // ruleId -> count, for the PR body
  };

  for (const route of routes) {
    const url = route.startsWith('http') ? route : `${appUrl}${route}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1000);
      const results = await new AxeBuilder({ page }).analyze();

      for (const violation of results.violations) {
        result.violationCount += violation.nodes.length;
        result.perRule[violation.id] = (result.perRule[violation.id] || 0) + violation.nodes.length;

        // Is this the rule we were fixing?
        if (targetIssue && violation.id === targetIssue.ruleId) {
          for (const node of violation.nodes) {
            const nodeHtml = (node.html || '').trim();
            const originalHtml = (targetIssue.htmlSnippet || '').trim();
            if (nodeHtml === originalHtml) {
              // The EXACT element that had the issue still violates it
              result.targetStillPresent.push(nodeHtml.slice(0, 120));
            } else {
              // Same rule, different element — flag as possible regression
              result.newViolations.push({ rule: violation.id, html: nodeHtml.slice(0, 120) });
            }
          }
        }
      }
    } catch (err) {
      console.error(`[verifier] Error scanning ${url}:`, err.message);
    }
  }

  if (targetIssue) {
    // Fixed = the rule no longer fires on the original element
    result.targetFixed = result.targetStillPresent.length === 0;
  }

  await browser.close();
  return result;
}
