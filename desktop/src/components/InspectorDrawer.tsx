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
import { useI18n } from '../lib/i18n';

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
  const { t } = useI18n();
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
            <p className="eyebrow">{t('Inspect')}</p>
            <h2>{t(activeTab)}</h2>
          </div>
          <button type="button" className="action-button secondary compact-action" onClick={onClose}>
            {t('Close')}
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
              {t(tab)}
            </button>
          ))}
        </div>

        <div className="inspector-drawer-body">
          {activeTab === 'Soul' ? (
            <div className="inspector-section">
              <article className="mini-card">
                <strong>{t('Core beliefs')}</strong>
                {(profile?.summary.core_beliefs ?? []).map((item) => <p key={item}>{item}</p>)}
                {!(profile?.summary.core_beliefs ?? []).length ? <small>{t('No core beliefs loaded yet.')}</small> : null}
              </article>
              <article className="mini-card">
                <strong>{t('Expert domains')}</strong>
                {(profile?.summary.expert_domains ?? []).map((item) => <p key={item}>{item}</p>)}
                {!(profile?.summary.expert_domains ?? []).length ? <small>{t('No expert domains loaded yet.')}</small> : null}
              </article>
              <article className="mini-card">
                <strong>{t('Language signals')}</strong>
                {(profile?.summary.language_style ?? []).map((item) => <p key={item}>{item}</p>)}
                {!(profile?.summary.language_style ?? []).length ? <small>{t('No language signals loaded yet.')}</small> : null}
              </article>
            </div>
          ) : null}

          {activeTab === 'Memory' ? (
            <div className="inspector-section">
              <article className="mini-card workflow-card">
                <div className="list-card-top">
                  <strong>{t('Writeback Pipeline')}</strong>
                  <span className={writebackFlow.tone === 'good' ? 'badge success' : writebackFlow.tone === 'warning' ? 'badge warning' : 'badge'}>
                    {t(writebackFlow.statusLabel)}
                  </span>
                </div>
                <p>{t(writebackFlow.summary)}</p>
                <div className="workflow-stage-grid">
                  {writebackFlow.stages.map((stage) => (
                    <div key={stage.label} className="workflow-stage-card">
                      <strong>{t(stage.label)}</strong>
                      <span className={stage.tone === 'good' ? 'badge success' : stage.tone === 'warning' ? 'badge warning' : 'badge'}>
                        {t(stage.status)}
                      </span>
                    </div>
                  ))}
                </div>
              </article>

              {(latestAssistant?.citation_items ?? []).length > 0 ? (
                <article className="mini-card">
                  <strong>{t('Retrieved on latest turn')}</strong>
                  {(latestAssistant?.citation_items ?? []).map((item) => (
                    <article key={item.id} className="source-message-card compact-source-card">
                      <div className="list-card-top">
                        <strong>{t(item.soul_dimension ?? item.category ?? 'memory')}</strong>
                        <span className="badge">{item.confidence ? `${Math.round(item.confidence * 100)}%` : t('retrieved')}</span>
                      </div>
                      <small>{item.summary}</small>
                      <div className="candidate-actions">
                        <button type="button" className="action-button secondary" onClick={() => void onInspectMemory(item.id)}>
                          {t('Inspect Memory')}
                        </button>
                      </div>
                    </article>
                  ))}
                </article>
              ) : null}

              {selectedMemoryNode ? (
                <article className="mini-card memory-node-detail-card">
                  {renderMemoryNodeInspector(selectedMemoryNode, selectedMemorySourceAssets, onCopyValue, t)}
                </article>
              ) : null}

              <div className="writeback-controls">
                <label className="field compact-field">
                  <span>{t('Status')}</span>
                  <select value={candidateFilter} onChange={(event) => setCandidateFilter(event.target.value as typeof candidateFilter)}>
                    <option value="all">{t('all')}</option>
                    <option value="pending">{t('pending')}</option>
                    <option value="accepted">{t('accepted')}</option>
                    <option value="rejected">{t('rejected')}</option>
                    <option value="ready_queue">{t('ready queue')}</option>
                  </select>
                </label>
                <label className="field compact-field">
                  <span>{t('Sort')}</span>
                  <select value={candidateSort} onChange={(event) => setCandidateSort(event.target.value as typeof candidateSort)}>
                    <option value="newest">{t('newest')}</option>
                    <option value="oldest">{t('oldest')}</option>
                    <option value="confidence_desc">{t('confidence desc')}</option>
                    <option value="confidence_asc">{t('confidence asc')}</option>
                  </select>
                </label>
              </div>

              {filteredCandidates.map((item) => (
                <article key={item.id} className="mini-card">
                  <div className="list-card-top">
                    <strong>{t(item.candidate_type)}</strong>
                    <span className="badge">{Math.round(item.confidence * 100)}%</span>
                  </div>
                  <p>{item.content}</p>
                  <small>{`${t(item.status)} · ${t('promotion')} ${t(item.promotion_state)} · ${new Date(item.created_at).toLocaleString()}`}</small>
                  {item.source_message_ids.length > 0 ? (
                    <div className="source-link-list">
                      {deriveSourceMessages(item.source_message_ids, messageLookup).map((message) => (
                        <article key={message.id} className="source-message-card">
                          <strong>{message.role === 'assistant' ? t('assistant') : t('user')}</strong>
                          <small>{trimPreview(message.content)}</small>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  <div className="candidate-actions">
                    <button type="button" className="action-button secondary" disabled={item.status === 'accepted'} onClick={() => void onReviewCandidate(item.id, 'accepted')}>
                      {t('Accept')}
                    </button>
                    <button type="button" className="action-button secondary" disabled={item.status === 'pending'} onClick={() => void onReviewCandidate(item.id, 'pending')}>
                      {t('Reset')}
                    </button>
                    <button type="button" className="action-button danger" disabled={item.status === 'rejected'} onClick={() => void onReviewCandidate(item.id, 'rejected')}>
                      {t('Reject')}
                    </button>
                    <button type="button" className="action-button secondary" disabled={item.status !== 'accepted' || item.promotion_state === 'ready'} onClick={() => void onSetCandidatePromotionState(item.id, 'ready')}>
                      {t('Queue')}
                    </button>
                    <button type="button" className="action-button secondary" disabled={item.promotion_state === 'idle'} onClick={() => void onSetCandidatePromotionState(item.id, 'idle')}>
                      {t('Clear')}
                    </button>
                  </div>
                </article>
              ))}

              <div className="candidate-actions">
                <button type="button" className="action-button" disabled={readyCount === 0} onClick={() => void onCreatePromotionHandoff()}>
                  {t('Create Handoff')}
                </button>
              </div>

              {selectedHandoff ? (
                <article className="mini-card">
                  <div className="list-card-top">
                    <strong>{t('Selected handoff')}</strong>
                    <span className={selectedHandoff.status === 'queued' ? 'badge success' : 'badge'}>{t(selectedHandoff.status)}</span>
                  </div>
                  <p>{selectedHandoff.summary}</p>
                  {selectedHandoff.session_summary ? <small>{selectedHandoff.session_summary}</small> : null}
                  <div className="candidate-actions">
                    <button type="button" className="action-button secondary" disabled={selectedHandoff.status === 'queued'} onClick={() => void onUpdatePromotionHandoff(selectedHandoff.id, 'queued')}>
                      {t('Queue')}
                    </button>
                    <button type="button" className="action-button secondary" disabled={selectedHandoff.status === 'drafted'} onClick={() => void onUpdatePromotionHandoff(selectedHandoff.id, 'drafted')}>
                      {t('Reopen')}
                    </button>
                    <button type="button" className="action-button danger" disabled={selectedHandoff.status === 'archived'} onClick={() => void onUpdatePromotionHandoff(selectedHandoff.id, 'archived')}>
                      {t('Archive')}
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onExportPromotionHandoff(selectedHandoff.id, 'markdown')}>
                      {t('Copy Markdown')}
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onExportPromotionHandoff(selectedHandoff.id, 'json')}>
                      {t('Copy JSON')}
                    </button>
                    <button type="button" className="action-button" onClick={() => void onCreateTrainingPrep(selectedHandoff.id)}>
                      {t('Create Prep')}
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
                      <strong>{t(handoff.status)}</strong>
                      <p>{handoff.summary}</p>
                    </button>
                  ))}
                </div>
              ) : null}

              {selectedPrep ? (
                <article className="mini-card">
                  <div className="list-card-top">
                    <strong>{t('Training prep')}</strong>
                    <span className="badge success">{t(selectedPrep.status)}</span>
                  </div>
                  <p>{selectedPrep.summary}</p>
                  <code>{selectedPrep.documents_path}</code>
                  <code>{selectedPrep.evidence_index_path}</code>
                  <div className="candidate-actions">
                    <button type="button" className="action-button" onClick={() => onUseTrainingPrep(selectedPrep)}>
                      {t('Use For Training')}
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onExportTrainingPrep(selectedPrep.id, 'markdown')}>
                      {t('Copy Markdown')}
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onExportTrainingPrep(selectedPrep.id, 'json')}>
                      {t('Copy JSON')}
                    </button>
                  </div>
                </article>
              ) : null}
              {candidates.length === 0 ? <div className="empty-state">{t('No memory candidates yet.')}</div> : null}
            </div>
          ) : null}

          {activeTab === 'Citations' ? (
            <div className="inspector-section">
              {(latestAssistant?.citation_items ?? []).map((item) => (
                <article key={item.id} className="mini-card">
                  <div className="list-card-top">
                    <strong>{item.id}</strong>
                    <span className="badge">{item.confidence ? `${Math.round(item.confidence * 100)}%` : t('retrieved')}</span>
                  </div>
                  <p>{item.summary}</p>
                  <small>{t(item.category ?? 'memory')} · {t(item.soul_dimension ?? 'general')}</small>
                  <div className="candidate-actions">
                    <button type="button" className="action-button secondary" onClick={() => void onCopyValue(item.id, 'Citation id')}>
                      {t('Copy Id')}
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onInspectMemory(item.id)}>
                      {t('Inspect Memory')}
                    </button>
                  </div>
                </article>
              ))}
              {selectedMemoryNode ? (
                <article className="mini-card memory-node-detail-card">
                  {renderMemoryNodeInspector(selectedMemoryNode, selectedMemorySourceAssets, onCopyValue, t)}
                </article>
              ) : null}
              {!(latestAssistant?.citation_items ?? []).length ? <div className="empty-state">{t('No citations for the current thread yet.')}</div> : null}
            </div>
          ) : null}

          {activeTab === 'Evidence' ? (
            <div className="inspector-section">
              {selectedEvidenceImport ? (
                <article className="mini-card evidence-import-detail">
                  <div className="list-card-top">
                    <strong>{`${t(selectedEvidenceImport.source_kind)} ${t('Evidence Intake')}`}</strong>
                    <span className="badge">{selectedEvidenceImport.item_count} {t('items')}</span>
                  </div>
                  <p>{selectedEvidenceImport.summary}</p>
                  <div className="writeback-summary">
                    <span className="badge">{selectedEvidenceImport.stats.sessions} {t('sessions')}</span>
                    <span className="badge">{selectedEvidenceImport.stats.windows} {t('windows')}</span>
                    <span className="badge success">{selectedEvidenceImport.stats.cross_session_stable_items} {t('stable')}</span>
                    <span className="badge warning">{selectedEvidenceImport.stats.blocked_scene_items} {t('blocked')}</span>
                  </div>
                  <div className="candidate-actions">
                    <button type="button" className="action-button" onClick={() => onUseEvidenceImport(selectedEvidenceImport)}>
                      {t('Use For Training')}
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onCopyValue(selectedEvidenceImport.artifacts.documents_path, 'Evidence documents path')}>
                      {t('Copy Docs Path')}
                    </button>
                    <button type="button" className="action-button secondary" onClick={() => void onCopyValue(selectedEvidenceImport.artifacts.evidence_index_path, 'Evidence index path')}>
                      {t('Copy Evidence Path')}
                    </button>
                  </div>
                  <code>{selectedEvidenceImport.artifacts.documents_path}</code>
                  <code>{selectedEvidenceImport.artifacts.evidence_index_path}</code>
                  {evidenceDetail?.manifest ? (
                    <article className="workflow-card">
                      <div className="list-card-top">
                        <strong>{t('Target manifest')}</strong>
                        {evidenceDetail.manifest.default_scene ? <span className="badge">{t(evidenceDetail.manifest.default_scene)}</span> : null}
                      </div>
                      <p>{evidenceDetail.manifest.target_name}</p>
                      <small>{[...evidenceDetail.manifest.target_aliases, ...evidenceDetail.manifest.self_aliases].slice(0, 6).join(' · ') || t('No aliases listed.')}</small>
                    </article>
                  ) : null}
                  {evidenceDetail?.sample_items.length ? (
                    <div className="evidence-preview-list single-column">
                      {evidenceDetail.sample_items.map((item) => (
                        <article key={item.id} className="mini-card evidence-preview-card">
                          <div className="list-card-top">
                            <strong>{item.speaker_name}</strong>
                            <span className="badge">{t(item.window_role)}</span>
                          </div>
                          <div className="writeback-summary">
                            <span className={item.speaker_role === 'target' ? 'badge success' : 'badge'}>{t(item.speaker_role)}</span>
                            <span className={item.scene === 'public' || item.scene === 'work' ? 'badge success' : item.scene === 'intimate' || item.scene === 'conflict' ? 'badge warning' : 'badge'}>{t(item.scene)}</span>
                            <span className="badge">{t(item.evidence_kind)}</span>
                            {item.stability_hints.cross_session_stable ? <span className="badge success">{t('stable')}</span> : null}
                          </div>
                          <p>{item.content}</p>
                          {item.context_before.length > 0 ? <small>{t('before')}: {item.context_before.map((ctx) => `${ctx.speaker_name}: ${ctx.content}`).join(' / ')}</small> : null}
                          {item.context_after.length > 0 ? <small>{t('after')}: {item.context_after.map((ctx) => `${ctx.speaker_name}: ${ctx.content}`).join(' / ')}</small> : null}
                        </article>
                      ))}
                    </div>
                  ) : null}
                </article>
              ) : (
                <div className="empty-state">{t('No evidence intake is attached to this thread yet.')}</div>
              )}

              {evidenceImports.length > 0 ? (
                <div className="context-entry-list">
                  {evidenceImports.map((item) => (
                    <article key={item.id} className={selectedEvidenceImport?.id === item.id ? 'mini-card active-card' : 'mini-card'}>
                      <div className="list-card-top">
                        <strong>{t(item.source_kind)}</strong>
                        <span className="badge">{item.item_count} {t('items')}</span>
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
                          {t('Inspect')}
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
                    <strong>{t(run.type)}</strong>
                  <p>{run.summary ?? run.status}</p>
                  <small>{new Date(run.started_at).toLocaleString()}</small>
                </button>
              ))}
              {runReport ? (
                <div className="training-card-stack">
                  <article className="mini-card training-overview-card">
                    <div className="list-card-top">
                  <strong>{t(runReport.run.type)}</strong>
                      <span className={runReport.run.status === 'completed' ? 'badge success' : runReport.run.status === 'failed' ? 'badge warning' : 'badge'}>
                        {t(runPresentation.statusLabel)}
                      </span>
                    </div>
                    <p>{t(runPresentation.primaryMessage)}</p>
                    <div className="writeback-summary">
                      {runPresentation.track ? <span className="badge">{t(runPresentation.track)}</span> : null}
                      {runPresentation.phase ? <span className="badge">{t(runPresentation.phase)}</span> : null}
                      {runPresentation.isSmoke ? <span className="badge success">{t('Run Smoke')}</span> : null}
                    </div>
                  </article>
                  {runSummary ? (
                    <article className="mini-card training-summary-card">
                      <strong>{t('Report Snapshot')}</strong>
                      <div className="evidence-metric-grid single-column">
                        {runSummary.map((item) => (
                          <div key={item.label} className="metric-group">
                          <strong>{t(item.label)}</strong>
                            <span>{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ) : null}
                  {prepContext ? (
                    <article className="mini-card training-prep-card">
                      <strong>{t('Prep Context')}</strong>
                      {typeof prepContext.prep_documents_path === 'string' ? <code>{prepContext.prep_documents_path}</code> : null}
                      {typeof prepContext.prep_evidence_path === 'string' ? <code>{prepContext.prep_evidence_path}</code> : null}
                      {selectedRunPrep ? (
                        <div className="candidate-actions">
                          <button type="button" className="action-button secondary" onClick={() => onUseTrainingPrep(selectedRunPrep)}>
                            {t('Use Linked Prep')}
                          </button>
                        </div>
                      ) : null}
                      {selectedRunEvidenceImport ? (
                        <article className="workflow-card">
                          <div className="list-card-top">
                            <strong>{t('Linked Evidence Import')}</strong>
                            <span className="badge">{t(selectedRunEvidenceImport.source_kind)}</span>
                          </div>
                          <p>{selectedRunEvidenceImport.summary}</p>
                        </article>
                      ) : null}
                    </article>
                  ) : null}
                  <article className="mini-card training-log-card">
                    <strong>{t('Run Detail')}</strong>
                    {runReport.run.command.length > 0 ? <code>{runReport.run.command.join(' ')}</code> : null}
                    {runReport.run.report_path ? <code>{runReport.run.report_path}</code> : null}
                    {runReport.context_path ? <code>{runReport.context_path}</code> : null}
                    {runContextEntries.length > 0 ? (
                      <div className="context-entry-list">
                        {runContextEntries.map((entry) => (
                          <article key={entry.label} className="source-message-card">
                            <strong>{t(entry.label)}</strong>
                            <small>{entry.value}</small>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </article>
                </div>
              ) : <div className="empty-state">{t('No active run selected.')}</div>}
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
  onCopyValue: (value: string, label: string) => Promise<void>,
  t: (value: string) => string
) {
  return (
    <>
      <div className="list-card-top">
        <strong>{t('Memory Detail')}</strong>
        <span className={node.status === 'active' ? 'badge success' : 'badge warning'}>{t(node.status)}</span>
      </div>
      <p>{node.summary}</p>
      <div className="writeback-summary">
        <span className="badge">{t(node.category)}</span>
        <span className="badge success">{t(node.soul_dimension)}</span>
        <span className="badge">{Math.round(node.confidence * 100)}%</span>
        <span className="badge">{t(node.source_type)}</span>
      </div>
      <div className="candidate-actions">
        <button type="button" className="action-button secondary" onClick={() => void onCopyValue(node.id, 'Memory id')}>
          {t('Copy Memory Id')}
        </button>
        <button type="button" className="action-button secondary" onClick={() => void onCopyValue(node.source_chunk_id, 'Source chunk id')}>
          {t('Copy Chunk Id')}
        </button>
      </div>
      <div className="context-entry-list">
        <article className="source-message-card">
          <strong>{t('Original Text')}</strong>
          <small>{node.original_text}</small>
        </article>
        {sourceAssets.map((asset, index) => (
          <article key={`${asset.kind}:${asset.id ?? asset.path ?? asset.url ?? index}`} className="source-message-card">
            <div className="list-card-top">
              <strong>{asset.title}</strong>
              <span className="badge">{t(asset.kind.replace(/_/g, ' '))}</span>
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
      ? 'Saved progress is being reused during automatic recovery.'
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
