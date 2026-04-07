import { Conversation } from '../lib/types';

interface ThreadColumnProps {
  threads: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onRefreshSummary: () => void;
}

export function ThreadColumn({
  threads,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onRefreshSummary,
}: ThreadColumnProps) {
  const hasSelection = Boolean(selectedId);
  return (
    <section className="panel column thread-column">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Threads</p>
          <h2>Conversations</h2>
        </div>
        <div className="thread-actions">
          <button type="button" className="action-button secondary" onClick={onRefreshSummary} disabled={!hasSelection}>
            Refresh
          </button>
          <button type="button" className="action-button secondary" onClick={onRename} disabled={!hasSelection}>
            Rename
          </button>
          <button type="button" className="action-button danger" onClick={onDelete} disabled={!hasSelection}>
            Delete
          </button>
          <button type="button" className="action-button" onClick={onCreate}>
            New
          </button>
        </div>
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
              <span className={`status-chip status-${thread.status}`}>{thread.status}</span>
            </div>
            <p>{thread.last_message_preview || 'No conversation yet.'}</p>
            <small>
              {thread.message_count} messages · {new Date(thread.updated_at).toLocaleString()}
            </small>
          </button>
        ))}
        {threads.length === 0 ? <div className="empty-state">Create the first thread for this persona.</div> : null}
      </div>
    </section>
  );
}
