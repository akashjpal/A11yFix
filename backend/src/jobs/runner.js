import { updateScanStatus, getScan, addIssue } from '../store/memory.js';
import { cloneRepo, installDeps, startApp, stopApp } from '../services/repoManager.js';
import { scanDemoApp } from '../services/scanner.js';

// Background job runner for scan workflow
export async function runScanJob(scanId, repoUrl, routes) {
  try {
    updateScanStatus(scanId, 'cloning', 10);
    const repoPath = await cloneRepo(repoUrl, scanId);

    updateScanStatus(scanId, 'installing', 30);
    await installDeps(repoPath);

    updateScanStatus(scanId, 'starting', 50);
    const appUrl = await startApp(repoPath, scanId);

    updateScanStatus(scanId, 'scanning', 70);

    // Run the axe scan BEFORE marking completed — otherwise API consumers
    // polling for 'completed' would fetch issues before they exist (race)
    const findings = await scanDemoApp(appUrl.url, routes);
    for (const finding of findings) {
      addIssue(scanId, finding);
    }
    console.log(`[runner] Scan ${scanId}: found ${findings.length} issue(s)`);

    const scan = getScan(scanId);
    if (scan) {
      scan.appUrl = appUrl.url; // store the URL string, not the process object
      scan.repoPath = repoPath;
      scan.appProcess = appUrl.process; // keep handle so the PR step can restart the app
      scan.appPort = appUrl.port;
    }

    updateScanStatus(scanId, 'completed', 100);
  } catch (err) {
    updateScanStatus(scanId, 'failed', 0);
    const scan = getScan(scanId);
    if (scan) scan.error = err.message;
  }
}
