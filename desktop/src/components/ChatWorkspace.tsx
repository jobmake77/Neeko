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
