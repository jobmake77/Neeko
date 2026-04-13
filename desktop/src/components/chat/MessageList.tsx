import React, { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/chat';
import { t } from '@/lib/i18n';
import type { AttachmentRef } from '@/lib/types';
import { Image as ImageIcon, Video, FileAudio, FileText, File, Sparkles, AlertCircle, Loader2 } from 'lucide-react';

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
  const { messages, sending, replyPhase } = useChatStore();
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
          <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginLeft: 4 }}>
            {formatReplyPhase(replyPhase)}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

function formatReplyPhase(phase: ReturnType<typeof useChatStore.getState>['replyPhase']): string {
  if (phase === 'processing_attachments') return '正在整理附件上下文';
  if (phase === 'generating') return '正在生成回复';
  if (phase === 'finalizing') return '正在整理结果';
  return '正在准备对话上下文';
}

function AttachmentBadge({ attachment }: { attachment: AttachmentRef }) {
  const status = attachment.processing_status ?? 'pending';
  const tone = getStatusTone(status);
  const icon = renderAttachmentIcon(attachment.type);
  const provider = formatProviderLabel(attachment.processing_provider);
  const summary = attachment.processing_summary
    || attachment.processing_error
    || getFallbackSummary(status);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '32px minmax(0,1fr)',
        columnGap: 10,
        rowGap: 6,
        border: '1px solid rgb(var(--border))',
        background: 'rgb(var(--bg-card))',
        borderRadius: 14,
        padding: '9px 10px',
        minWidth: 180,
        maxWidth: 320,
        boxShadow: '0 1px 2px rgb(0 0 0 / 0.03)',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgb(var(--bg-hover))',
          color: 'rgb(var(--text-secondary))',
          border: '1px solid rgb(var(--border-light))',
          gridRow: 'span 2',
        }}
      >
        {icon}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'rgb(var(--text-primary))',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.3,
            }}
          >
            {attachment.name}
          </div>
          <div style={{ marginTop: 2, fontSize: 11, color: 'rgb(var(--text-tertiary))', lineHeight: 1.3 }}>
            {formatAttachmentType(attachment.type)}
          </div>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 7px',
            borderRadius: 999,
            background: tone.badgeBackground,
            color: tone.color,
            fontSize: 10,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {tone.statusIcon}
          <span>{formatAttachmentStatus(status)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ fontSize: 11, lineHeight: 1.5, color: status === 'error' ? tone.color : 'rgb(var(--text-secondary))' }}>
          {summary}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              color: 'rgb(var(--text-tertiary))',
            }}
          >
            <Sparkles size={10} />
            {t('attachmentSource')}：{provider ?? t('attachmentUnavailable')}
          </span>
        </div>
      </div>
    </div>
  );
}

function formatAttachmentStatus(status: NonNullable<AttachmentRef['processing_status']>): string {
  if (status === 'ready') return t('attachmentReady');
  if (status === 'unsupported') return t('attachmentUnsupported');
  if (status === 'error') return t('attachmentError');
  return t('attachmentPending');
}

function formatAttachmentType(type: AttachmentRef['type']): string {
  if (type === 'image') return t('attachmentTypeImage');
  if (type === 'video') return t('attachmentTypeVideo');
  if (type === 'audio') return t('attachmentTypeAudio');
  if (type === 'text') return t('attachmentTypeText');
  return t('attachmentTypeFile');
}

function renderAttachmentIcon(type: AttachmentRef['type']) {
  if (type === 'image') return <ImageIcon size={15} />;
  if (type === 'video') return <Video size={15} />;
  if (type === 'audio') return <FileAudio size={15} />;
  if (type === 'text') return <FileText size={15} />;
  return <File size={15} />;
}

function formatProviderLabel(provider?: string): string | null {
  if (!provider) return null;
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'local') return '本地解析';
  if (normalized === 'openai') return 'OpenAI';
  if (normalized === 'gemini') return 'Gemini';
  if (normalized === 'kimi' || normalized === 'moonshot') return 'Kimi';
  if (normalized === 'claude') return 'Claude';
  return provider;
}

function getFallbackSummary(status: NonNullable<AttachmentRef['processing_status']>): string {
  if (status === 'ready') return t('attachmentSummaryReady');
  if (status === 'unsupported') return t('attachmentSummaryUnsupported');
  if (status === 'error') return t('attachmentSummaryError');
  return t('attachmentSummaryPending');
}

function getStatusTone(status: NonNullable<AttachmentRef['processing_status']>) {
  if (status === 'ready') {
    return {
      color: 'rgb(var(--success))',
      badgeBackground: 'rgb(var(--success) / 0.12)',
      statusIcon: <Sparkles size={10} />,
    };
  }

  if (status === 'unsupported') {
    return {
      color: 'rgb(var(--warning))',
      badgeBackground: 'rgb(var(--warning) / 0.12)',
      statusIcon: <AlertCircle size={10} />,
    };
  }

  if (status === 'error') {
    return {
      color: 'rgb(var(--destructive))',
      badgeBackground: 'rgb(var(--destructive) / 0.12)',
      statusIcon: <AlertCircle size={10} />,
    };
  }

  return {
    color: 'rgb(var(--text-secondary))',
    badgeBackground: 'rgb(var(--bg-hover))',
    statusIcon: <Loader2 size={10} />,
  };
}
