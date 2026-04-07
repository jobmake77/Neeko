import { FormEvent, KeyboardEvent, useMemo, useState } from 'react';
import { ConversationBundle, WorkbenchEvidenceImport, WorkbenchEvidenceImportDetail } from '../lib/types';

interface ChatWorkspaceProps {
  bundle: ConversationBundle | null;
  loading: boolean;
  personaSlug: string | null;
  evidenceImports: WorkbenchEvidenceImport[];
  selectedEvidenceImportDetail: WorkbenchEvidenceImportDetail | null;
  importLoading: boolean;
  notice: string | null;
  onSend: (message: string) => Promise<void>;
  onCopyMessage: (content: string) => Promise<void>;
  onCopyValue: (value: string, label: string) => Promise<void>;
  onUseEvidenceImport: (item: WorkbenchEvidenceImport) => void;
  onInspectEvidenceImport: (importId: string) => Promise<void>;
  onImportEvidence: (payload: {
    sourceKind: 'chat' | 'video';
    sourcePath: string;
    targetManifestPath: string;
    chatPlatform?: 'wechat' | 'feishu';
  }) => Promise<void>;
}

export function ChatWorkspace({
  bundle,
  loading,
  personaSlug,
  evidenceImports,
  selectedEvidenceImportDetail,
  importLoading,
  notice,
  onSend,
  onCopyMessage,
  onCopyValue,
  onUseEvidenceImport,
  onInspectEvidenceImport,
  onImportEvidence,
}: ChatWorkspaceProps) {
  const [message, setMessage] = useState('');
  const [sourceKind, setSourceKind] = useState<'chat' | 'video'>('chat');
  const [chatPlatform, setChatPlatform] = useState<'wechat' | 'feishu'>('wechat');
  const [sourcePath, setSourcePath] = useState('');
  const [targetManifestPath, setTargetManifestPath] = useState('');
  const [selectedEvidenceImportId, setSelectedEvidenceImportId] = useState<string | null>(null);
  const [expandedSignalMessageIds, setExpandedSignalMessageIds] = useState<string[]>([]);
  const selectedEvidenceImport = useMemo(
    () => evidenceImports.find((item) => item.id === selectedEvidenceImportId) ?? evidenceImports[0] ?? null,
    [evidenceImports, selectedEvidenceImportId]
  );
  const selectedEvidenceDetail = useMemo(
    () => selectedEvidenceImportDetail && selectedEvidenceImport && selectedEvidenceImportDetail.import.id === selectedEvidenceImport.id
      ? selectedEvidenceImportDetail
      : null,
    [selectedEvidenceImport, selectedEvidenceImportDetail]
  );
  const intakeChecks = useMemo(() => {
    const errors: string[] = [];
    const source = sourcePath.trim();
    const manifest = targetManifestPath.trim();

    if (!personaSlug) errors.push('Select a persona before importing evidence.');
    if (!source) errors.push('Add a source file path.');
    if (!manifest) errors.push('Add a target manifest path.');
    if (source && !source.startsWith('/')) errors.push('Use an absolute local path for the source file.');
    if (manifest && !manifest.startsWith('/')) errors.push('Use an absolute local path for the target manifest.');
    if (source && manifest && source === manifest) errors.push('Source and target manifest must be different files.');
    if (manifest && !manifest.toLowerCase().endsWith('.json')) errors.push('Target manifest should be a JSON file.');

    const warnings: string[] = [];
    const normalizedSource = source.toLowerCase();
    if (sourceKind === 'chat' && source) {
      const looksLikeChatExport = ['.json', '.jsonl', '.txt', '.md'].some((suffix) => normalizedSource.endsWith(suffix));
      if (!looksLikeChatExport) warnings.push('Chat imports work best with JSON, JSONL, TXT, or Markdown exports.');
    }
    if (sourceKind === 'video' && source) {
      const looksLikeVideoOrTranscript = ['.mp4', '.mov', '.m4v', '.mp3', '.wav', '.m4a', '.webm', '.json', '.jsonl', '.txt', '.md', '.srt', '.vtt']
        .some((suffix) => normalizedSource.endsWith(suffix));
      if (!looksLikeVideoOrTranscript) warnings.push('Video intake works best with local media files or transcript exports.');
    }

    return { errors, warnings, ready: errors.length === 0 };
  }, [personaSlug, sourceKind, sourcePath, targetManifestPath]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = message.trim();
    if (!next || loading) return;
    setMessage('');
    await onSend(next);
  };

  const handleComposerKeyDown = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      const next = message.trim();
      if (!next || loading) return;
      setMessage('');
      await onSend(next);
    }
  };

  const handleImportSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!intakeChecks.ready || importLoading) return;
    await onImportEvidence({
      sourceKind,
      sourcePath: sourcePath.trim(),
      targetManifestPath: targetManifestPath.trim(),
      chatPlatform: sourceKind === 'chat' ? chatPlatform : undefined,
    });
  };

  const topEntries = (value: Record<string, number>, limit = 4) =>
    Object.entries(value)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  const intakeGuidance = selectedEvidenceImport ? deriveIntakeGuidance(selectedEvidenceImport) : null;
  const summaryFreshness = bundle ? deriveSummaryFreshness(bundle) : null;

  function toggleSignalDetails(messageId: string) {
    setExpandedSignalMessageIds((current) =>
      current.includes(messageId)
        ? current.filter((item) => item !== messageId)
        : [...current, messageId]
    );
  }

  return (
    <section className="workspace panel">
      <div className="panel-header workspace-header">
        <div>
          <p className="eyebrow">Chat</p>
          <h2>{bundle?.conversation.title ?? 'Select or create a thread'}</h2>
        </div>
        <div className="writeback-summary">
          {bundle ? <span className={`status-chip status-${bundle.conversation.status}`}>{bundle.conversation.status}</span> : null}
          {bundle?.session_summary ? <span className="badge">{bundle.session_summary.candidate_count} candidates</span> : null}
          {summaryFreshness ? (
            <span className={summaryFreshness.tone === 'good' ? 'badge success' : summaryFreshness.tone === 'warning' ? 'badge warning' : 'badge'}>
              {summaryFreshness.label}
            </span>
          ) : null}
        </div>
      </div>
      {notice ? <div className="notice-banner">{notice}</div> : null}
      {bundle ? (
        <div className="thread-meta-grid">
          <div className="meta-card">
            <strong>Created</strong>
            <span>{new Date(bundle.conversation.created_at).toLocaleString()}</span>
          </div>
          <div className="meta-card">
            <strong>Updated</strong>
            <span>{new Date(bundle.conversation.updated_at).toLocaleString()}</span>
          </div>
          <div className="meta-card">
            <strong>Messages</strong>
            <span>{bundle.conversation.message_count}</span>
          </div>
          <div className="meta-card">
            <strong>Summary Updated</strong>
            <span>{bundle.session_summary ? new Date(bundle.session_summary.updated_at).toLocaleString() : 'Not yet'}</span>
          </div>
        </div>
      ) : null}
      {bundle?.session_summary ? (
        <div className="session-summary-card">
          <strong>Session Summary</strong>
          <p>{bundle.session_summary.summary}</p>
          {summaryFreshness ? <small>{summaryFreshness.detail}</small> : null}
        </div>
      ) : null}
      <div className="evidence-intake-card">
        <div className="list-card-top">
          <div>
            <strong>Evidence Intake</strong>
            <p className="helper-text">Import chat logs or video transcript evidence into the current workbench thread.</p>
          </div>
          {personaSlug ? <span className="badge">{personaSlug}</span> : null}
        </div>
        <form className="evidence-intake-form" onSubmit={handleImportSubmit}>
          <label className="field compact-field">
            <span>Source Kind</span>
            <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as 'chat' | 'video')}>
              <option value="chat">chat</option>
              <option value="video">video</option>
            </select>
          </label>
          {sourceKind === 'chat' ? (
            <label className="field compact-field">
              <span>Chat Platform</span>
              <select value={chatPlatform} onChange={(event) => setChatPlatform(event.target.value as 'wechat' | 'feishu')}>
                <option value="wechat">wechat</option>
                <option value="feishu">feishu</option>
              </select>
            </label>
          ) : null}
          <label className="field intake-field">
            <span>Source Path</span>
            <input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="/absolute/path/to/chat-or-video" />
          </label>
          <label className="field intake-field">
            <span>Target Manifest Path</span>
            <input value={targetManifestPath} onChange={(event) => setTargetManifestPath(event.target.value)} placeholder="/absolute/path/to/target-manifest.json" />
          </label>
          <button type="submit" className="action-button" disabled={!intakeChecks.ready || importLoading}>
            {importLoading ? 'Importing...' : 'Import Evidence'}
          </button>
        </form>
        <div className="writeback-summary">
          <span className={intakeChecks.ready ? 'badge success' : 'badge warning'}>
            {intakeChecks.ready ? 'Ready to import' : 'Needs attention'}
          </span>
          {sourceKind === 'chat' ? <span className="badge">chat intake</span> : <span className="badge">video intake</span>}
        </div>
        {intakeChecks.errors.length > 0 ? (
          <article className="mini-card">
            <strong>Import checks</strong>
            {intakeChecks.errors.map((item) => (
              <small key={item}>{item}</small>
            ))}
          </article>
        ) : null}
        {intakeChecks.warnings.length > 0 ? (
          <article className="mini-card">
            <strong>Import hints</strong>
            {intakeChecks.warnings.map((item) => (
              <small key={item}>{item}</small>
            ))}
          </article>
        ) : null}
        {evidenceImports.length > 0 ? (
          <div className="evidence-import-list">
            {selectedEvidenceImport ? (
              <article className="mini-card evidence-import-detail">
                <div className="list-card-top">
                  <strong>Selected Intake</strong>
                  <span className="badge">{selectedEvidenceImport.source_kind}</span>
                </div>
                <p>{selectedEvidenceImport.summary}</p>
                <small>{new Date(selectedEvidenceImport.updated_at).toLocaleString()}</small>
                <div className="writeback-summary">
                  <span className="badge">{selectedEvidenceImport.stats.sessions} sessions</span>
                  <span className="badge">{selectedEvidenceImport.stats.windows} windows</span>
                  <span className="badge success">{selectedEvidenceImport.stats.cross_session_stable_items} stable</span>
                  <span className="badge warning">{selectedEvidenceImport.stats.blocked_scene_items} blocked</span>
                </div>
                {intakeGuidance ? (
                  <article className="workflow-card">
                    <div className="list-card-top">
                      <strong>Suggested Next Step</strong>
                      <span className={intakeGuidance.tone === 'good' ? 'badge success' : intakeGuidance.tone === 'warning' ? 'badge warning' : 'badge'}>
                        {intakeGuidance.statusLabel}
                      </span>
                    </div>
                    <p>{intakeGuidance.summary}</p>
                    <div className="workflow-step-list">
                      {intakeGuidance.actions.map((item) => (
                        <small key={item}>{item}</small>
                      ))}
                    </div>
                  </article>
                ) : null}
                <div className="evidence-metric-grid">
                  <div className="metric-group">
                    <strong>Speaker Roles</strong>
                    {topEntries(selectedEvidenceImport.stats.speaker_role_counts).map(([key, count]) => (
                      <small key={key}>{key}: {count}</small>
                    ))}
                  </div>
                  <div className="metric-group">
                    <strong>Scenes</strong>
                    {topEntries(selectedEvidenceImport.stats.scene_counts).map(([key, count]) => (
                      <small key={key}>{key}: {count}</small>
                    ))}
                  </div>
                  <div className="metric-group">
                    <strong>Modalities</strong>
                    {topEntries(selectedEvidenceImport.stats.modality_counts).map(([key, count]) => (
                      <small key={key}>{key}: {count}</small>
                    ))}
                  </div>
                  <div className="metric-group">
                    <strong>Source Types</strong>
                    {topEntries(selectedEvidenceImport.stats.source_type_counts).map(([key, count]) => (
                      <small key={key}>{key}: {count}</small>
                    ))}
                  </div>
                </div>
                <code>{selectedEvidenceImport.artifacts.documents_path}</code>
                <code>{selectedEvidenceImport.artifacts.evidence_index_path}</code>
                <div className="message-actions">
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => onUseEvidenceImport(selectedEvidenceImport)}
                  >
                    Use For Training
                  </button>
                  <button
                    type="button"
                    className="action-button secondary"
                    onClick={() => void onCopyValue(selectedEvidenceImport.artifacts.documents_path, 'Evidence documents path')}
                  >
                    Copy Docs Path
                  </button>
                  <button
                    type="button"
                    className="action-button secondary"
                    onClick={() => void onCopyValue(selectedEvidenceImport.artifacts.evidence_index_path, 'Evidence index path')}
                  >
                    Copy Evidence Path
                  </button>
                </div>
                {selectedEvidenceDetail?.manifest ? (
                  <div className="evidence-metric-grid">
                    <div className="metric-group">
                      <strong>Target</strong>
                      <small>{selectedEvidenceDetail.manifest.target_name}</small>
                      {selectedEvidenceDetail.manifest.default_scene ? (
                        <small>default scene: {selectedEvidenceDetail.manifest.default_scene}</small>
                      ) : null}
                    </div>
                    <div className="metric-group">
                      <strong>Aliases</strong>
                      {[selectedEvidenceDetail.manifest.target_aliases, selectedEvidenceDetail.manifest.self_aliases]
                        .flat()
                        .slice(0, 4)
                        .map((alias) => (
                          <small key={alias}>{alias}</small>
                        ))}
                    </div>
                  </div>
                ) : null}
                {selectedEvidenceDetail?.sample_items.length ? (
                  <div className="evidence-preview-list">
                    {selectedEvidenceDetail.sample_items.map((item) => (
                      <article key={item.id} className="mini-card evidence-preview-card">
                        <div className="list-card-top">
                          <strong>{item.speaker_name}</strong>
                          <span className="badge">{item.window_role}</span>
                        </div>
                        <div className="writeback-summary">
                          <span className={item.speaker_role === 'target' ? 'badge success' : 'badge'}>
                            {item.speaker_role}
                          </span>
                          <span className={item.scene === 'public' || item.scene === 'work' ? 'badge success' : item.scene === 'intimate' || item.scene === 'conflict' ? 'badge warning' : 'badge'}>
                            {item.scene}
                          </span>
                          <span className="badge">{item.evidence_kind}</span>
                          {item.stability_hints.cross_session_stable ? <span className="badge success">stable</span> : null}
                        </div>
                        <p>{item.content}</p>
                        {item.context_before.length > 0 ? (
                          <small>before: {item.context_before.map((ctx) => `${ctx.speaker_name}: ${ctx.content}`).join(' / ')}</small>
                        ) : null}
                        {item.context_after.length > 0 ? (
                          <small>after: {item.context_after.map((ctx) => `${ctx.speaker_name}: ${ctx.content}`).join(' / ')}</small>
                        ) : null}
                        {item.timestamp_start ? (
                          <small>{new Date(item.timestamp_start).toLocaleString()}</small>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : null}
              </article>
            ) : null}
            {evidenceImports.slice(0, 5).map((item) => (
              <article key={item.id} className="mini-card">
                <div className="list-card-top">
                  <strong>{item.source_kind}</strong>
                  <span className="badge">{item.item_count} items</span>
                </div>
                <p>{item.summary}</p>
                <small>{new Date(item.updated_at).toLocaleString()}</small>
                <div className="writeback-summary">
                  <span className="badge">{item.stats.windows} windows</span>
                  <span className="badge success">{item.stats.cross_session_stable_items} stable</span>
                </div>
                <div className="message-actions">
                  <button
                    type="button"
                    className="action-button secondary"
                    onClick={() => {
                      setSelectedEvidenceImportId(item.id);
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
      <div className="chat-scroll">
        {bundle?.messages.length ? bundle.messages.map((item) => (
          <article key={item.id} className={`message-bubble ${item.role}`}>
            <header>
              <strong>{item.role === 'assistant' ? 'Persona' : 'You'}</strong>
              <span>{new Date(item.created_at).toLocaleTimeString()}</span>
            </header>
            <p>{item.content}</p>
            {(item.persona_dimensions.length > 0 || item.citation_items.length > 0 || item.retrieved_memory_ids.length > 0 || item.writeback_candidate_ids.length > 0) ? (
              <div className="message-signal-stack">
                <div className="writeback-summary">
                  {item.persona_dimensions.length > 0 ? <span className="badge success">{item.persona_dimensions.length} dimensions</span> : null}
                  {item.citation_items.length > 0 ? <span className="badge">{item.citation_items.length} citations</span> : null}
                  {item.retrieved_memory_ids.length > 0 ? <span className="badge">{item.retrieved_memory_ids.length} memories</span> : null}
                  {item.writeback_candidate_ids.length > 0 ? <span className="badge warning">{item.writeback_candidate_ids.length} candidates</span> : null}
                  <button
                    type="button"
                    className="action-button secondary signal-toggle-button"
                    onClick={() => toggleSignalDetails(item.id)}
                  >
                    {expandedSignalMessageIds.includes(item.id) ? 'Hide Details' : 'Show Details'}
                  </button>
                </div>
                {expandedSignalMessageIds.includes(item.id) ? (
                  <>
                    {item.persona_dimensions.length > 0 ? (
                      <footer className="message-dimension-list">
                        {item.persona_dimensions.map((dimension) => (
                          <span key={dimension} className="badge">{dimension}</span>
                        ))}
                      </footer>
                    ) : null}
                    {item.citation_items.length > 0 ? (
                      <div className="message-citation-list">
                        {item.citation_items.map((citation) => (
                          <article key={citation.id} className="message-citation-card">
                            <strong>{citation.soul_dimension ?? citation.category ?? citation.id}</strong>
                            <small>{citation.summary}</small>
                          </article>
                        ))}
                      </div>
                    ) : null}
                    {item.retrieved_memory_ids.length > 0 ? (
                      <div className="message-memory-list">
                        <strong>Memory Sources</strong>
                        <div className="writeback-summary">
                          {item.retrieved_memory_ids.map((memoryId) => (
                            <button
                              key={memoryId}
                              type="button"
                              className="badge memory-chip-button"
                              onClick={() => void onCopyValue(memoryId, 'Memory id')}
                            >
                              {memoryId}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {item.writeback_candidate_ids.length > 0 ? (
                      <div className="message-memory-list">
                        <strong>Writeback Candidates</strong>
                        <div className="writeback-summary">
                          {item.writeback_candidate_ids.map((candidateId) => (
                            <button
                              key={candidateId}
                              type="button"
                              className="badge memory-chip-button"
                              onClick={() => void onCopyValue(candidateId, 'Writeback candidate id')}
                            >
                              {candidateId}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="message-actions">
              <button type="button" className="action-button secondary" onClick={() => void onCopyMessage(item.content)}>
                Copy
              </button>
            </div>
          </article>
        )) : <div className="empty-state large">No messages yet. Start the thread.</div>}
      </div>
      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => void handleComposerKeyDown(event)}
          placeholder="Send a message to the selected persona"
          rows={4}
        />
        <small>Press Cmd/Ctrl + Enter to send faster.</small>
        <button type="submit" className="primary-button" disabled={loading || !message.trim()}>
          {loading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </section>
  );
}

function deriveSummaryFreshness(bundle: ConversationBundle): {
  tone: 'good' | 'warning' | 'neutral';
  label: string;
  detail: string;
} | null {
  if (!bundle.session_summary) {
    return {
      tone: 'warning',
      label: 'summary needed',
      detail: 'Refresh the session summary after a few more turns or after importing evidence.',
    };
  }

  const conversationUpdated = new Date(bundle.conversation.updated_at).getTime();
  const summaryUpdated = new Date(bundle.session_summary.updated_at).getTime();
  const lagMinutes = Math.max(0, Math.round((conversationUpdated - summaryUpdated) / 60000));

  if (lagMinutes <= 5) {
    return {
      tone: 'good',
      label: 'summary fresh',
      detail: 'The session summary is up to date with the recent thread activity.',
    };
  }

  if (lagMinutes <= 30) {
    return {
      tone: 'neutral',
      label: 'summary aging',
      detail: 'The thread moved ahead of the last summary. Refresh it before you hand off or train from this session.',
    };
  }

  return {
    tone: 'warning',
    label: 'summary stale',
    detail: 'The thread has changed a lot since the last summary. Refresh it before using this session for downstream steps.',
  };
}

function deriveIntakeGuidance(item: WorkbenchEvidenceImport): {
  tone: 'good' | 'warning' | 'neutral';
  statusLabel: string;
  summary: string;
  actions: string[];
} {
  const stats = item.stats;

  if (stats.target_windows === 0) {
    return {
      tone: 'warning',
      statusLabel: 'check manifest',
      summary: 'No target-centered windows were extracted from this intake yet.',
      actions: [
        'Review the target manifest aliases and speaker mapping first.',
        'Re-import after confirming the target can be identified in the source file.',
      ],
    };
  }

  if (stats.cross_session_stable_items === 0 && stats.windows <= 8) {
    return {
      tone: 'warning',
      statusLabel: 'expand corpus',
      summary: 'This intake completed, but it does not contain much stable evidence yet.',
      actions: [
        'Import a larger slice of the same corpus before training.',
        'Keep this thread as context, but prefer a stronger intake for formal training runs.',
      ],
    };
  }

  if (stats.blocked_scene_items > stats.cross_session_stable_items && stats.blocked_scene_items >= 3) {
    return {
      tone: 'neutral',
      statusLabel: 'review scenes',
      summary: 'A meaningful share of the evidence was blocked or downgraded by scene policy.',
      actions: [
        'Inspect whether the source file is dominated by private, intimate, or conflict-heavy content.',
        'Use this intake carefully and prefer handoff review before promoting it into training prep.',
      ],
    };
  }

  return {
    tone: 'good',
    statusLabel: 'start with smoke',
    summary: 'This intake looks healthy enough to attach directly to training. Start with a smoke run first, then expand if the result stays stable.',
    actions: [
      'Use For Training if you want to test the current corpus immediately.',
      'Run Smoke first from Train before committing to a longer run.',
      'If you want more control, review memory candidates and create a handoff first.',
    ],
  };
}
