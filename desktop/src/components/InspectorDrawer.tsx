import { useMemo, useState } from 'react';
import {
  ConversationBundle,
  InfoTab,
  MemoryCandidate,
  PersonaWorkbenchProfile,
  PromotionHandoff,
  TrainingPrepArtifact,
  WorkbenchEvidenceImport,
  WorkbenchEvidenceImportDetail,
  WorkbenchMemoryNode,
  WorkbenchMemorySourceAsset,
  WorkbenchRun,
  WorkbenchRunReport,
} from '../lib/types';

const TABS: InfoTab[] = ['Soul', 'Memory', 'Citations', 'Evidence', 'Training'];

interface InspectorDrawerProps {
  open: boolean;
  activeTab: InfoTab;
  onTabChange: (tab: InfoTab) => void;
  onClose: () => void;
  profile: PersonaWorkbenchProfile | null;
  bundle: ConversationBundle | null;
  candidates: MemoryCandidate[];
  evidenceImports: WorkbenchEvidenceImport[];
  selectedEvidenceImportId: string | null;
  selectedEvidenceImportDetail: WorkbenchEvidenceImportDetail | null;
  selectedMemoryNode: WorkbenchMemoryNode | null;
  selectedMemorySourceAssets: WorkbenchMemorySourceAsset[];
  promotionHandoffs: PromotionHandoff[];
  trainingPreps: TrainingPrepArtifact[];
  recentRuns: WorkbenchRun[];
  currentRunId: string | null;
  onSelectRun: (run: WorkbenchRun) => Promise<void>;
  onInspectMemory: (memoryId: string) => Promise<void>;
  onInspectEvidenceImport: (importId: string) => Promise<void>;
  onSelectEvidenceImport: (importId: string) => void;
  onReviewCandidate: (candidateId: string, status: MemoryCandidate['status']) => Promise<void>;
  onSetCandidatePromotionState: (candidateId: string, promotionState: MemoryCandidate['promotion_state']) => Promise<void>;
  onCreatePromotionHandoff: () => Promise<void>;
  onUpdatePromotionHandoff: (handoffId: string, status: PromotionHandoff['status']) => Promise<void>;
  onExportPromotionHandoff: (handoffId: string, format: 'markdown' | 'json') => Promise<void>;
  onCreateTrainingPrep: (handoffId: string) => Promise<void>;
  onExportTrainingPrep: (prepId: string, format: 'markdown' | 'json') => Promise<void>;
  onCopyValue: (value: string, label: string) => Promise<void>;
  onUseTrainingPrep: (prep: TrainingPrepArtifact) => void;
  onUseEvidenceImport: (item: WorkbenchEvidenceImport) => void;
  runReport: WorkbenchRunReport | null;
}

