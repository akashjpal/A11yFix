import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { type IssueDetail as IssueDetailType } from '../../types/api.types';

interface IssueDetailProps {
  issue: IssueDetailType;
  onGenerateFix: (nodeId: string) => void;
}

export const IssueDetail: React.FC<IssueDetailProps> = ({ issue, onGenerateFix }) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" /> {issue.title}
          </h3>
          <span className="text-xs text-indigo-400 font-mono">{issue.ruleId}</span>
        </div>
        <p className="text-sm text-slate-300">{issue.description}</p>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs uppercase tracking-wider text-slate-400 font-bold">Affected DOM Nodes & Source Mapping</h4>
        {issue.elements.map(node => (
          <div key={node.nodeId} className="bg-slate-950 border border-slate-800 p-4 rounded-lg space-y-3">
            <div className="flex justify-between text-xs">
              <span className="text-indigo-400 font-mono">Route: {node.page}</span>
              <span className="text-slate-500 font-mono">Source File: {node.sourceMapping.files[0] || 'Unmapped'}</span>
            </div>
            <pre className="bg-slate-900 p-2.5 rounded text-xs text-red-300 font-mono overflow-x-auto">
              {node.html}
            </pre>
            <button 
              onClick={() => onGenerateFix(node.nodeId)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4 py-2 rounded-lg font-medium transition-all"
            >
              Generate AI Fix for Node
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};