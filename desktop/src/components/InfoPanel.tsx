import { useMemo, useState } from 'react';
import { InfoTab, MemoryCandidate, PersonaWorkbenchProfile, PromotionHandoff, TrainingPrepArtifact, WorkbenchEvidenceImport, WorkbenchMemoryNode, WorkbenchMemorySourceAsset, WorkbenchRun, WorkbenchRunReport } from '../lib/types';
import { ConversationBundle } from '../lib/types';

const TABS: InfoTab[] = ['Soul', 'Memory', 'Citations', 'Writeback', 'Training'];

interface InfoPanelProps {
  activeTab: InfoTab;
  onTabChange: (tab: InfoTab) => void;
  profile: PersonaWorkbenchProfile | null;
  bundle: ConversationBundle | null;
  candidates: MemoryCandidate[];
  evidenceImports: WorkbenchEvidenceImport[];
  selectedMemoryNode: WorkbenchMemoryNode | null;
  selectedMemorySourceAssets: WorkbenchMemorySourceAsset[];
  promotionHandoffs: PromotionHandoff[];
  trainingPreps: TrainingPrepArtifact[];
  recentRuns: WorkbenchRun[];
  currentRunId: string | null;
  onSelectRun: (run: WorkbenchRun) => Promise<void>;
  onInspectMemory: (memoryId: string) => Promise<void>;
  onReviewCandidate: (candidateId: string, status: MemoryCandidate['status']) => Promise<void>;
  onSetCandidatePromotionState: (candidateId: string, promotionState: MemoryCandidate['promotion_state']) => Promise<void>;
  onCreatePromotionHandoff: () => Promise<void>;
  onUpdatePromotionHandoff: (handoffId: string, status: PromotionHandoff['status']) => Promise<void>;
  onExportPromotionHandoff: (handoffId: string, format: 'markdown' | 'json') => Promise<void>;
  onCreateTrainingPrep: (handoffId: string) => Promise<void>;
  onExportTrainingPrep: (prepId: string, format: 'markdown' | 'json') => Promise<void>;
  onCopyValue: (value: string, label: string) => Promise<void>;
  onUseTrainingPrep: (prep: TrainingPrepArtifact) => void;
  runReport: WorkbenchRunReport | null;
}

