import React, { useState } from 'react';
import { Code2, ArrowRight } from 'lucide-react';

interface ScanFormProps {
  onScanStarted: (scanId: string) => void;
}

export const ScanForm: React.FC<ScanFormProps> = ({ onScanStarted }) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Calls POST /api/scans[cite: 3, 11]
      const response = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl, wcagVersion: '2.2', conformanceLevel: 'AA' })
      });
      const data = await response.json();
      onScanStarted(data.scanId);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <h2 className="text-lg font-semibold mb-1">Start Repository Scan</h2>
      <p className="text-sm text-slate-400 mb-6">Enter a public or authorized GitHub repository URL to evaluate WCAG compliance.</p>
      <form onSubmit={handleSubmit} className="flex gap-4">
        <div className="relative flex-1">
          <Code2 className="absolute left-3.5 top-3.5 w-5 h-5 text-slate-500" />
          <input 
            type="text" 
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/yourusername/accessibility-demo" 
            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-11 pr-4 py-3 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            required
          />
        </div>
        <button 
          type="submit" 
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-medium text-sm flex items-center space-x-2 transition-all disabled:opacity-50"
        >
          <span>{loading ? 'Queuing...' : 'Scan Repository'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};