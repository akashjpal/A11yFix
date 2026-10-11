import type { ScanRequestPayload, ScanResponse, IssueDetail, FixResponse } from '../types/api.types';

const API_BASE = '/api';

export const a11yApi = {
  async startScan(payload: ScanRequestPayload): Promise<ScanResponse> {
    const res = await fetch(`${API_BASE}/scans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to start repository scan');
    return res.json();
  },

  async getScan(scanId: string): Promise<ScanResponse> {
    const res = await fetch(`${API_BASE}/scans/${scanId}`);
    if (!res.ok) throw new Error('Failed to fetch scan progress');
    return res.json();
  },

  async getIssues(scanId: string): Promise<{ total: number; issues: IssueDetail[] }> {
    const res = await fetch(`${API_BASE}/scans/${scanId}/issues`);
    if (!res.ok) throw new Error('Failed to fetch accessibility findings');
    return res.json();
  },

  async getIssueDetail(scanId: string, issueId: string): Promise<IssueDetail> {
    const res = await fetch(`${API_BASE}/scans/${scanId}/issues/${issueId}`);
    if (!res.ok) throw new Error('Failed to fetch issue details');
    return res.json();
  },

  async generateFix(scanId: string, issueId: string, nodeIds: string[]): Promise<FixResponse> {
    const res = await fetch(`${API_BASE}/scans/${scanId}/issues/${issueId}/fixes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds, instructions: "Generate the smallest safe code change that resolves this finding." }),
    });
    if (!res.ok) throw new Error('Failed to trigger AI fix generation');
    return res.json();
  },

  async getFixStatus(fixId: string): Promise<FixResponse> {
    const res = await fetch(`${API_BASE}/fixes/${fixId}`);
    if (!res.ok) throw new Error('Failed to poll fix status');
    return res.json();
  },

  async createPullRequest(fixId: string, title: string, body: string): Promise<FixResponse> {
    const res = await fetch(`${API_BASE}/fixes/${fixId}/pull-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, title, body, baseBranch: 'main', runVerification: true }),
    });
    if (!res.ok) throw new Error('Failed to initiate pull request creation');
    return res.json();
  }
};