export function InfoPanel({
  activeTab,
  onTabChange,
  profile,
  bundle,
  candidates,
  evidenceImports,
  selectedMemoryNode,
  selectedMemorySourceAssets,
  promotionHandoffs,
  trainingPreps,
  recentRuns,
  currentRunId,
  onSelectRun,
  onInspectMemory,
  onReviewCandidate,
  onSetCandidatePromotionState,
  onCreatePromotionHandoff,
  onUpdatePromotionHandoff,
  onExportPromotionHandoff,
  onCreateTrainingPrep,
  onExportTrainingPrep,
  onCopyValue,
  onUseTrainingPrep,
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
  const messageLookup = useMemo(
    () => new Map((bundle?.messages ?? []).map((item) => [item.id, item])),
    [bundle?.messages]
  );
  const runContext = (runReport?.context && typeof runReport.context === 'object') ? runReport.context as Record<string, unknown> : null;
  const prepContext =
    runContext && typeof runContext.prep_context === 'object' && runContext.prep_context
      ? runContext.prep_context as Record<string, unknown>
      : null;
  const runPresentation = deriveRunPresentation(runReport);
  const runSummary = deriveRunSummary(runReport?.report);
  const runContextEntries = deriveInspectableEntries(runContext, ['prep_context']);
  const selectedRunPrep =
    typeof prepContext?.prep_artifact_id === 'string'
      ? trainingPreps.find((item) => item.id === prepContext.prep_artifact_id) ?? null
      : null;
  const selectedRunEvidenceImport =
    typeof prepContext?.evidence_import_id === 'string'
      ? evidenceImports.find((item) => item.id === prepContext.evidence_import_id) ?? null
      : null;
  const writebackFlow = deriveWritebackFlow({
    pendingCount,
    acceptedCount,
    readyCount,
    selectedHandoff,
    selectedPrep,
  });
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
              <div className="list-card-top">
                <strong>{item.soul_dimension ?? item.category ?? 'memory'}</strong>
                <span className="badge">{item.confidence ? `${Math.round(item.confidence * 100)}%` : 'retrieved'}</span>
              </div>
              <p>{item.summary}</p>
              <div className="writeback-summary">
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onCopyValue(item.id, 'Memory id')}
                >
                  Copy Memory Id
                </button>
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onInspectMemory(item.id)}
                >
                  Inspect Memory
                </button>
                {item.category ? <span className="badge">{item.category}</span> : null}
              </div>
            </article>
          ))}
          {selectedMemoryNode ? (
            <article className="mini-card memory-node-detail-card">
              {renderMemoryNodeInspector(selectedMemoryNode, selectedMemorySourceAssets, onCopyValue)}
            </article>
          ) : null}
          {!latestAssistant?.citation_items.length ? <div className="empty-state">No retrieved memory on the latest turn.</div> : null}
        </div>
      ) : null}

      {activeTab === 'Citations' ? (
        <div className="inspector-section">
          {(latestAssistant?.citation_items ?? []).map((item) => (
            <article key={item.id} className="mini-card">
              <div className="list-card-top">
                <strong>{item.id}</strong>
                <span className="badge">{item.confidence ? `${Math.round(item.confidence * 100)}%` : 'retrieved'}</span>
              </div>
              <p>{item.summary}</p>
              <small>{item.category} · {item.soul_dimension}</small>
              <div className="writeback-summary">
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onCopyValue(item.id, 'Citation id')}
                >
                  Copy Citation Id
                </button>
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onInspectMemory(item.id)}
                >
                  Inspect Memory
                </button>
                {item.soul_dimension ? <span className="badge success">{item.soul_dimension}</span> : null}
              </div>
            </article>
          ))}
          {selectedMemoryNode ? (
            <article className="mini-card memory-node-detail-card">
              {renderMemoryNodeInspector(selectedMemoryNode, selectedMemorySourceAssets, onCopyValue)}
            </article>
          ) : null}
          {!latestAssistant?.citation_items.length ? <div className="empty-state">No citations for the current thread yet.</div> : null}
        </div>
      ) : null}

      {activeTab === 'Writeback' ? (
        <div className="inspector-section">
          <article className="mini-card workflow-card">
            <div className="list-card-top">
              <strong>Pipeline Status</strong>
              <span className={writebackFlow.tone === 'good' ? 'badge success' : writebackFlow.tone === 'warning' ? 'badge warning' : 'badge'}>
                {writebackFlow.statusLabel}
              </span>
            </div>
            <p>{writebackFlow.summary}</p>
            <div className="workflow-stage-grid">
              {writebackFlow.stages.map((stage) => (
                <div key={stage.label} className="workflow-stage-card">
                  <strong>{stage.label}</strong>
                  <span className={stage.tone === 'good' ? 'badge success' : stage.tone === 'warning' ? 'badge warning' : 'badge'}>
                    {stage.status}
                  </span>
                </div>
              ))}
            </div>
            <div className="workflow-step-list">
              {writebackFlow.actions.map((item) => (
                <small key={item}>{item}</small>
              ))}
            </div>
          </article>
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
              <article className="workflow-card">
                <div className="list-card-top">
                  <strong>Handoff Guidance</strong>
                  <span className={selectedHandoff.status === 'queued' ? 'badge success' : 'badge'}>
                    {selectedHandoff.status === 'queued' ? 'ready for prep' : 'draft review'}
                  </span>
                </div>
                <p>
                  {selectedHandoff.status === 'queued'
                    ? 'This handoff is queued and ready to turn into a training prep artifact.'
                    : 'Review the draft handoff, then queue it or export it before building training prep.'}
                </p>
              </article>
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
                        <>
                          <small>sources: {item.source_message_ids.join(', ')}</small>
                          <div className="source-link-list">
                            {deriveSourceMessages(item.source_message_ids, messageLookup).map((message) => (
                              <article key={message.id} className="source-message-card">
                                <strong>{message.role === 'assistant' ? 'Persona' : 'You'}</strong>
                                <small>{trimPreview(message.content)}</small>
                              </article>
                            ))}
                          </div>
                        </>
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
              {item.source_message_ids.length > 0 ? (
                <div className="source-link-list">
                  {deriveSourceMessages(item.source_message_ids, messageLookup).map((message) => (
                    <article key={message.id} className="source-message-card">
                      <strong>{message.role === 'assistant' ? 'Persona' : 'You'}</strong>
                      <small>{trimPreview(message.content)}</small>
                    </article>
                  ))}
                </div>
              ) : null}
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
                      className="action-button"
                      onClick={() => onUseTrainingPrep(selectedPrep)}
                    >
                      Use For Training
                    </button>
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
                  <article className="workflow-card">
                    <div className="list-card-top">
                      <strong>Prep Guidance</strong>
                      <span className="badge success">train ready</span>
                    </div>
                    <p>This prep artifact is ready to attach to the train form or export for external review.</p>
                  </article>
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
                  {selectedRunPrep ? (
                    <article className="workflow-card">
                      <div className="list-card-top">
                        <strong>Linked Training Prep</strong>
                        <span className="badge success">{selectedRunPrep.status}</span>
                      </div>
                      <p>{selectedRunPrep.summary}</p>
                      <div className="writeback-summary">
                        <span className="badge">{selectedRunPrep.item_count} items</span>
                        <button
                          type="button"
                          className="action-button secondary"
                          onClick={() => onUseTrainingPrep(selectedRunPrep)}
                        >
                          Use This Prep
                        </button>
                      </div>
                    </article>
                  ) : null}
                  {selectedRunEvidenceImport ? (
                    <article className="workflow-card">
                      <div className="list-card-top">
                        <strong>Linked Evidence Import</strong>
                        <span className="badge">{selectedRunEvidenceImport.source_kind}</span>
                      </div>
                      <p>{selectedRunEvidenceImport.summary}</p>
                      <div className="writeback-summary">
                        <span className="badge">{selectedRunEvidenceImport.stats.sessions} sessions</span>
                        <span className="badge">{selectedRunEvidenceImport.stats.windows} windows</span>
                        <span className="badge success">{selectedRunEvidenceImport.stats.cross_session_stable_items} stable</span>
                      </div>
                      <code>{selectedRunEvidenceImport.artifacts.documents_path}</code>
                      <code>{selectedRunEvidenceImport.artifacts.evidence_index_path}</code>
                    </article>
                  ) : null}
                </article>
              ) : null}

              {runReport ? (
                <article className="mini-card training-log-card">
                  <strong>Run Detail</strong>
                  <div className="detail-grid">
                    <div className="metric-group">
                      <strong>Persona</strong>
                      <span>{runReport.run.persona_slug ?? 'not set'}</span>
                    </div>
                    <div className="metric-group">
                      <strong>Command Steps</strong>
                      <span>{runReport.run.command.length}</span>
                    </div>
                  </div>
                  {runReport.run.command.length > 0 ? (
                    <div className="context-entry-list">
                      <strong>Command</strong>
                      <code>{runReport.run.command.join(' ')}</code>
                    </div>
                  ) : null}
                  <div className="context-entry-list">
                    {runReport.run.report_path ? (
                      <article className="source-message-card">
                        <strong>Report Path</strong>
                        <small>{runReport.run.report_path}</small>
                        <button
                          type="button"
                          className="action-button secondary"
                          onClick={() => void onCopyValue(runReport.run.report_path ?? '', 'Run report path')}
                        >
                          Copy Path
                        </button>
                      </article>
                    ) : null}
                    {runReport.context_path ? (
                      <article className="source-message-card">
                        <strong>Context Path</strong>
                        <small>{runReport.context_path}</small>
                        <button
                          type="button"
                          className="action-button secondary"
                          onClick={() => void onCopyValue(runReport.context_path ?? '', 'Run context path')}
                        >
                          Copy Path
                        </button>
                      </article>
                    ) : null}
                    {typeof runReport.run.log_path === 'string' ? (
                      <article className="source-message-card">
                        <strong>Log Path</strong>
                        <small>{runReport.run.log_path}</small>
                        <button
                          type="button"
                          className="action-button secondary"
                          onClick={() => void onCopyValue(runReport.run.log_path ?? '', 'Run log path')}
                        >
                          Copy Path
                        </button>
                      </article>
                    ) : null}
                  </div>
                  {runContextEntries.length > 0 ? (
                    <div className="context-entry-list">
                      <strong>Context Signals</strong>
                      {runContextEntries.map((entry) => (
                        <article key={entry.label} className="source-message-card">
                          <strong>{entry.label}</strong>
                          <small>{entry.value}</small>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </article>
              ) : null}
            </div>
          ) : <div className="empty-state">No active run selected.</div>}
        </div>
      ) : null}
    </aside>
  );
}

