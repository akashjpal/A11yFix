// In-memory store for MVP
// Maps scanId -> scan record
// Maps issueId -> issue record
// Maps fixId -> fix record

const scans = new Map();
const issues = new Map();
const fixes = new Map();

export function getScan(scanId) { return scans.get(scanId); }
export function setScan(scanId, record) { scans.set(scanId, record); return record; }
export function getAllScans() { return Array.from(scans.values()); }

export function getIssue(scanId, issueId) {
  const scan = scans.get(scanId);
  if (!scan) return null;
  return scan.issues.find(i => i.issueId === issueId) || null;
}
export function addIssue(scanId, issue) {
  const scan = scans.get(scanId);
  if (!scan) return null;
  scan.issues.push(issue);
  issues.set(issue.issueId, issue);
  return issue;
}
export function getIssues(scanId) {
  const scan = scans.get(scanId);
  return scan ? scan.issues : [];
}

export function getFix(fixId) { return fixes.get(fixId); }
export function setFix(fixId, record) { fixes.set(fixId, record); return record; }

export function createScan(id, record) {
  const scan = { id, status: 'queued', progress: 0, issues: [], createdAt: new Date().toISOString(), ...record };
  scans.set(id, scan);
  return scan;
}

export function updateScanStatus(scanId, status, progress) {
  const scan = scans.get(scanId);
  if (!scan) return null;
  scan.status = status;
  scan.progress = progress;
  return scan;
}

export function updateFixStatus(fixId, status, extra = {}) {
  const fix = fixes.get(fixId);
  if (!fix) return null;
  fix.status = status;
  Object.assign(fix, extra);
  fixes.set(fixId, fix);
  return fix;
}
