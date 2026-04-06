import { useMemo, useState } from 'react';
import { InfoTab, MemoryCandidate, PersonaWorkbenchProfile, PromotionHandoff, TrainingPrepArtifact, WorkbenchRun, WorkbenchRunReport } from '../lib/types';
import { ConversationBundle } from '../lib/types';

const TABS: InfoTab[] = ['Soul', 'Memory', 'Citations', 'Writeback', 'Training'];

interface InfoPanelProps {
  activeTab: InfoTab;
  onTabChange: (tab: InfoTab) => void;
  profile: PersonaWorkbenchProfile | null;
  bundle: ConversationBundle | null;
  candidates: MemoryCandidate[];
  promotionHandoffs: PromotionHandoff[];
  trainingPreps: TrainingPrepArtifact[];
  recentRuns: WorkbenchRun[];
  currentRunId: string | null;
  onSelectRun: (run: WorkbenchRun) => Promise<void>;
  onReviewCandidate: (candidateId: string, status: MemoryCandidate['status']) => Promise<void>;
  onSetCandidatePromotionState: (candidateId: string, promotionState: MemoryCandidate['promotion_state']) => Promise<void>;
  onCreatePromotionHandoff: () => Promise<void>;
  onUpdatePromotionHandoff: (handoffId: string, status: PromotionHandoff['status']) => Promise<void>;
  onExportPromotionHandoff: (handoffId: string, format: 'markdown' | 'json') => Promise<void>;
  onCreateTrainingPrep: (handoffId: string) => Promise<void>;
  onExportTrainingPrep: (prepId: string, format: 'markdown' | 'json') => Promise<void>;
  onCopyValue: (value: string, label: string) => Promise<void>;
  runReport: WorkbenchRunReport | null;
}