function deriveSourceMessages(
  sourceMessageIds: string[],
  messageLookup: Map<string, ConversationBundle['messages'][number]>
): ConversationBundle['messages'] {
  return sourceMessageIds
    .map((id) => messageLookup.get(id))
    .filter((item): item is ConversationBundle['messages'][number] => Boolean(item));
}

function renderMemoryNodeInspector(
  node: WorkbenchMemoryNode,
  sourceAssets: WorkbenchMemorySourceAsset[],
  onCopyValue: (value: string, label: string) => Promise<void>
) {
  return (
    <>
      <div className="list-card-top">
        <strong>Memory Detail</strong>
        <span className={node.status === 'active' ? 'badge success' : 'badge warning'}>{node.status}</span>
      </div>
      <p>{node.summary}</p>
      <div className="writeback-summary">
        <span className="badge">{node.category}</span>
        <span className="badge success">{node.soul_dimension}</span>
        <span className="badge">{Math.round(node.confidence * 100)}%</span>
        <span className="badge">{node.source_type}</span>
        <span className="badge">{node.reinforcement_count} reinforcements</span>
      </div>
      <div className="candidate-actions">
        <button
          type="button"
          className="action-button secondary"
          onClick={() => void onCopyValue(node.id, 'Memory id')}
        >
          Copy Memory Id
        </button>
        <button
          type="button"
          className="action-button secondary"
          onClick={() => void onCopyValue(node.source_chunk_id, 'Source chunk id')}
        >
          Copy Chunk Id
        </button>
        {node.source_url ? (
          <button
            type="button"
            className="action-button secondary"
            onClick={() => void onCopyValue(node.source_url ?? '', 'Source url')}
          >
            Copy Source Url
          </button>
        ) : null}
      </div>
      <div className="context-entry-list">
        <article className="source-message-card">
          <strong>Original Text</strong>
          <small>{node.original_text}</small>
        </article>
        <article className="source-message-card">
          <strong>Source Chunk</strong>
          <small>{node.source_chunk_id}</small>
        </article>
        {node.source_url ? (
          <article className="source-message-card">
            <strong>Source Url</strong>
            <small>{node.source_url}</small>
          </article>
        ) : null}
        {node.time_reference ? (
          <article className="source-message-card">
            <strong>Time Reference</strong>
            <small>{new Date(node.time_reference).toLocaleString()}</small>
          </article>
        ) : null}
      </div>
      {node.semantic_tags.length > 0 ? (
        <div className="writeback-summary">
          {node.semantic_tags.map((tag) => (
            <span key={tag} className="badge">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {node.relations.length > 0 ? (
        <div className="context-entry-list">
          <strong>Relations</strong>
          {node.relations.map((relation) => (
            <article key={`${relation.target_id}:${relation.relation_type}`} className="source-message-card">
              <strong>{relation.relation_type}</strong>
              <small>{relation.target_id}</small>
            </article>
          ))}
        </div>
      ) : null}
      <div className="context-entry-list">
        <strong>Source Assets</strong>
        {sourceAssets.map((asset, index) => (
          <article key={`${asset.kind}:${asset.id ?? asset.path ?? asset.url ?? index}`} className="source-message-card">
            <div className="list-card-top">
              <strong>{asset.title}</strong>
              <span className="badge">{asset.kind.replace(/_/g, ' ')}</span>
            </div>
            <small>{asset.summary}</small>
            {asset.preview ? (
              <article className="source-message-card compact-source-card">
                <strong>Preview</strong>
                <small>{trimPreview(asset.preview, 420)}</small>
              </article>
            ) : null}
            {asset.badges && asset.badges.length > 0 ? (
              <div className="writeback-summary">
                {asset.badges.map((badge) => (
                  <span key={badge} className="badge">
                    {badge}
                  </span>
                ))}
              </div>
            ) : null}
            {asset.metadata ? (
              <div className="context-entry-list compact-context-list">
                {Object.entries(asset.metadata).map(([key, value]) => (
                  <article key={key} className="source-message-card compact-source-card">
                    <strong>{key.replace(/_/g, ' ')}</strong>
                    <small>{value}</small>
                  </article>
                ))}
              </div>
            ) : null}
            <div className="candidate-actions">
              {asset.id ? (
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onCopyValue(asset.id ?? '', `${asset.title} id`)}
                >
                  Copy Id
                </button>
              ) : null}
              {asset.path ? (
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onCopyValue(asset.path ?? '', `${asset.title} path`)}
                >
                  Copy Path
                </button>
              ) : null}
              {asset.url ? (
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onCopyValue(asset.url ?? '', `${asset.title} url`)}
                >
                  Copy Url
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      <small>Created {new Date(node.created_at).toLocaleString()} · Updated {new Date(node.updated_at).toLocaleString()}</small>
    </>
  );
}

function trimPreview(value: string, limit = 180): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trimEnd()}...`;
}

function deriveInspectableEntries(
  input: Record<string, unknown> | null,
  excludedKeys: string[] = []
): Array<{ label: string; value: string }> {
  if (!input) return [];
  return Object.entries(input)
    .filter(([key]) => !excludedKeys.includes(key))
    .map(([key, value]) => ({
      label: key.replace(/_/g, ' '),
      value: formatInspectableValue(value),
    }))
    .filter((entry) => entry.value.length > 0);
}

function formatInspectableValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => formatInspectableValue(item)).filter(Boolean).join(', ');
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

function deriveWritebackFlow(input: {
  pendingCount: number;
  acceptedCount: number;
  readyCount: number;
  selectedHandoff: PromotionHandoff | null;
  selectedPrep: TrainingPrepArtifact | null;
}): {
  tone: 'good' | 'warning' | 'neutral';
  statusLabel: string;
  summary: string;
  actions: string[];
  stages: Array<{ label: string; status: string; tone: 'good' | 'warning' | 'neutral' }>;
} {
  const stages = [
    {
      label: 'Candidate Review',
      status: input.acceptedCount > 0 ? `${input.acceptedCount} accepted` : input.pendingCount > 0 ? `${input.pendingCount} pending` : 'not started',
      tone: input.acceptedCount > 0 ? 'good' as const : input.pendingCount > 0 ? 'warning' as const : 'neutral' as const,
    },
    {
      label: 'Promotion Queue',
      status: input.readyCount > 0 ? `${input.readyCount} ready` : 'empty',
      tone: input.readyCount > 0 ? 'good' as const : 'neutral' as const,
    },
    {
      label: 'Handoff',
      status: input.selectedHandoff ? input.selectedHandoff.status : 'none',
      tone: input.selectedHandoff?.status === 'queued' ? 'good' as const : input.selectedHandoff ? 'warning' as const : 'neutral' as const,
    },
    {
      label: 'Training Prep',
      status: input.selectedPrep ? input.selectedPrep.status : 'none',
      tone: input.selectedPrep ? 'good' as const : 'neutral' as const,
    },
  ];

  if (!input.selectedHandoff && input.readyCount === 0 && input.pendingCount > 0) {
    return {
      tone: 'warning',
      statusLabel: 'review candidates',
      summary: 'You already have candidate signals, but they still need review before this thread can move into handoff and prep.',
      actions: [
        'Accept or reject the current candidates.',
        'Queue the strongest accepted items so a handoff can be created cleanly.',
      ],
      stages,
    };
  }

  if (input.readyCount > 0 && !input.selectedHandoff) {
    return {
      tone: 'good',
      statusLabel: 'create handoff',
      summary: 'The queue is ready. This thread can move into a promotion handoff now.',
      actions: [
        'Create a handoff from the ready queue.',
        'Review the handoff summary before building training prep.',
      ],
      stages,
    };
  }

  if (input.selectedHandoff && !input.selectedPrep) {
    return {
      tone: input.selectedHandoff.status === 'queued' ? 'good' : 'neutral',
      statusLabel: input.selectedHandoff.status === 'queued' ? 'build prep' : 'review handoff',
      summary: input.selectedHandoff.status === 'queued'
        ? 'The handoff is queued and ready to become a training prep artifact.'
        : 'A handoff exists, but it should be reviewed or queued before prep creation.',
      actions: input.selectedHandoff.status === 'queued'
        ? ['Create a training prep from this handoff.', 'Attach the prep to Train when you are ready to run.']
        : ['Review the handoff content.', 'Queue it when the summary looks clean, then create training prep.'],
      stages,
    };
  }

  if (input.selectedPrep) {
    return {
      tone: 'good',
      statusLabel: 'ready for training',
      summary: 'A training prep artifact is already available for this thread.',
      actions: [
        'Use the prep artifact to populate the Train form.',
        'Run smoke first if you want a low-risk verification before a longer train run.',
      ],
      stages,
    };
  }

  return {
    tone: 'neutral',
    statusLabel: 'collect signal',
    summary: 'This thread has not moved into the writeback pipeline yet.',
    actions: [
      'Continue the conversation or import evidence to generate stronger candidates.',
      'Review the next batch of candidates once they appear.',
    ],
    stages,
  };
}
