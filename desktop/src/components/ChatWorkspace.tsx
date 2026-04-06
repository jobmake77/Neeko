import { FormEvent, useState } from 'react';
import { ConversationBundle } from '../lib/types';

interface ChatWorkspaceProps {
  bundle: ConversationBundle | null;
  loading: boolean;
  onSend: (message: string) => Promise<void>;
}

export function ChatWorkspace({ bundle, loading, onSend }: ChatWorkspaceProps) {
  const [message, setMessage] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = message.trim();
    if (!next || loading) return;
    setMessage('');
    await onSend(next);
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
          </article>
        )) : <div className="empty-state large">No messages yet. Start the thread.</div>}
      </div>
      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Send a message to the selected persona"
          rows={4}
        />
        <button type="submit" className="primary-button" disabled={loading || !message.trim()}>
          {loading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </section>
  );
}