export function InfoPanel({
  activeTab,
  onTabChange,
  profile,
  bundle,
  candidates,
  promotionHandoffs,
  trainingPreps,
  recentRuns,
  currentRunId,
  onSelectRun,
  onReviewCandidate,
  onSetCandidatePromotionState,
  onCreatePromotionHandoff,
  onUpdatePromotionHandoff,
  onExportPromotionHandoff,
  onCreateTrainingPrep,
  onExportTrainingPrep,
  onCopyValue,
  runReport,
}: InfoPanelProps) {
  const [candidateFilter, setCandidateFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected' | 'ready_queue'>('all');
  const [candidateSort, setCandidateSort] = useState<'newest' | 'oldest' | 'confidence_desc' | 'confidence_asc'>('newest');
  const [selectedHandoffId, setSelectedHandoffId] = useState<string | null>(null);
  const [selectedPrepId, setSelectedPrepId] = useState<string | null>(null);
  const latestAssistant = [...(bundle?.messages ?? [])].reverse().find((item) => item.role === 'assistant');
  const pendingCount = candidates.filter((item) => item.status === 'pending').length;
  const acceptedCount = candidates.filter((item) => item.status === 'accepted').length;
  const rejectedCount = candidates.filter((item) => item.status === 'rejected').length;
  const readyCount = candidates.filter((item) => item.promotion_state === 'ready').length;
  const selectedHandoff = promotionHandoffs.find((item) => item.id === selectedHandoffId) ?? promotionHandoffs[0] ?? null;
  const selectedPrep = trainingPreps.find((item) => item.id === selectedPrepId) ?? trainingPreps[0] ?? null;
  const runContext = (runReport?.context && typeof runReport.context === 'object') ? runReport.context as Record<string, unknown> : null;
  const prepContext =
    runContext && typeof runContext.prep_context === 'object' && runContext.prep_context
      ? runContext.prep_context as Record<string, unknown>
      : null;
  const runPresentation = deriveRunPresentation(runReport);
  const runSummary = deriveRunSummary(runReport?.report);
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
          <div className="candidate-actions">
            <button
              type="button"
              className="action-button"
              disabled={readyCount === 0}
              onClick={() => void onCreatePromotionHandoff()}
            >
              Create Handoff
            </button>
          </div>
          {selectedHandoff ? (
            <article className="mini-card">
              <strong>Selected handoff</strong>
              <p>{selectedHandoff.summary}</p>
              <small>
                {selectedHandoff.status} · {new Date(selectedHandoff.updated_at).toLocaleString()}
              </small>
              {selectedHandoff.session_summary ? <p>{selectedHandoff.session_summary}</p> : null}
              <div className="handoff-meta-grid">
                <span className="badge">{selectedHandoff.items.length} items</span>
                <span className="badge">{selectedHandoff.candidate_ids.length} ids</span>
                <span className="badge">{selectedHandoff.persona_slug}</span>
              </div>
              <div className="candidate-actions">
                <button
                  type="button"
                  className="action-button secondary"
                  disabled={selectedHandoff.status === 'queued'}
                  onClick={() => void onUpdatePromotionHandoff(selectedHandoff.id, 'queued')}
                >
                  Mark Queued
                </button>
                <button
                  type="button"
                  className="action-button secondary"
                  disabled={selectedHandoff.status === 'drafted'}
                  onClick={() => void onUpdatePromotionHandoff(selectedHandoff.id, 'drafted')}
                >
                  Reopen
                </button>
                <button
                  type="button"
                  className="action-button danger"
                  disabled={selectedHandoff.status === 'archived'}
                  onClick={() => void onUpdatePromotionHandoff(selectedHandoff.id, 'archived')}
                >
                  Archive
                </button>
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onExportPromotionHandoff(selectedHandoff.id, 'markdown')}
                >
                  Copy Markdown
                </button>
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onExportPromotionHandoff(selectedHandoff.id, 'json')}
                >
                  Copy JSON
                </button>
                <button
                  type="button"
                  className="action-button"
                  onClick={() => void onCreateTrainingPrep(selectedHandoff.id)}
                >
                  Create Training Prep
                </button>
              </div>
              <div className="handoff-item-list">
                {selectedHandoff.items.map((item) => (
                  <article key={item.candidate_id} className="mini-card handoff-item-card">
                    <div className="list-card-top">
                      <strong>{item.candidate_type}</strong>
                      <span className="badge">{Math.round(item.confidence * 100)}%</span>
                    </div>
                    <p>{item.content}</p>
                    <small>{item.candidate_id}</small>
                    {item.source_message_ids.length > 0 ? (
                      <small>sources: {item.source_message_ids.join(', ')}</small>
                    ) : null}
                  </article>
                ))}
              </div>
            </article>
          ) : (
            <div className="empty-state">No handoff artifact yet. Create one from the ready queue when the candidate set looks clean.</div>
          )}
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
          {promotionHandoffs.length > 1 ? (
            <div className="inspector-section">
              <h3>Handoff history</h3>
              {promotionHandoffs.slice(0, 6).map((handoff) => (
                <button
                  key={handoff.id}
                  type="button"
                  className={selectedHandoff?.id === handoff.id ? 'mini-card active-card' : 'mini-card'}
                  onClick={() => setSelectedHandoffId(handoff.id)}
                >
                  <strong>{handoff.status}</strong>
                  <p>{handoff.summary}</p>
                  <small>{new Date(handoff.updated_at).toLocaleString()}</small>
                </button>
              ))}
            </div>
          ) : null}
          {trainingPreps.length > 0 ? (
            <div className="inspector-section">
              <h3>Training Prep</h3>
              {selectedPrep ? (
                <article className="mini-card">
                  <strong>Selected prep</strong>
                  <p>{selectedPrep.summary}</p>
                  <small>{new Date(selectedPrep.updated_at).toLocaleString()}</small>
                  <div className="candidate-actions">
                    <button
                      type="button"
                      className="action-button secondary"
                      onClick={() => void onCopyValue(selectedPrep.documents_path, 'Documents path')}
                    >
                      Copy Docs Path
                    </button>
                    <button
                      type="button"
                      className="action-button secondary"
                      onClick={() => void onCopyValue(selectedPrep.evidence_index_path, 'Evidence path')}
                    >
                      Copy Evidence Path
                    </button>
                    <button
                      type="button"
                      className="action-button secondary"
                      onClick={() => void onExportTrainingPrep(selectedPrep.id, 'markdown')}
                    >
                      Copy Prep Markdown
                    </button>
                    <button
                      type="button"
                      className="action-button secondary"
                      onClick={() => void onExportTrainingPrep(selectedPrep.id, 'json')}
                    >
                      Copy Prep JSON
                    </button>
                  </div>
                  <code>{selectedPrep.documents_path}</code>
                  <code>{selectedPrep.evidence_index_path}</code>
                </article>
              ) : null}
              {trainingPreps.slice(0, 5).map((prep) => (
                <button
                  key={prep.id}
                  type="button"
                  className={selectedPrep?.id === prep.id ? 'mini-card active-card' : 'mini-card'}
                  onClick={() => setSelectedPrepId(prep.id)}
                >
                  <strong>{prep.status}</strong>
                  <p>{prep.summary}</p>
                  <small>{new Date(prep.updated_at).toLocaleString()}</small>
                </button>
              ))}
            </div>
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
            <div className="training-card-stack">
              <article className="mini-card training-overview-card">
                <div className="list-card-top">
                  <strong>{runReport.run.type}</strong>
                  <span className={runReport.run.status === 'completed' ? 'badge success' : runReport.run.status === 'failed' ? 'badge warning' : 'badge'}>
                    {runPresentation.statusLabel}
                  </span>
                </div>
                <p>{runPresentation.primaryMessage}</p>
                <div className="writeback-summary">
                  {runPresentation.track ? <span className="badge">{runPresentation.track}</span> : null}
                  {runPresentation.phase ? <span className="badge">{runPresentation.phase}</span> : null}
                  {runPresentation.isSmoke ? <span className="badge success">smoke</span> : null}
                  {typeof runReport.run.attempt_count === 'number' && runReport.run.attempt_count > 1 ? (
                    <span className="badge">attempt {runReport.run.attempt_count}</span>
                  ) : null}
                </div>
                <small>started: {new Date(runReport.run.started_at).toLocaleString()}</small>
                {runReport.run.finished_at ? <small>finished: {new Date(runReport.run.finished_at).toLocaleString()}</small> : null}
                <div className="writeback-summary">
                  {runReport.run.report_path ? <span className="badge success">report ready</span> : null}
                  {runReport.context_path ? <span className="badge">training context ready</span> : null}
                </div>
              </article>

              {runPresentation.secondaryMessage ? (
                <article className="mini-card training-diagnostic-card">
                  <strong>Recovery Status</strong>
                  <p>{runPresentation.secondaryMessage}</p>
                  <div className="writeback-summary">
                    {runReport.run.recovery_state === 'recovering' ? <span className="badge success">recovering</span> : null}
                    {runReport.run.recovery_state === 'exhausted' ? <span className="badge warning">progress saved</span> : null}
                  </div>
                </article>
              ) : null}

              {runSummary ? (
                <article className="mini-card training-summary-card">
                  <strong>Report Snapshot</strong>
                  <div className="evidence-metric-grid">
                    {runSummary.map((item) => (
                      <div key={item.label} className="metric-group">
                        <strong>{item.label}</strong>
                        <span>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ) : null}

              {prepContext ? (
                <article className="mini-card training-prep-card">
                  <strong>Prep Context</strong>
                  {typeof prepContext.prep_documents_path === 'string' ? <code>{prepContext.prep_documents_path}</code> : null}
                  {typeof prepContext.prep_evidence_path === 'string' ? <code>{prepContext.prep_evidence_path}</code> : null}
                  <div className="writeback-summary">
                    {typeof prepContext.prep_artifact_id === 'string' ? (
                      <span className="badge">{prepContext.prep_artifact_id}</span>
                    ) : null}
                    {typeof prepContext.evidence_import_id === 'string' ? (
                      <span className="badge">{prepContext.evidence_import_id}</span>
                    ) : null}
                  </div>
                </article>
              ) : null}
            </div>
          ) : <div className="empty-state">No active run selected.</div>}
        </div>
      ) : null}
    </aside>
  );
}

