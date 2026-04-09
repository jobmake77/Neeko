import React, { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/chat';
import { t } from '@/lib/i18n';

const HELIX_FRAMES = ['⣾','⣽','⣻','⢿','⡿','⣟','⣯','⣷'];

function ThinkingDots() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % HELIX_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
      background: 'rgb(var(--bg-card))', border: '1px solid rgb(var(--border))',
      borderRadius: '16px 16px 16px 4px', alignSelf: 'flex-start',
    }}>
      <span style={{ fontFamily: 'monospace', fontSize: 14, color: 'rgb(var(--text-tertiary))' }}>
        {HELIX_FRAMES[frame]}
      </span>
      <span style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>{t('thinking')}</span>
    </div>
  );
}

export function MessageList() {
  const { messages, sending } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  if (messages.length === 0 && !sending) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgb(var(--text-tertiary))',
          fontSize: 14,
          overflowY: 'auto',
          padding: '24px 20px',
        }}
      >
        {t('noChats')}
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {messages.map((msg) => {
        const isUser = msg.role === 'user';
        const time = new Date(msg.created_at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });

        return (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: isUser ? 'flex-end' : 'flex-start',
              gap: 2,
            }}
          >
            <div className="group" style={{ position: 'relative', maxWidth: isUser ? '70%' : '80%' }}>
              <div
                style={
                  isUser
                    ? {
                        background: 'rgb(var(--accent))',
                        color: 'rgb(var(--accent-fg))',
                        borderRadius: '16px 16px 4px 16px',
                        padding: '10px 14px',
                        fontSize: 14,
                        lineHeight: 1.6,
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                      }
                    : {
                        background: 'rgb(var(--bg-card))',
                        border: '1px solid rgb(var(--border))',
                        borderRadius: '16px 16px 16px 4px',
                        padding: '10px 14px',
                        fontSize: 14,
                        lineHeight: 1.6,
                        color: 'rgb(var(--text-primary))',
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                      }
                }
              >
                {msg.content}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'rgb(var(--text-tertiary))',
                  marginTop: 3,
                  textAlign: isUser ? 'right' : 'left',
                  opacity: 0,
                  transition: 'opacity 0.15s',
                }}
                className="msg-timestamp"
              >
                {time}
              </div>
              <style>{`
                .group:hover .msg-timestamp { opacity: 1 !important; }
              `}</style>
            </div>
          </div>
        );
      })}

      {sending && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <ThinkingDots />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
