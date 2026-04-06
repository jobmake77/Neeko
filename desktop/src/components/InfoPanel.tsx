import { InfoTab, MemoryCandidate, PersonaWorkbenchProfile, WorkbenchRun, WorkbenchRunReport } from '../lib/types';
import { ConversationBundle } from '../lib/types';

const TABS: InfoTab[] = ['Soul', 'Memory', 'Citations', 'Writeback', 'Training'];

interface InfoPanelProps {
  activeTab: InfoTab;
  onTabChange: (tab: InfoTab) => void;
  profile: PersonaWorkbenchProfile | null;
  bundle: ConversationBundle | null;
  candidates: MemoryCandidate[];
  recentRuns: WorkbenchRun[];
  currentRunId: string | null;
  onSelectRun: (run: WorkbenchRun) => Promise<void>;
  onReviewCandidate: (candidateId: string, status: MemoryCandidate['status']) => Promise<void>;
  runReport: WorkbenchRunReport | null;
}

export function InfoPanel({
  activeTab,
  onTabChange,
  profile,
  bundle,
  candidates,
  recentRuns,
  currentRunId,
  onSelectRun,
  onReviewCandidate,
  runReport,
}: InfoPanelProps) {
  const latestAssistant = [...(bundle?.messages ?? [])].reverse().find((item) => item.role === 'assistant');
  const pendingCount = candidates.filter((item) => item.status === 'pending').length;
  const acceptedCount = candidates.filter((item) => item.status === 'accepted').length;
  const rejectedCount = candidates.filter((item) => item.status === 'rejected').length;

  return (
    <aside className="panel info-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Inspector</p>
          <h2>Context</h2>
        </div>
      </div>
      <div className="tab-row">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={tab === activeTab ? 'tab-button active' : 'tab-button'}
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Soul' ? (
        <div className="inspector-section">
          <h3>Core beliefs</h3>
          {(profile?.summary.core_beliefs ?? []).map((item) => <p key={item}>{item}</p>)}
          <h3>Expert domains</h3>
          {(profile?.summary.expert_domains ?? []).map((item) => <p key={item}>{item}</p>)}
          <h3>Language signals</h3>
          {(profile?.summary.language_style ?? []).map((item) => <p key={item}>{item}</p>)}
        </div>
      ) : null}

      {activeTab === 'Memory' ? (
        <div className="inspector-section">
          {(latestAssistant?.citation_items ?? []).map((item) => (
            <article key={item.id} className="mini-card">
              <strong>{item.soul_dimension ?? item.category ?? 'memory'}</strong>
              <p>{item.summary}</p>
            </article>
          ))}
          {!latestAssistant?.citation_items.length ? <div className="empty-state">No retrieved memory on the latest turn.</div> : null}
        </div>
      ) : null}

      {activeTab === 'Citations' ? (
        <div className="inspector-section">
          {(latestAssistant?.citation_items ?? []).map((item) => (
            <article key={item.id} className="mini-card">
              <strong>{item.id}</strong>
              <p>{item.summary}</p>
              <small>{item.category} · {item.soul_dimension}</small>
            </article>
          ))}
          {!latestAssistant?.citation_items.length ? <div className="empty-state">No citations for the current thread yet.</div> : null}
        </div>
      ) : null}

      {activeTab === 'Writeback' ? (
        <div className="inspector-section">
          <div className="writeback-summary">
            <span className="badge">{pendingCount} pending</span>
            <span className="badge success">{acceptedCount} accepted</span>
            <span className="badge warning">{rejectedCount} rejected</span>
          </div>
          {candidates.map((item) => (
            <article key={item.id} className="mini-card">
              <strong>{item.candidate_type}</strong>
              <p>{item.content}</p>
              <small>{Math.round(item.confidence * 100)}% · {item.status}</small>
              <div className="candidate-actions">
                <button
                  type="button"
                  className="action-button secondary"
                  disabled={item.status === 'accepted'}
                  onClick={() => void onReviewCandidate(item.id, 'accepted')}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="action-button secondary"
                  disabled={item.status === 'pending'}
                  onClick={() => void onReviewCandidate(item.id, 'pending')}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="action-button danger"
                  disabled={item.status === 'rejected'}
                  onClick={() => void onReviewCandidate(item.id, 'rejected')}
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
          {candidates.length === 0 ? <div className="empty-state">No memory candidates yet.</div> : null}
        </div>
      ) : null}

      {activeTab === 'Training' ? (
        <div className="inspector-section">
          {recentRuns.map((run) => (
            <button
              key={run.id}
              type="button"
              className={run.id === currentRunId ? 'mini-card active-card' : 'mini-card'}
              onClick={() => void onSelectRun(run)}
            >
              <strong>{run.type}</strong>
              <p>{run.summary ?? run.status}</p>
              <small>{new Date(run.started_at).toLocaleString()}</small>
            </button>
          ))}
          {runReport ? (
            <article className="mini-card">
              <strong>{runReport.run.type}</strong>
              <p>{runReport.run.summary ?? runReport.run.status}</p>
              {runReport.run.report_path ? <code>{runReport.run.report_path}</code> : null}
              {runReport.report ? <pre>{JSON.stringify(runReport.report, null, 2).slice(0, 2400)}</pre> : null}
              {runReport.log_tail ? <pre>{runReport.log_tail}</pre> : null}
            </article>
          ) : <div className="empty-state">No active run selected.</div>}
        </div>
      ) : null}
    </aside>
  );
}
