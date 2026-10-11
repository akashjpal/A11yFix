import { Router } from 'express';
import { runScanJob } from '../jobs/runner.js';
import { createScan, updateScanStatus, getScan, getIssues, getIssue } from '../store/memory.js';
import { scanDemoApp } from '../services/scanner.js';
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

    // Start background job
    runScanJob(scanId, repoUrl, scanRoutes).then(async () => {
      const completedScan = getScan(scanId);
      if (completedScan && completedScan.status === 'completed' && completedScan.appUrl) {
        // Run accessibility scan against the started app
        const findings = await scanDemoApp(completedScan.appUrl, scanRoutes);
        const scanRecord = getScan(scanId);
        if (scanRecord) {
          for (const finding of findings) {
            scanRecord.issues.push(finding);
          }
        }
        updateScanStatus(scanId, 'completed', 100);
      }
    }).catch(err => {
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

export default router;
export { router };
