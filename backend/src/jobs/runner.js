import { updateScanStatus } from '../store/memory.js';
import { cloneRepo, installDeps, startApp, stopApp } from '../services/repoManager.js';

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

    const scan = await import('../store/memory.js').then(m => m.getScan(scanId));
    if (scan) {
      scan.appUrl = appUrl.url; // store the URL string, not the process object
      scan.repoPath = repoPath;
    }

    updateScanStatus(scanId, 'completed', 100);
  } catch (err) {
    updateScanStatus(scanId, 'failed', 0);
    const scan = await import('../store/memory.js').then(m => m.getScan(scanId));
    if (scan) scan.error = err.message;
  }
}
