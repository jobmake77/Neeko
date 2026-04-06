import { Conversation } from '../lib/types';

interface ThreadColumnProps {
  threads: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function ThreadColumn({ threads, selectedId, onSelect, onCreate }: ThreadColumnProps) {
  return (
    <section className="panel column thread-column">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Threads</p>
          <h2>Conversations</h2>
        </div>
        <button type="button" className="action-button" onClick={onCreate}>
          New
        </button>
      </div>
      <div className="thread-list">
        {threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            className={thread.id === selectedId ? 'list-card active' : 'list-card'}
            onClick={() => onSelect(thread.id)}
          >
            <div className="list-card-top">
              <strong>{thread.title}</strong>
              <span>{thread.message_count}</span>
            </div>
            <p>{thread.last_message_preview || 'No conversation yet.'}</p>
            <small>{new Date(thread.updated_at).toLocaleString()}</small>
          </button>
        ))}
        {threads.length === 0 ? <div className="empty-state">Create the first thread for this persona.</div> : null}
      </div>
    </section>
  );
}
