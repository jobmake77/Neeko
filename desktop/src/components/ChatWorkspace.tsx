import { FormEvent, KeyboardEvent, useMemo, useState } from 'react';
import { ConversationBundle, WorkbenchEvidenceImport } from '../lib/types';

interface ChatWorkspaceProps {
  bundle: ConversationBundle | null;
  loading: boolean;
  personaSlug: string | null;
  evidenceImports: WorkbenchEvidenceImport[];
  importLoading: boolean;
  notice: string | null;
  onSend: (message: string) => Promise<void>;
  onCopyMessage: (content: string) => Promise<void>;
  onCopyValue: (value: string, label: string) => Promise<void>;
  onUseEvidenceImport: (item: WorkbenchEvidenceImport) => void;
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
  importLoading,
  notice,
  onSend,
  onCopyMessage,
  onCopyValue,
  onUseEvidenceImport,
  onImportEvidence,
}: ChatWorkspaceProps) {
  const [message, setMessage] = useState('');
  const [sourceKind, setSourceKind] = useState<'chat' | 'video'>('chat');
  const [chatPlatform, setChatPlatform] = useState<'wechat' | 'feishu'>('wechat');
  const [sourcePath, setSourcePath] = useState('');
  const [targetManifestPath, setTargetManifestPath] = useState('');
  const [selectedEvidenceImportId, setSelectedEvidenceImportId] = useState<string | null>(null);
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

  return (
    <section className="workspace panel">
      <div className="panel-header workspace-header">
        <div>
          <p className="eyebrow">Chat</p>
          <h2>{bundle?.conversation.title ?? 'Select or create a thread'}</h2>
        </div>
        {bundle?.session_summary ? <span className="badge">{bundle.session_summary.candidate_count} candidates</span> : null}
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
                    onClick={() => setSelectedEvidenceImportId(item.id)}
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
            {item.persona_dimensions.length > 0 ? (
              <footer>{item.persona_dimensions.join(' · ')}</footer>
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
