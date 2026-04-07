import { useMemo, useState } from 'react';
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
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Conversation['status']>('all');
  const filteredThreads = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return threads.filter((thread) => {
      const matchesStatus = statusFilter === 'all' ? true : thread.status === statusFilter;
      const matchesQuery = !normalizedQuery
        ? true
        : `${thread.title} ${thread.last_message_preview ?? ''}`.toLowerCase().includes(normalizedQuery);
      return matchesStatus && matchesQuery;
    });
  }, [threads, query, statusFilter]);
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
      <div className="thread-toolbar">
        <label className="field compact-field">
          <span>Search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a thread"
          />
        </label>
        <label className="field compact-field">
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | Conversation['status'])}
          >
            <option value="all">all</option>
            <option value="active">active</option>
            <option value="idle">idle</option>
            <option value="archived">archived</option>
          </select>
        </label>
      </div>
      <div className="thread-list">
        {filteredThreads.map((thread) => (
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
        {threads.length > 0 && filteredThreads.length === 0 ? (
          <div className="empty-state">No threads match the current search or status filter.</div>
        ) : null}
      </div>
    </section>
  );
}
