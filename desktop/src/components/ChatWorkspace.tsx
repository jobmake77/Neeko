import { FormEvent, KeyboardEvent, useState } from 'react';
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
  onImportEvidence,
}: ChatWorkspaceProps) {
  const [message, setMessage] = useState('');
  const [sourceKind, setSourceKind] = useState<'chat' | 'video'>('chat');
  const [chatPlatform, setChatPlatform] = useState<'wechat' | 'feishu'>('wechat');
  const [sourcePath, setSourcePath] = useState('');
  const [targetManifestPath, setTargetManifestPath] = useState('');

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
    if (!sourcePath.trim() || !targetManifestPath.trim() || importLoading || !personaSlug) return;
    await onImportEvidence({
      sourceKind,
      sourcePath: sourcePath.trim(),
      targetManifestPath: targetManifestPath.trim(),
      chatPlatform: sourceKind === 'chat' ? chatPlatform : undefined,
    });
  };

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
          <button type="submit" className="action-button" disabled={!personaSlug || importLoading || !sourcePath.trim() || !targetManifestPath.trim()}>
            {importLoading ? 'Importing...' : 'Import Evidence'}
          </button>
        </form>
        {evidenceImports.length > 0 ? (
          <div className="evidence-import-list">
            {evidenceImports.slice(0, 3).map((item) => (
              <article key={item.id} className="mini-card">
                <div className="list-card-top">
                  <strong>{item.source_kind}</strong>
                  <span className="badge">{item.item_count} items</span>
                </div>
                <p>{item.summary}</p>
                <small>{new Date(item.updated_at).toLocaleString()}</small>
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
