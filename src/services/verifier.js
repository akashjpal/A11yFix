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

export async function rerunAxe(repoPath, appUrl, routes) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  let violationCount = 0;

  for (const route of routes) {
    const url = route.startsWith('http') ? route : `${appUrl}${route}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1000);
      const results = await new AxeBuilder({ page }).analyze();
      violationCount += results.violations.length;
    } catch {}
  }

  await browser.close();
  return { violationCount };
}
