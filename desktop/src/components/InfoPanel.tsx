import { useMemo, useState } from 'react';
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
  onSetCandidatePromotionState: (candidateId: string, promotionState: MemoryCandidate['promotion_state']) => Promise<void>;
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
  onSetCandidatePromotionState,
  runReport,
}: InfoPanelProps) {
  const [candidateFilter, setCandidateFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected' | 'ready_queue'>('all');
  const [candidateSort, setCandidateSort] = useState<'newest' | 'oldest' | 'confidence_desc' | 'confidence_asc'>('newest');
  const latestAssistant = [...(bundle?.messages ?? [])].reverse().find((item) => item.role === 'assistant');
  const pendingCount = candidates.filter((item) => item.status === 'pending').length;
  const acceptedCount = candidates.filter((item) => item.status === 'accepted').length;
  const rejectedCount = candidates.filter((item) => item.status === 'rejected').length;
  const readyCount = candidates.filter((item) => item.promotion_state === 'ready').length;
  const filteredCandidates = useMemo(() => {
    const base =
      candidateFilter === 'all'
        ? [...candidates]
        : candidateFilter === 'ready_queue'
          ? candidates.filter((item) => item.promotion_state === 'ready')
          : candidates.filter((item) => item.status === candidateFilter);
    if (candidateSort === 'oldest') {
      return base.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    if (candidateSort === 'confidence_desc') {
      return base.sort((a, b) => b.confidence - a.confidence);
    }
    if (candidateSort === 'confidence_asc') {
      return base.sort((a, b) => a.confidence - b.confidence);
    }
    return base.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [candidateFilter, candidateSort, candidates]);

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
            <span className="badge">{readyCount} ready</span>
          </div>
          <div className="writeback-controls">
            <label className="field compact-field">
              <span>Status</span>
              <select value={candidateFilter} onChange={(event) => setCandidateFilter(event.target.value as typeof candidateFilter)}>
                <option value="all">all</option>
                <option value="pending">pending</option>
                <option value="accepted">accepted</option>
                <option value="rejected">rejected</option>
                <option value="ready_queue">ready queue</option>
              </select>
            </label>
            <label className="field compact-field">
              <span>Sort</span>
              <select value={candidateSort} onChange={(event) => setCandidateSort(event.target.value as typeof candidateSort)}>
                <option value="newest">newest</option>
                <option value="oldest">oldest</option>
                <option value="confidence_desc">confidence desc</option>
                <option value="confidence_asc">confidence asc</option>
              </select>
            </label>
          </div>
          {filteredCandidates.map((item) => (
            <article key={item.id} className="mini-card">
              <strong>{item.candidate_type}</strong>
              <p>{item.content}</p>
              <small>
                {Math.round(item.confidence * 100)}% · {item.status} · promo {item.promotion_state} · {new Date(item.created_at).toLocaleString()}
              </small>
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
                <button
                  type="button"
                  className="action-button secondary"
                  disabled={item.status !== 'accepted' || item.promotion_state === 'ready'}
                  onClick={() => void onSetCandidatePromotionState(item.id, 'ready')}
                >
                  Queue
                </button>
                <button
                  type="button"
                  className="action-button secondary"
                  disabled={item.promotion_state === 'idle'}
                  onClick={() => void onSetCandidatePromotionState(item.id, 'idle')}
                >
                  Clear Queue
                </button>
              </div>
            </article>
          ))}
          {candidates.length === 0 ? <div className="empty-state">No memory candidates yet.</div> : null}
          {candidates.length > 0 && filteredCandidates.length === 0 ? (
            <div className="empty-state">No candidates match the current filter.</div>
          ) : null}
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
