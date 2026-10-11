import React from 'react';
import { ShieldAlert } from 'lucide-react';

export const Header: React.FC = () => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className="bg-indigo-600 p-2 rounded-lg text-white shadow-lg shadow-indigo-600/20">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <div>
          <h1 className="font-bold text-lg tracking-tight text-slate-100">A11yFix Agent Platform</h1>
          <p className="text-xs text-slate-400">Automated WCAG Scanning & Gemma 4 Remediation</p>
        </div>
      </div>
      <div className="hidden md:flex items-center space-x-2 text-xs font-mono text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span>API Connected</span>
      </div>
    </header>
  );
};