function deriveRunPresentation(runReport: WorkbenchRunReport | null): {
  track?: string;
  phase?: string;
  isSmoke: boolean;
  statusLabel: string;
  primaryMessage: string;
  secondaryMessage?: string;
} {
  const context = runReport?.context && typeof runReport.context === 'object'
    ? runReport.context as Record<string, unknown>
    : null;
  const command = runReport?.run.command ?? [];
  const track = typeof context?.track === 'string' ? context.track : undefined;
  const phase = typeof context?.state === 'string' ? context.state : runReport?.run.status;
  const isSmoke = command.includes('--track') && command.includes('persona_extract') && command.includes('--rounds') && command.includes('1') && (runReport?.run.summary?.includes('smoke') ?? false);
  const recoveryState = runReport?.run.recovery_state ?? 'idle';
  const status = runReport?.run.status ?? 'running';
  const attempts = runReport?.run.attempt_count ?? 1;

  const statusLabel =
    recoveryState === 'recovering' ? 'recovering'
      : status === 'completed' ? 'completed'
        : status === 'failed' ? 'paused'
          : 'running';

  let primaryMessage = runReport?.run.summary ?? statusLabel;
  let secondaryMessage: string | undefined;
  if (recoveryState === 'recovering') {
    primaryMessage = 'The system is retrying this training run automatically.';
    secondaryMessage = attempts > 1
      ? `Saved progress is being reused. Recovery attempt ${attempts} is now in progress.`
      : 'Saved progress will be reused when available.';
  } else if (status === 'failed') {
    primaryMessage = 'This training run is paused for now.';
    secondaryMessage = 'Progress has been saved safely. You can retry later without exposing internal errors to the user.';
  } else if (status === 'completed' && attempts > 1) {
    primaryMessage = 'Training completed after automatic recovery.';
    secondaryMessage = 'The system handled a transient issue internally and finished the run.';
  }
  return {
    track,
    phase,
    isSmoke,
    statusLabel,
    primaryMessage,
    secondaryMessage,
  };
}

function deriveRunSummary(report: unknown): Array<{ label: string; value: string }> | null {
  if (!report || typeof report !== 'object') return null;
  const data = report as Record<string, unknown>;
  const summary = data.summary && typeof data.summary === 'object' ? data.summary as Record<string, unknown> : null;
  const totalRounds = typeof data.total_rounds === 'number' ? data.total_rounds : null;
  if (!summary && totalRounds === null) return null;

  const items: Array<{ label: string; value: string }> = [];
  if (totalRounds !== null) items.push({ label: 'Rounds', value: String(totalRounds) });
  if (typeof summary?.avg_quality_score === 'number') {
    items.push({ label: 'Avg Quality', value: `${(summary.avg_quality_score * 100).toFixed(1)}%` });
  }
  if (typeof summary?.avg_contradiction_rate === 'number') {
    items.push({ label: 'Contradiction', value: `${(summary.avg_contradiction_rate * 100).toFixed(1)}%` });
  }
  if (typeof summary?.avg_duplication_rate === 'number') {
    items.push({ label: 'Duplication', value: `${(summary.avg_duplication_rate * 100).toFixed(1)}%` });
  }
  return items.length > 0 ? items : null;
}
