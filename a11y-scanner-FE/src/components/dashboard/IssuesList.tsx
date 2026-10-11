import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { type IssueDetail } from '../../types/api.types';
import { a11yApi } from '../../services/a11yApi';

interface IssuesListProps {
  scanId: string;
  onSelectIssue: (issue: IssueDetail) => void;
}

export const IssuesList: React.FC<IssuesListProps> = ({ scanId, onSelectIssue }) => {
  const [issues, setIssues] = useState<IssueDetail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    a11yApi.getIssues(scanId)
      .then(res => {
        setIssues(res.issues);
        if (res.issues.length > 0) onSelectIssue(res.issues[0]);
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [scanId, onSelectIssue]);

  if (loading) return <div className="p-6 text-slate-400">Loading violations...</div>;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-[600px]">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <h3 className="font-semibold text-sm flex items-center gap-2 text-slate-200">
          <FileText className="w-4 h-4 text-indigo-400"/> Violation Findings
        </h3>
        <span className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full border border-red-500/20 font-medium">
          {issues.length} Issues
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pt-4 pr-1">
        {issues.map(issue => (
          <div 
            key={issue.issueId}
            onClick={() => onSelectIssue(issue)}
            className="p-3 bg-slate-950/60 border border-slate-800 hover:border-slate-700 rounded-lg cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide bg-red-500/10 text-red-400 border border-red-500/20">
                {issue.impact}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">{issue.ruleId}</span>
            </div>
            <p className="text-xs text-slate-200 font-medium">{issue.title}</p>
            <code className="text-[11px] text-indigo-300 font-mono mt-1 block">{issue.wcagTags.join(', ')}</code>
          </div>
        ))}
      </div>
    </div>
  );
};