import { useMemo, useState } from 'react';
import { Conversation, PersonaSummary } from '../lib/types';
import { useI18n } from '../lib/i18n';

interface ThreadSidebarProps {
  personas: PersonaSummary[];
  selectedPersonaSlug: string | null;
  selectedConversationId: string | null;
  threads: Conversation[];
  onSelectPersona: (slug: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: () => void;
  onRenameConversation: () => void;
  onDeleteConversation: () => void;
}

export function ThreadSidebar({
  personas,
  selectedPersonaSlug,
  selectedConversationId,
  threads,
  onSelectPersona,
  onSelectConversation,
  onCreateConversation,
  onRenameConversation,
  onDeleteConversation,
}: ThreadSidebarProps) {
  const { locale } = useI18n();
  const isZh = locale === 'zh-CN';
  const [query, setQuery] = useState('');
  const filteredThreads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return threads;
    return threads.filter((thread) => `${thread.title} ${thread.last_message_preview ?? ''}`.toLowerCase().includes(normalized));
  }, [query, threads]);

  return (
    <aside className="sidebar-panel">
      <div className="sidebar-header">
        <div>
          <p className="sidebar-eyebrow">{isZh ? '聊天' : 'Chat'}</p>
          <select
            className="sidebar-select"
            value={selectedPersonaSlug ?? ''}
            onChange={(event) => onSelectPersona(event.target.value)}
            aria-label={isZh ? '选择人格' : 'Select persona'}
          >
            {personas.length === 0 ? <option value="">{isZh ? '暂无人格' : 'No personas'}</option> : null}
            {personas.map((persona) => (
              <option key={persona.slug} value={persona.slug}>
                {persona.name}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="ghost-button" onClick={onCreateConversation} disabled={!selectedPersonaSlug}>
          {isZh ? '新线程' : 'New'}
        </button>
      </div>

      <input
        className="sidebar-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={isZh ? '搜索线程' : 'Search threads'}
        aria-label={isZh ? '搜索线程' : 'Search threads'}
      />

      <div className="sidebar-actions quiet">
        <button type="button" className="text-action" onClick={onRenameConversation} disabled={!selectedConversationId}>
          {isZh ? '重命名' : 'Rename'}
        </button>
        <button type="button" className="text-action danger" onClick={onDeleteConversation} disabled={!selectedConversationId}>
          {isZh ? '删除' : 'Delete'}
        </button>
      </div>

      <div className="list-stack">
        {filteredThreads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            className={thread.id === selectedConversationId ? 'thread-card active' : 'thread-card'}
            onClick={() => onSelectConversation(thread.id)}
          >
            <div className="thread-card-top">
              <strong>{thread.title}</strong>
              <span>{formatThreadTime(thread.updated_at)}</span>
            </div>
            <p>{thread.last_message_preview || (isZh ? '开始一段新的对话。' : 'Start a new conversation.')}</p>
          </button>
        ))}
        {threads.length === 0 ? <div className="empty-note">{isZh ? '这里还没有线程，先新建一个。' : 'No threads yet. Create the first one.'}</div> : null}
        {threads.length > 0 && filteredThreads.length === 0 ? <div className="empty-note">{isZh ? '没有匹配的线程。' : 'No matching threads.'}</div> : null}
      </div>
    </aside>
  );
}

function formatThreadTime(value: string): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString();
}
