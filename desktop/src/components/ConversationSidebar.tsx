import { useMemo, useState } from 'react';
import { Conversation, PersonaSummary } from '../lib/types';
import { useI18n } from '../lib/i18n';

interface ConversationSidebarProps {
  personas: PersonaSummary[];
  selectedPersonaSlug: string | null;
  selectedConversationId: string | null;
  threads: Conversation[];
  onSelectPersona: (slug: string) => void;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void;
  onRenameConversation: () => void;
  onDeleteConversation: () => void;
  onRefreshSummary: () => void;
}

export function ConversationSidebar({
  personas,
  selectedPersonaSlug,
  selectedConversationId,
  threads,
  onSelectPersona,
  onSelectConversation,
  onCreateConversation,
  onRenameConversation,
  onDeleteConversation,
  onRefreshSummary,
}: ConversationSidebarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const selectedPersona = personas.find((item) => item.slug === selectedPersonaSlug) ?? null;
  const filteredThreads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return threads;
    return threads.filter((thread) =>
      `${thread.title} ${thread.last_message_preview ?? ''}`.toLowerCase().includes(normalized)
    );
  }, [query, threads]);

  return (
    <aside className="conversation-sidebar panel">
      <div className="conversation-sidebar-header">
        <div>
          <p className="eyebrow">{t('Conversations')}</p>
          <h2>{selectedPersona?.name ?? t('Choose persona')}</h2>
        </div>
        <button type="button" className="action-button secondary compact-action" onClick={onCreateConversation}>
          {t('New')}
        </button>
      </div>

      <div className="persona-switcher-block">
        <label className="field compact-field persona-switcher-field">
          <span>{t('Persona')}</span>
          <select
            value={selectedPersonaSlug ?? ''}
            onChange={(event) => onSelectPersona(event.target.value)}
            disabled={personas.length === 0}
          >
            {personas.length === 0 ? <option value="">{t('None')}</option> : null}
            {personas.map((persona) => (
              <option key={persona.slug} value={persona.slug}>
                {persona.name}
              </option>
            ))}
          </select>
        </label>
        {selectedPersona ? (
          <div className="persona-switcher-meta">
            <span>{selectedPersona.slug}</span>
            <span>{new Date(selectedPersona.updated_at).toLocaleDateString()}</span>
          </div>
        ) : null}
      </div>

      <div className="conversation-sidebar-toolbar">
        <label className="field compact-field">
          <span>{t('Search')}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Find a thread')}
          />
        </label>
        <div className="conversation-sidebar-actions">
          <button type="button" className="action-button secondary compact-action" onClick={onRefreshSummary} disabled={!selectedConversationId}>
            {t('Refresh')}
          </button>
          <button type="button" className="action-button secondary compact-action" onClick={onRenameConversation} disabled={!selectedConversationId}>
            {t('Rename')}
          </button>
          <button type="button" className="action-button secondary compact-action" onClick={onDeleteConversation} disabled={!selectedConversationId}>
            {t('Delete')}
          </button>
        </div>
      </div>

      <div className="conversation-list">
        {filteredThreads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            className={thread.id === selectedConversationId ? 'conversation-card active' : 'conversation-card'}
            onClick={() => onSelectConversation(thread.id)}
          >
            <div className="conversation-card-top">
              <strong>{thread.title}</strong>
              <small>{formatThreadTime(thread.updated_at)}</small>
            </div>
            <p>{thread.last_message_preview || t('Start the conversation.')}</p>
          </button>
        ))}
        {threads.length === 0 ? <div className="empty-state">{t('Create the first thread for this persona.')}</div> : null}
        {threads.length > 0 && filteredThreads.length === 0 ? (
          <div className="empty-state">{t('No threads match this search.')}</div>
        ) : null}
      </div>
    </aside>
  );
}

function formatThreadTime(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString();
}
