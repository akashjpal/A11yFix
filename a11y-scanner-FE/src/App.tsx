import { useState } from 'react';
import { Header } from './components/layout/Header';
import { ScanForm } from './components/scanner/ScanForm';
import { ScanProgress } from './components/scanner/ScanProgress';
import { IssuesList } from './components/dashboard/IssuesList';
import { IssueDetail } from './components/dashboard/IssueDetail';
import { FixPreview } from './components/remediation/FixPreview';
import { type IssueDetail as IssueDetailType } from './types/api.types';
import { a11yApi } from './services/a11yApi';

export default function App() {
  const [scanId, setScanId] = useState<string | null>(null);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<IssueDetailType | null>(null);
  const [fixId, setFixId] = useState<string | null>(null);

  const handleGenerateFix = async (nodeId: string) => {
    if (!scanId || !selectedIssue) return;
    try {
      const res = await a11yApi.generateFix(scanId, selectedIssue.issueId, [nodeId]);
      setFixId(res.fixId);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        {!scanId && <ScanForm onScanStarted={(id) => setScanId(id)} />}

        {scanId && !scanCompleted && (
          <ScanProgress scanId={scanId} onScanCompleted={() => setScanCompleted(true)} />
        )}

        {scanCompleted && scanId && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn">
            <div className="lg:col-span-4">
              <IssuesList scanId={scanId} onSelectIssue={(issue) => setSelectedIssue(issue)} />
            </div>

            <div className="lg:col-span-8 space-y-6">
              {selectedIssue && (
                <IssueDetail issue={selectedIssue} onGenerateFix={handleGenerateFix} />
              )}
              {fixId && <FixPreview fixId={fixId} />}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}