import React, { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/chat';
import { t } from '@/lib/i18n';
import type { AttachmentRef } from '@/lib/types';

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
              {msg.attachments && msg.attachments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {msg.attachments.map((attachment) => (
                    <AttachmentBadge key={attachment.id} attachment={attachment} />
                  ))}
                </div>
              )}
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

function AttachmentBadge({ attachment }: { attachment: AttachmentRef }) {
  const status = attachment.processing_status ?? 'pending';
  const color = status === 'ready'
    ? 'rgb(34 197 94)'
    : status === 'unsupported'
      ? 'rgb(245 158 11)'
      : status === 'error'
        ? 'rgb(239 68 68)'
        : 'rgb(var(--text-tertiary))';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        border: '1px solid rgb(var(--border))',
        background: 'rgb(var(--bg-hover))',
        borderRadius: 12,
        padding: '6px 9px',
        minWidth: 140,
        maxWidth: 280,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'rgb(var(--text-secondary))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {attachment.name}
        </span>
        <span style={{ fontSize: 10, color, flexShrink: 0 }}>
          {formatAttachmentStatus(status)}
        </span>
      </div>
      {attachment.processing_summary ? (
        <div style={{ fontSize: 11, lineHeight: 1.45, color: 'rgb(var(--text-tertiary))' }}>
          {attachment.processing_summary}
        </div>
      ) : attachment.processing_error ? (
        <div style={{ fontSize: 11, lineHeight: 1.45, color }}>
          {attachment.processing_error}
        </div>
      ) : null}
    </div>
  );
}

function formatAttachmentStatus(status: NonNullable<AttachmentRef['processing_status']>): string {
  if (status === 'ready') return t('attachmentReady');
  if (status === 'unsupported') return t('attachmentUnsupported');
  if (status === 'error') return t('attachmentError');
  return t('attachmentPending');
}