export function InspectorDrawer({
  open,
  activeTab,
  onTabChange,
  onClose,
  profile,
  bundle,
  candidates,
  evidenceImports,
  selectedEvidenceImportId,
  selectedEvidenceImportDetail,
  selectedMemoryNode,
  selectedMemorySourceAssets,
  promotionHandoffs,
  trainingPreps,
  recentRuns,
  currentRunId,
  onSelectRun,
  onInspectMemory,
  onInspectEvidenceImport,
  onSelectEvidenceImport,
  onReviewCandidate,
  onSetCandidatePromotionState,
  onCreatePromotionHandoff,
  onUpdatePromotionHandoff,
  onExportPromotionHandoff,
  onCreateTrainingPrep,
  onExportTrainingPrep,
  onCopyValue,
  onUseTrainingPrep,
  onUseEvidenceImport,
  runReport,
}: InspectorDrawerProps) {
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
  const selectedEvidenceImport = evidenceImports.find((item) => item.id === selectedEvidenceImportId) ?? evidenceImports[0] ?? null;
  const evidenceDetail = selectedEvidenceImportDetail && selectedEvidenceImportDetail.import.id === selectedEvidenceImport?.id
    ? selectedEvidenceImportDetail
    : null;
  const messageLookup = useMemo(() => new Map((bundle?.messages ?? []).map((item) => [item.id, item])), [bundle?.messages]);
  const filteredCandidates = useMemo(() => {
    const base =
      candidateFilter === 'all'
        ? [...candidates]
        : candidateFilter === 'ready_queue'
          ? candidates.filter((item) => item.promotion_state === 'ready')
          : candidates.filter((item) => item.status === candidateFilter);
    if (candidateSort === 'oldest') return base.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (candidateSort === 'confidence_desc') return base.sort((a, b) => b.confidence - a.confidence);
    if (candidateSort === 'confidence_asc') return base.sort((a, b) => a.confidence - b.confidence);
    return base.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [candidateFilter, candidateSort, candidates]);

  const runContext = runReport?.context && typeof runReport.context === 'object'
    ? runReport.context as Record<string, unknown>
    : null;
  const prepContext = runContext?.prep_context && typeof runContext.prep_context === 'object'
    ? runContext.prep_context as Record<string, unknown>
    : null;
  const runPresentation = deriveRunPresentation(runReport);
  const runSummary = deriveRunSummary(runReport?.report);
  const runContextEntries = deriveInspectableEntries(runContext, ['prep_context']);
  const selectedRunPrep = typeof prepContext?.prep_artifact_id === 'string'
    ? trainingPreps.find((item) => item.id === prepContext.prep_artifact_id) ?? null
    : null;
  const selectedRunEvidenceImport = typeof prepContext?.evidence_import_id === 'string'
    ? evidenceImports.find((item) => item.id === prepContext.evidence_import_id) ?? null
    : null;
  const writebackFlow = deriveWritebackFlow({ pendingCount, acceptedCount, readyCount, selectedHandoff, selectedPrep });

  return (
    <>
      <div className={open ? 'inspector-backdrop active' : 'inspector-backdrop'} onClick={onClose} />
      <aside className={open ? 'inspector-drawer panel open' : 'inspector-drawer panel'}>
        <div className="inspector-drawer-header">
          <div>
            <p className="eyebrow">Inspect</p>
            <h2>{activeTab}</h2>
          </div>
          <button type="button" className="action-button secondary compact-action" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="tab-row drawer-tabs">
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

        <div className="inspector-drawer-body">
          {activeTab === 'Soul' ? (
            <div className="inspector-section">
              <article className="mini-card">
                <strong>Core beliefs</strong>
                {(profile?.summary.core_beliefs ?? []).map((item) => <p key={item}>{item}</p>)}
                {!(profile?.summary.core_beliefs ?? []).length ? <small>No core beliefs loaded yet.</small> : null}
              </article>
              <article className="mini-card">
                <strong>Expert domains</strong>
                {(profile?.summary.expert_domains ?? []).map((item) => <p key={item}>{item}</p>)}
                {!(profile?.summary.expert_domains ?? []).length ? <small>No expert domains loaded yet.</small> : null}
              </article>
              <article className="mini-card">
                <strong>Language signals</strong>
                {(profile?.summary.language_style ?? []).map((item) => <p key={item}>{item}</p>)}
                {!(profile?.summary.language_style ?? []).length ? <small>No language signals loaded yet.</small> : null}
              </article>
            </div>
          ) : null}

          {activeTab === 'Memory' ? (
            <div className="inspector-section">
              <article className="mini-card workflow-card">
                <div className="list-card-top">
                  <strong>Writeback Pipeline</strong>
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
              </article>

              {(latestAssistant?.citation_items ?? []).length > 0 ? (
                <article className="mini-card">
                  <strong>Retrieved on latest turn</strong>
                  {(latestAssistant?.citation_items ?? []).map((item) => (
                    <article key={item.id} className="source-message-card compact-source-card">
                      <div className="list-card-top">
                        <strong>{item.soul_dimension ?? item.category ?? 'memory'}</strong>
                        <span className="badge">{item.confidence ? `${Math.round(item.confidence * 100)}%` : 'retrieved'}</span>
                      </div>
                      <small>{item.summary}</small>
                      <div className="candidate-actions">
                        <button type="button" className="action-button secondary" onClick={() => void onInspectMemory(item.id)}>
                          Inspect Memory
                        </button>
                      </div>
                    </article>
                  ))}
                </article>
              ) : null}

              {selectedMemoryNode ? (
                <article className="mini-card memory-node-detail-card">
                  {renderMemoryNodeInspector(selectedMemoryNode, selectedMemorySourceAssets, onCopyValue)}
                </article>
              ) : null}

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
                  <div className="list-card-top">
                    <strong>{item.candidate_type}</strong>
                    <span className="badge">{Math.round(item.confidence * 100)}%</span>
                  </div>
                  <p>{item.content}</p>
                  <small>{item.status} · promo {item.promotion_state} · {new Date(item.created_at).toLocaleString()}</small>
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
                    <button type="button" className="action-button secondary" disabled={item.status === 'accepted'} onClick={() => void onReviewCandidate(item.id, 'accepted')}>
                      Accept
                    </button>
                    <button type="button" className="action-button secondary" disabled={item.status === 'pending'} onClick={() => void onReviewCandidate(item.id, 'pending')}>
                      Reset
                    </button>
                    <button type="button" className="action-button danger" disabled={item.status === 'rejected'} onClick={() => void onReviewCandidate(item.id, 'rejected')}>
                      Reject
                    </button>
                    <button type="button" className="action-button secondary" disabled={item.status !== 'accepted' || item.promotion_state === 'ready'} onClick={() => void onSetCandidatePromotionState(item.id, 'ready')}>
                      Queue
                    </button>
                    <button type="button" className="action-button secondary" disabled={item.promotion_state === 'idle'} onClick={() => void onSetCandidatePromotionState(item.id, 'idle')}>
                      Clear
                    </button>
                  </div>
                </article>
              ))}

              <div className="candidate-actions">
                <button type="button" className="action-button" disabled={readyCount === 0} onClick={() => void onCreatePromotionHandoff()}>
                  Create Handoff
                </button>
              </div>

              {selectedHandoff ? (
                <article className="mini-card">
                  <div className="list-card-top">
                    <strong>Selected handoff</strong>
                    <span className={selectedHandoff.status === 'queued' ? 'badge success' : 'badge'}>{selectedHandoff.status}</span>
                  </div>
                  <p>{selectedHandoff.summary}</p>
                  {selectedHandoff.session_summary ? <small>{selectedHandoff.session_summary}</small> : null}
                  <div className="candidate-actions">
                    <button type="button" className="action-button secondary" disabled={selectedHandoff.status === 'queued'} onClick={() => void onUpdatePromotionHandoff(selectedHandoff.id, 'queued')}>
                      Queue
                    </button>
                    <button type="button" className="action-button secondary" disabled={selectedHandoff.status === 'drafted'} onClick={() => void onUpdatePromotionHandoff(selectedHandoff.id, 'drafted')}>
                      Reopen
                    </button>
                    <button type="button" className="action-button danger" disabled={selectedHandoff.status === 'archived'} onClick={() => void onUpdatePromotionHandoff(selectedHandoff.id, 'archived')}>
                      Archive
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onExportPromotionHandoff(selectedHandoff.id, 'markdown')}>
                      Copy Markdown
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onExportPromotionHandoff(selectedHandoff.id, 'json')}>
                      Copy JSON
                    </button>
                    <button type="button" className="action-button" onClick={() => void onCreateTrainingPrep(selectedHandoff.id)}>
                      Create Prep
                    </button>
                  </div>
                </article>
              ) : null}

              {promotionHandoffs.length > 1 ? (
                <div className="context-entry-list">
                  {promotionHandoffs.slice(0, 6).map((handoff) => (
                    <button
                      key={handoff.id}
                      type="button"
                      className={selectedHandoff?.id === handoff.id ? 'mini-card active-card' : 'mini-card'}
                      onClick={() => setSelectedHandoffId(handoff.id)}
                    >
                      <strong>{handoff.status}</strong>
                      <p>{handoff.summary}</p>
                    </button>
                  ))}
                </div>
              ) : null}

              {selectedPrep ? (
                <article className="mini-card">
                  <div className="list-card-top">
                    <strong>Training prep</strong>
                    <span className="badge success">{selectedPrep.status}</span>
                  </div>
                  <p>{selectedPrep.summary}</p>
                  <code>{selectedPrep.documents_path}</code>
                  <code>{selectedPrep.evidence_index_path}</code>
                  <div className="candidate-actions">
                    <button type="button" className="action-button" onClick={() => onUseTrainingPrep(selectedPrep)}>
                      Use For Training
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onExportTrainingPrep(selectedPrep.id, 'markdown')}>
                      Copy Markdown
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onExportTrainingPrep(selectedPrep.id, 'json')}>
                      Copy JSON
                    </button>
                  </div>
                </article>
              ) : null}
              {candidates.length === 0 ? <div className="empty-state">No memory candidates yet.</div> : null}
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
                  <div className="candidate-actions">
                    <button type="button" className="action-button secondary" onClick={() => void onCopyValue(item.id, 'Citation id')}>
                      Copy Id
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onInspectMemory(item.id)}>
                      Inspect Memory
                    </button>
                  </div>
                </article>
              ))}
              {selectedMemoryNode ? (
                <article className="mini-card memory-node-detail-card">
                  {renderMemoryNodeInspector(selectedMemoryNode, selectedMemorySourceAssets, onCopyValue)}
                </article>
              ) : null}
              {!(latestAssistant?.citation_items ?? []).length ? <div className="empty-state">No citations for the current thread yet.</div> : null}
            </div>
          ) : null}

          {activeTab === 'Evidence' ? (
            <div className="inspector-section">
              {selectedEvidenceImport ? (
                <article className="mini-card evidence-import-detail">
                  <div className="list-card-top">
                    <strong>{selectedEvidenceImport.source_kind} intake</strong>
                    <span className="badge">{selectedEvidenceImport.item_count} items</span>
                  </div>
                  <p>{selectedEvidenceImport.summary}</p>
                  <div className="writeback-summary">
                    <span className="badge">{selectedEvidenceImport.stats.sessions} sessions</span>
                    <span className="badge">{selectedEvidenceImport.stats.windows} windows</span>
                    <span className="badge success">{selectedEvidenceImport.stats.cross_session_stable_items} stable</span>
                    <span className="badge warning">{selectedEvidenceImport.stats.blocked_scene_items} blocked</span>
                  </div>
                  <div className="candidate-actions">
                    <button type="button" className="action-button" onClick={() => onUseEvidenceImport(selectedEvidenceImport)}>
                      Use For Training
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onCopyValue(selectedEvidenceImport.artifacts.documents_path, 'Evidence documents path')}>
                      Copy Docs Path
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onCopyValue(selectedEvidenceImport.artifacts.evidence_index_path, 'Evidence index path')}>
                      Copy Evidence Path
                    </button>
                  </div>
                  <code>{selectedEvidenceImport.artifacts.documents_path}</code>
                  <code>{selectedEvidenceImport.artifacts.evidence_index_path}</code>
                  {evidenceDetail?.manifest ? (
                    <article className="workflow-card">
                      <div className="list-card-top">
                        <strong>Target manifest</strong>
                        {evidenceDetail.manifest.default_scene ? <span className="badge">{evidenceDetail.manifest.default_scene}</span> : null}
                      </div>
                      <p>{evidenceDetail.manifest.target_name}</p>
                      <small>{[...evidenceDetail.manifest.target_aliases, ...evidenceDetail.manifest.self_aliases].slice(0, 6).join(' · ') || 'No aliases listed.'}</small>
                    </article>
                  ) : null}
                  {evidenceDetail?.sample_items.length ? (
                    <div className="evidence-preview-list single-column">
                      {evidenceDetail.sample_items.map((item) => (
                        <article key={item.id} className="mini-card evidence-preview-card">
                          <div className="list-card-top">
                            <strong>{item.speaker_name}</strong>
                            <span className="badge">{item.window_role}</span>
                          </div>
                          <div className="writeback-summary">
                            <span className={item.speaker_role === 'target' ? 'badge success' : 'badge'}>{item.speaker_role}</span>
                            <span className={item.scene === 'public' || item.scene === 'work' ? 'badge success' : item.scene === 'intimate' || item.scene === 'conflict' ? 'badge warning' : 'badge'}>{item.scene}</span>
                            <span className="badge">{item.evidence_kind}</span>
                            {item.stability_hints.cross_session_stable ? <span className="badge success">stable</span> : null}
                          </div>
                          <p>{item.content}</p>
                          {item.context_before.length > 0 ? <small>before: {item.context_before.map((ctx) => `${ctx.speaker_name}: ${ctx.content}`).join(' / ')}</small> : null}
                          {item.context_after.length > 0 ? <small>after: {item.context_after.map((ctx) => `${ctx.speaker_name}: ${ctx.content}`).join(' / ')}</small> : null}
                        </article>
                      ))}
                    </div>
                  ) : null}
                </article>
              ) : (
                <div className="empty-state">No evidence intake is attached to this thread yet.</div>
              )}

              {evidenceImports.length > 0 ? (
                <div className="context-entry-list">
                  {evidenceImports.map((item) => (
                    <article key={item.id} className={selectedEvidenceImport?.id === item.id ? 'mini-card active-card' : 'mini-card'}>
                      <div className="list-card-top">
                        <strong>{item.source_kind}</strong>
                        <span className="badge">{item.item_count} items</span>
                      </div>
                      <p>{item.summary}</p>
                      <small>{new Date(item.updated_at).toLocaleString()}</small>
                      <div className="candidate-actions">
                        <button
                          type="button"
                          className="action-button secondary"
                          onClick={() => {
                            onSelectEvidenceImport(item.id);
                            void onInspectEvidenceImport(item.id);
                          }}
                        >
                          Inspect
                        </button>
                      </div>
                    </article>
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
                    </div>
                  </article>
                  {runSummary ? (
                    <article className="mini-card training-summary-card">
                      <strong>Report Snapshot</strong>
                      <div className="evidence-metric-grid single-column">
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
                      {selectedRunPrep ? (
                        <div className="candidate-actions">
                          <button type="button" className="action-button secondary" onClick={() => onUseTrainingPrep(selectedRunPrep)}>
                            Use Linked Prep
                          </button>
                        </div>
                      ) : null}
                      {selectedRunEvidenceImport ? (
                        <article className="workflow-card">
                          <div className="list-card-top">
                            <strong>Linked Evidence Import</strong>
                            <span className="badge">{selectedRunEvidenceImport.source_kind}</span>
                          </div>
                          <p>{selectedRunEvidenceImport.summary}</p>
                        </article>
                      ) : null}
                    </article>
                  ) : null}
                  <article className="mini-card training-log-card">
                    <strong>Run Detail</strong>
                    {runReport.run.command.length > 0 ? <code>{runReport.run.command.join(' ')}</code> : null}
                    {runReport.run.report_path ? <code>{runReport.run.report_path}</code> : null}
                    {runReport.context_path ? <code>{runReport.context_path}</code> : null}
                    {runContextEntries.length > 0 ? (
                      <div className="context-entry-list">
                        {runContextEntries.map((entry) => (
                          <article key={entry.label} className="source-message-card">
                            <strong>{entry.label}</strong>
                            <small>{entry.value}</small>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </article>
                </div>
              ) : <div className="empty-state">No active run selected.</div>}
            </div>
          ) : null}
        </div>
      </aside>
    </>
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
      </div>
      <div className="candidate-actions">
        <button type="button" className="action-button secondary" onClick={() => void onCopyValue(node.id, 'Memory id')}>
          Copy Memory Id
        </button>
        <button type="button" className="action-button secondary" onClick={() => void onCopyValue(node.source_chunk_id, 'Source chunk id')}>
          Copy Chunk Id
        </button>
      </div>
      <div className="context-entry-list">
        <article className="source-message-card">
          <strong>Original Text</strong>
          <small>{node.original_text}</small>
        </article>
        {sourceAssets.map((asset, index) => (
          <article key={`${asset.kind}:${asset.id ?? asset.path ?? asset.url ?? index}`} className="source-message-card">
            <div className="list-card-top">
              <strong>{asset.title}</strong>
              <span className="badge">{asset.kind.replace(/_/g, ' ')}</span>
            </div>
            <small>{asset.summary}</small>
          </article>
        ))}
      </div>
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

  const statusLabel = recoveryState === 'recovering'
    ? 'recovering'
    : status === 'completed'
      ? 'completed'
      : status === 'failed'
        ? 'paused'
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

  return { track, phase, isSmoke, statusLabel, primaryMessage, secondaryMessage };
}

function deriveRunSummary(report: unknown): Array<{ label: string; value: string }> | null {
  if (!report || typeof report !== 'object') return null;
  const data = report as Record<string, unknown>;
  const summary = data.summary && typeof data.summary === 'object' ? data.summary as Record<string, unknown> : null;
  const totalRounds = typeof data.total_rounds === 'number' ? data.total_rounds : null;
  if (!summary && totalRounds === null) return null;

  const items: Array<{ label: string; value: string }> = [];
  if (totalRounds !== null) items.push({ label: 'Rounds', value: String(totalRounds) });
  if (typeof summary?.avg_quality_score === 'number') items.push({ label: 'Avg Quality', value: `${(summary.avg_quality_score * 100).toFixed(1)}%` });
  if (typeof summary?.avg_contradiction_rate === 'number') items.push({ label: 'Contradiction', value: `${(summary.avg_contradiction_rate * 100).toFixed(1)}%` });
  if (typeof summary?.avg_duplication_rate === 'number') items.push({ label: 'Duplication', value: `${(summary.avg_duplication_rate * 100).toFixed(1)}%` });
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

  if (input.readyCount > 0 && !input.selectedHandoff) {
    return {
      tone: 'good',
      statusLabel: 'create handoff',
      summary: 'The queue is ready. This thread can move into a promotion handoff now.',
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
      stages,
    };
  }
  if (input.selectedPrep) {
    return {
      tone: 'good',
      statusLabel: 'ready for training',
      summary: 'A training prep artifact is already available for this thread.',
      stages,
    };
  }
  return {
    tone: input.pendingCount > 0 ? 'warning' : 'neutral',
    statusLabel: input.pendingCount > 0 ? 'review candidates' : 'collect signal',
    summary: input.pendingCount > 0
      ? 'You already have candidate signals, but they still need review before this thread can move forward.'
      : 'This thread has not moved into the writeback pipeline yet.',
    stages,
  };
}
