import React, { useEffect, useMemo } from 'react';
import { useAppStore } from '@/stores/app';
import { useChatStore } from '@/stores/chat';
import { usePersonaStore } from '@/stores/persona';
import { t } from '@/lib/i18n';
import { ChatInput } from './ChatInput';
import { MessageList } from './MessageList';

function isChatReady(status?: string, isReady?: boolean): boolean {
  if (isReady) return true;
  return ['ready', 'available', 'converged', 'exported'].includes(String(status ?? '').toLowerCase());
}

function EmptyState() {
  const { personas, load } = usePersonaStore();
  const { setPersona } = useChatStore();
  const { setView } = useAppStore();
  const readyPersonas = useMemo(() => personas.filter((item) => isChatReady(item.status, item.is_ready)), [personas]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleQuickStart = () => {
    if (readyPersonas.length > 0) {
      void setPersona(readyPersonas[0].slug);
    } else {
      setView('personas');
    }
  };

  return (
    <div className="chat-workbench surface-panel" style={{ alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div className="persona-avatar" style={{ width: 64, height: 64, fontSize: 22, marginBottom: 16 }}>
          <span>N</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 750, color: 'rgb(var(--text-primary))', marginBottom: 7 }}>
          {t('selectPersona')}
        </div>
        <div className="muted-copy">
          {readyPersonas.length > 0 ? `${readyPersonas.length} 个可对话人格` : t('noPersonasHint')}
        </div>
        <button className="btn btn-primary" onClick={handleQuickStart} style={{ marginTop: 18 }}>
          {readyPersonas.length > 0 ? t('startChat') : t('newPersona')}
        </button>
      </div>
    </div>
  );
}

export function ChatView() {
  const { personaSlug, loadingMessages } = useChatStore();
  const { personas, load } = usePersonaStore();
  const readyPersonas = useMemo(() => personas.filter((item) => isChatReady(item.status, item.is_ready)), [personas]);
  const currentPersona = readyPersonas.find((item) => item.slug === personaSlug);

  useEffect(() => {
    if (personas.length === 0) {
      void load();
    }
  }, [load, personas.length]);

  return (
    <div className="workspace-view">
      <div className="workspace-body chat-body">
        <div className="view-container chat-container">
          {!personaSlug ? (
            <EmptyState />
          ) : (
            <main className="chat-workbench surface-panel">
              {loadingMessages ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgb(var(--text-tertiary))', fontSize: 13 }}>
                  {t('loading')}
                </div>
              ) : (
                <MessageList personaName={currentPersona?.name} />
              )}
              <ChatInput />
            </main>
          )}
        </div>
      </div>
    </div>
  );
}
