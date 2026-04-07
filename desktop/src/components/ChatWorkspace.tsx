import { FormEvent, KeyboardEvent, useMemo, useState } from 'react';
import { ConversationBundle, InfoTab, WorkbenchEvidenceImport } from '../lib/types';

interface ChatWorkspaceProps {
  bundle: ConversationBundle | null;
  loading: boolean;
  personaSlug: string | null;
  evidenceImports: WorkbenchEvidenceImport[];
  selectedEvidenceImportId: string | null;
  importLoading: boolean;
  notice: string | null;
  onSend: (message: string) => Promise<void>;
  onCopyMessage: (content: string) => Promise<void>;
  onCopyValue: (value: string, label: string) => Promise<void>;
  onUseEvidenceImport: (item: WorkbenchEvidenceImport) => void;
  onInspectEvidenceImport: (importId: string) => Promise<void>;
  onSelectEvidenceImport: (importId: string) => void;
  onImportEvidence: (payload: {
    sourceKind: 'chat' | 'video';
    sourcePath: string;
    targetManifestPath: string;
    chatPlatform?: 'wechat' | 'feishu';
  }) => Promise<void>;
  onOpenInspector: (tab: InfoTab) => void;
}

export function ChatWorkspace({
  bundle,
  loading,
  personaSlug,
  evidenceImports,
  selectedEvidenceImportId,
  importLoading,
  notice,
  onSend,
  onCopyMessage,
  onCopyValue,
  onUseEvidenceImport,
  onInspectEvidenceImport,
  onSelectEvidenceImport,
  onImportEvidence,
  onOpenInspector,
}: ChatWorkspaceProps) {
  const [message, setMessage] = useState('');
  const [sourceKind, setSourceKind] = useState<'chat' | 'video'>('chat');
  const [chatPlatform, setChatPlatform] = useState<'wechat' | 'feishu'>('wechat');
  const [sourcePath, setSourcePath] = useState('');
  const [targetManifestPath, setTargetManifestPath] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [expandedSignalMessageIds, setExpandedSignalMessageIds] = useState<string[]>([]);

  const selectedEvidenceImport = useMemo(
    () => evidenceImports.find((item) => item.id === selectedEvidenceImportId) ?? evidenceImports[0] ?? null,
    [evidenceImports, selectedEvidenceImportId]
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

    return { errors, ready: errors.length === 0 };
  }, [personaSlug, sourcePath, targetManifestPath]);

  const summaryFreshness = bundle ? deriveSummaryFreshness(bundle) : null;

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
    setAttachOpen(false);
  };

  function toggleSignalDetails(messageId: string) {
    setExpandedSignalMessageIds((current) =>
      current.includes(messageId)
        ? current.filter((item) => item !== messageId)
        : [...current, messageId]
    );
  }

  return (
    <section className="chat-screen panel">
      <div className="chat-screen-header">
        <div>
          <p className="eyebrow">Chat</p>
          <h2>{bundle?.conversation.title ?? 'Select or create a thread'}</h2>
          <div className="chat-screen-meta">
            {bundle ? <span>{new Date(bundle.conversation.updated_at).toLocaleString()}</span> : <span>Conversation stays front and center here.</span>}
            {bundle?.conversation.status ? <span>{bundle.conversation.status}</span> : null}
          </div>
        </div>
        <div className="chat-screen-actions">
          <button type="button" className="action-button secondary" onClick={() => setAttachOpen((current) => !current)}>
            {attachOpen ? 'Close Attach' : 'Attach'}
          </button>
          <button type="button" className="action-button" onClick={() => onOpenInspector('Soul')}>
            Inspect
          </button>
        </div>
      </div>

      {notice ? <div className="notice-banner compact">{notice}</div> : null}

      {bundle?.session_summary ? (
        <button type="button" className="summary-inline-toggle" onClick={() => setSummaryOpen((current) => !current)}>
          <div>
            <strong>Session Summary</strong>
            <small>{summaryFreshness?.detail ?? 'Tap to open the latest summary.'}</small>
          </div>
          <span className={summaryFreshness?.tone === 'good' ? 'badge success' : summaryFreshness?.tone === 'warning' ? 'badge warning' : 'badge'}>
            {summaryFreshness?.label ?? 'summary'}
          </span>
        </button>
      ) : null}

      {summaryOpen && bundle?.session_summary ? (
        <article className="summary-inline-card">
          <p>{bundle.session_summary.summary}</p>
        </article>
      ) : null}

      {attachOpen ? (
        <section className="attach-panel">
          <div className="attach-panel-header">
            <div>
              <strong>Import Evidence</strong>
              <small>Bring chat or transcript evidence into this thread without cluttering the main surface.</small>
            </div>
            {personaSlug ? <span className="badge">{personaSlug}</span> : null}
          </div>
          <form className="attach-form" onSubmit={handleImportSubmit}>
            <label className="field compact-field">
              <span>Kind</span>
              <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as 'chat' | 'video')}>
                <option value="chat">chat</option>
                <option value="video">video</option>
              </select>
            </label>
            {sourceKind === 'chat' ? (
              <label className="field compact-field">
                <span>Platform</span>
                <select value={chatPlatform} onChange={(event) => setChatPlatform(event.target.value as 'wechat' | 'feishu')}>
                  <option value="wechat">wechat</option>
                  <option value="feishu">feishu</option>
                </select>
              </label>
            ) : null}
            <label className="field">
              <span>Source Path</span>
              <input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="/absolute/path/to/source" />
            </label>
            <label className="field">
              <span>Target Manifest</span>
              <input value={targetManifestPath} onChange={(event) => setTargetManifestPath(event.target.value)} placeholder="/absolute/path/to/target-manifest.json" />
            </label>
            <div className="attach-form-actions">
              <button type="submit" className="action-button" disabled={!intakeChecks.ready || importLoading}>
                {importLoading ? 'Importing...' : 'Import'}
              </button>
            </div>
          </form>
          {intakeChecks.errors.length > 0 ? (
            <article className="mini-card compact-message-card">
              <strong>Before importing</strong>
              {intakeChecks.errors.map((item) => (
                <small key={item}>{item}</small>
              ))}
            </article>
          ) : null}
        </section>
      ) : null}

      {selectedEvidenceImport ? (
        <div className="intake-badge-row">
          <button
            type="button"
            className="intake-badge-card"
            onClick={() => {
              onSelectEvidenceImport(selectedEvidenceImport.id);
              onOpenInspector('Evidence');
              void onInspectEvidenceImport(selectedEvidenceImport.id);
            }}
          >
            <strong>{selectedEvidenceImport.source_kind} intake attached</strong>
            <small>{selectedEvidenceImport.summary}</small>
          </button>
          <div className="writeback-summary">
            <span className="badge">{selectedEvidenceImport.stats.windows} windows</span>
            <span className="badge success">{selectedEvidenceImport.stats.cross_session_stable_items} stable</span>
            <button type="button" className="action-button secondary" onClick={() => onUseEvidenceImport(selectedEvidenceImport)}>
              Use For Training
            </button>
            <button type="button" className="action-button secondary" onClick={() => void onCopyValue(selectedEvidenceImport.artifacts.documents_path, 'Evidence documents path')}>
              Copy Docs Path
            </button>
          </div>
        </div>
      ) : null}

      <div className="chat-scroll minimal">
        {bundle?.messages.length ? bundle.messages.map((item) => (
          <article key={item.id} className={`message-bubble ${item.role}`}>
            <header>
              <strong>{item.role === 'assistant' ? 'Persona' : 'You'}</strong>
              <span>{new Date(item.created_at).toLocaleTimeString()}</span>
            </header>
            <p>{item.content}</p>
            {(item.persona_dimensions.length > 0 || item.citation_items.length > 0 || item.retrieved_memory_ids.length > 0 || item.writeback_candidate_ids.length > 0) ? (
              <div className="message-signal-stack compact">
                <div className="writeback-summary">
                  {item.persona_dimensions.length > 0 ? <span className="badge success">{item.persona_dimensions.length} dimensions</span> : null}
                  {item.citation_items.length > 0 ? <span className="badge">{item.citation_items.length} citations</span> : null}
                  {item.retrieved_memory_ids.length > 0 ? <span className="badge">{item.retrieved_memory_ids.length} memories</span> : null}
                  {item.writeback_candidate_ids.length > 0 ? <span className="badge warning">{item.writeback_candidate_ids.length} candidates</span> : null}
                  <button type="button" className="text-button" onClick={() => toggleSignalDetails(item.id)}>
                    {expandedSignalMessageIds.includes(item.id) ? 'Hide details' : 'Show details'}
                  </button>
                </div>
                {expandedSignalMessageIds.includes(item.id) ? (
                  <div className="message-detail-drawer">
                    {item.persona_dimensions.length > 0 ? (
                      <div className="writeback-summary">
                        {item.persona_dimensions.map((dimension) => (
                          <span key={dimension} className="badge">{dimension}</span>
                        ))}
                      </div>
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
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="message-actions compact">
              <button type="button" className="action-button secondary" onClick={() => void onCopyMessage(item.content)}>
                Copy
              </button>
            </div>
          </article>
        )) : <div className="empty-state large">No messages yet. Start the thread.</div>}
      </div>

      <form className="composer minimal" onSubmit={handleSubmit}>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => void handleComposerKeyDown(event)}
          placeholder="Send a message to the selected persona"
          rows={4}
        />
        <div className="composer-footer">
          <small>Cmd/Ctrl + Enter to send</small>
          <button type="submit" className="primary-button" disabled={loading || !message.trim()}>
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
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
      detail: 'The latest summary still reflects recent thread activity.',
    };
  }
  if (lagMinutes <= 30) {
    return {
      tone: 'neutral',
      label: 'summary aging',
      detail: 'The thread moved ahead of the last summary. Refresh before training from this session.',
    };
  }
  return {
    tone: 'warning',
    label: 'summary stale',
    detail: 'The thread changed a lot since the last summary. Refresh before downstream use.',
  };
}
