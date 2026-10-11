export type ScanStatus = 'queued' | 'cloning' | 'installing' | 'starting' | 'scanning' | 'completed' | 'failed';
export type ImpactLevel = 'critical' | 'serious' | 'moderate' | 'minor';

export interface ScanRequestPayload {
  repoUrl: string;
  baseBranch?: string;
  target?: {
    wcagVersion?: string;
    conformanceLevel?: string;
  };
  routes?: string[];
}

export interface ScanResponse {
  scanId: string;
  status: ScanStatus;
  stage?: string;
  progress?: {
    pagesCompleted: number;
    pagesTotal: number;
  };
  message?: string;
  summary?: {
    pagesScanned: number;
    violationGroups: number;
    affectedElements: number;
    byImpact: Record<ImpactLevel, number>;
  };
}

export interface IssueNode {
  nodeId: string;
  page: string;
  selectors: string[];
  html: string;
  failureSummary: string;
  sourceMapping: {
    status: 'mapped' | 'unmapped';
    files: string[];
  };
  fixStatus: string;
}

export interface IssueDetail {
  issueId: string;
  scanId: string;
  ruleId: string;
  title: string;
  description: string;
  impact: ImpactLevel;
  wcagTags: string[];
  helpUrl: string;
  elements: IssueNode[];
}

export interface FixResponse {
  fixId: string;
  scanId: string;
  issueId: string;
  status: 'generating' | 'ready_for_pr' | 'pr_in_progress' | 'pr_created' | 'failed';
  summary?: string;
  filesChanged?: Array<{ path: string; changeType: string }>;
  verification?: {
    status: 'not_run' | 'passed' | 'failed' | 'inconclusive';
    checks?: Record<string, unknown>;
    build?: string;
    originalViolation?: string;
  };
  pullRequest?: {
    number: number;
    url: string;
    branch: string;
    baseBranch: string;
  } | null;
}