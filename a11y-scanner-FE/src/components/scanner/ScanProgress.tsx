import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { type ScanResponse } from '../../types/api.types';
import { a11yApi } from '../../services/a11yApi';

interface ScanProgressProps {
  scanId: string;
  onScanCompleted: () => void;
}

export const ScanProgress: React.FC<ScanProgressProps> = ({ scanId, onScanCompleted }) => {
  const [scanData, setScanData] = useState<ScanResponse | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await a11yApi.getScan(scanId);
        setScanData(data);
        if (data.status === 'completed') {
          clearInterval(interval);
          onScanCompleted();
        }
      } catch (err) {
        console.error(err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [scanId, onScanCompleted]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 max-w-md mx-auto text-center space-y-4 mt-12 shadow-xl">
      <div className="w-12 h-12 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full flex items-center justify-center mx-auto">
        <RefreshCw className="w-6 h-6 animate-spin" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-slate-100 capitalize">Scan Status: {scanData?.status || 'queued'}</h3>
        <p className="text-xs text-slate-400 mt-1">{scanData?.message || 'Initializing background runner job...'}</p>
      </div>
      {scanData?.progress && (
        <div className="text-xs text-slate-500 font-mono">
          Pages Processed: {scanData.progress.pagesCompleted} / {scanData.progress.pagesTotal}
        </div>
      )}
    </div>
  );
};