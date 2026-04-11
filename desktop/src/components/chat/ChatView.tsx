import React, { useEffect, useMemo } from 'react';
import { ChevronDown, Users } from 'lucide-react';
import { useChatStore } from '@/stores/chat';
import { usePersonaStore } from '@/stores/persona';
import { useAppStore } from '@/stores/app';
import { t } from '@/lib/i18n';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';

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
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 32,
        color: 'rgb(var(--text-secondary))',
      }}
    >
      <Users size={48} style={{ color: 'rgb(var(--text-tertiary))' }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: 'rgb(var(--text-primary))', marginBottom: 6 }}>
          {t('selectPersona')}
        </div>
        <div style={{ fontSize: 13, color: 'rgb(var(--text-tertiary))' }}>
          {readyPersonas.length > 0 ? `${readyPersonas.length} 个可聊天人格` : t('noPersonasHint')}
        </div>
      </div>
      <button className="btn btn-primary" onClick={handleQuickStart}>
        {readyPersonas.length > 0 ? t('startChat') : t('newPersona')}
      </button>
    </div>
  );
}

function PersonaTopBar() {
  const { personaSlug, threads } = useChatStore();
  const { personas } = usePersonaStore();
  const { setPersona } = useChatStore();
  const readyPersonas = useMemo(() => personas.filter((item) => isChatReady(item.status, item.is_ready)), [personas]);

  return (
    <div
      style={{
        height: 44,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        borderBottom: '1px solid rgb(var(--border))',
        background: 'rgb(var(--bg-card))',
        gap: 8,
      }}
    >
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <select
          value={personaSlug && readyPersonas.some((item) => item.slug === personaSlug) ? personaSlug : ''}
          onChange={(e) => e.target.value && void setPersona(e.target.value)}
          style={{
            appearance: 'none',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'rgb(var(--text-primary))',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            paddingRight: 22,
          }}
        >
          <option value="" disabled>
            {readyPersonas.length > 0 ? t('selectPersona') : '暂无可聊天人格'}
          </option>
          {readyPersonas.map((persona) => (
            <option key={persona.slug} value={persona.slug}>
              {persona.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          style={{
            position: 'absolute',
            right: 0,
            pointerEvents: 'none',
            color: 'rgb(var(--text-tertiary))',
          }}
        />
      </div>
      {personaSlug && threads.length > 0 ? (
        <span style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginLeft: 2 }}>
          {threads.length} 个对话
        </span>
      ) : null}
    </div>
  );
}

export function ChatView() {
  const { personaSlug, loadingMessages } = useChatStore();
  const { personas, load } = usePersonaStore();

  useEffect(() => {
    if (personas.length === 0) {
      void load();
    }
  }, [load, personas.length]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: 'rgb(var(--bg-app))',
      }}
    >
      <PersonaTopBar />

      {!personaSlug ? (
        <EmptyState />
      ) : loadingMessages ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgb(var(--text-tertiary))',
            fontSize: 13,
          }}
        >
          {t('loading')}
        </div>
      ) : (
        <>
          <MessageList />
          <ChatInput />
        </>
      )}
    </div>
  );
}
