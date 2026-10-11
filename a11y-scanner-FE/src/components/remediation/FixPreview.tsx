import React, { useState, useEffect } from 'react';
import { GitPullRequest, CheckCircle2, RefreshCw, Code2 } from 'lucide-react';
import { type FixResponse } from '../../types/api.types';
import { a11yApi } from '../../services/a11yApi';

interface FixPreviewProps {
  fixId: string;
}

export const FixPreview: React.FC<FixPreviewProps> = ({ fixId }) => {
  const [fixData, setFixData] = useState<FixResponse | null>(null);
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const data = await a11yApi.getFixStatus(fixId);
        setFixData(data);
        if (data.status === 'ready_for_pr' || data.status === 'pr_created' || data.status === 'failed') {
          setPolling(false);
          clearInterval(timer);
        }
      } catch (err) {
        console.error(err);
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [fixId]);

  const handleCreatePR = async () => {
    try {
      const res = await a11yApi.createPullRequest(fixId, 'Fix accessibility violation', 'Automated patch generated via Gemma 4 AI agent.');
      setFixData(res);
      setPolling(true);
    } catch (err) {
      console.error(err);
    }
  };

  if (!fixData) return <div className="p-6 text-slate-400">Loading AI patch generation...</div>;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-200">
          <Code2 className="w-4 h-4 text-emerald-400"/> AI Fix & Remediation Status
        </h3>
        <span className="text-xs px-2 py-0.5 rounded font-mono uppercase bg-slate-800 text-indigo-300">
          {fixData.status}
        </span>
      </div>

      <p className="text-sm text-slate-300">{fixData.summary || 'Preparing model-driven code patch...'}</p>

      {fixData.status === 'ready_for_pr' && (
        <button 
          onClick={handleCreatePR}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 px-4 rounded-lg font-medium text-xs flex items-center justify-center space-x-2 transition-all shadow-lg"
        >
          <GitPullRequest className="w-4 h-4" />
          <span>Approve & Create GitHub Pull Request</span>
        </button>
      )}

      {fixData.status === 'pr_created' && fixData.pullRequest && (
        <div className="bg-emerald-950/30 border border-emerald-500/30 p-4 rounded-lg flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <div>
              <p className="text-xs font-semibold text-emerald-200">Pull Request #{fixData.pullRequest.number} Created Successfully</p>
              <a href={fixData.pullRequest.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 underline">
                {fixData.pullRequest.url}
              </a>
            </div>
          </div>
          <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded">Verification Passed</span>
        </div>
      )}

      {polling && fixData.status !== 'ready_for_pr' && fixData.status !== 'pr_created' && (
        <div className="flex items-center space-x-2 text-xs text-slate-400">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
          <span>Processing background operation...</span>
        </div>
      )}
    </div>
  );
};