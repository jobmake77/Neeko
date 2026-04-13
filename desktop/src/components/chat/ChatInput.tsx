import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Send, Paperclip, X, Image as ImageIcon, Video, FileAudio, FileText, File } from 'lucide-react';
import { useChatStore } from '@/stores/chat';
import { useAppStore } from '@/stores/app';
import { t } from '@/lib/i18n';
import type { AttachmentRef } from '@/lib/types';
import { pickFiles } from '@/lib/tauri';

export function ChatInput() {
  const { sending, sendMessage } = useChatStore();
  const { view } = useAppStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef('');
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);

  // Auto-focus when chat view is active
  useEffect(() => {
    if (view === 'chat') {
      textareaRef.current?.focus();
    }
  }, [view]);

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 22;
    const minH = lineHeight;
    const maxH = lineHeight * 6;
    el.style.height = Math.min(Math.max(el.scrollHeight, minH), maxH) + 'px';
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    valueRef.current = e.target.value;
    resize();
  };

  const submit = useCallback(async () => {
    const val = valueRef.current.trim();
    if (!val || sending) return;
    const el = textareaRef.current;
    if (el) {
      el.value = '';
      el.style.height = 'auto';
    }
    valueRef.current = '';
    const currentAttachments = [...attachments];
    setAttachments([]);
    await sendMessage(val, currentAttachments);
    textareaRef.current?.focus();
  }, [attachments, sending, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  async function handlePickFiles() {
    const paths = await pickFiles({ multiple: true });
    if (paths.length === 0) return;
    setAttachments((prev) => [
      ...prev,
      ...paths.map((path) => {
        const type = inferAttachmentType(path);
        return {
          id: crypto.randomUUID(),
          type,
          name: path.split(/[\\/]/).pop() || path,
          path,
          mime: inferAttachmentMime(path, type),
        };
      }),
    ]);
  }

  return (
    <div
      style={{
        flexShrink: 0,
        background: 'rgb(var(--bg-card))',
        borderTop: '1px solid rgb(var(--border))',
        boxShadow: '0 -2px 8px 0 rgb(0 0 0 / 0.04)',
        padding: '12px 16px',
      }}
    >
      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {attachments.map((file, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 10px',
              borderRadius: 14,
              background: 'rgb(var(--bg-hover))',
              border: '1px solid rgb(var(--border))',
              fontSize: 12,
              color: 'rgb(var(--text-primary))',
              minWidth: 0,
            }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 8,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgb(var(--bg-card))',
                  border: '1px solid rgb(var(--border-light))',
                  color: 'rgb(var(--text-secondary))',
                  flexShrink: 0,
                }}
              >
                {renderAttachmentIcon(file.type)}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{file.name}</span>
                <span style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', lineHeight: 1.3 }}>
                  {formatAttachmentType(file.type)} · {t('attachmentWaiting')}
                </span>
              </div>
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'rgb(var(--text-tertiary))', flexShrink: 0 }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          background: 'rgb(var(--bg-app))',
          border: '1px solid rgb(var(--border))',
          borderRadius: 12,
          padding: '8px',
        }}
      >
        {/* Attachment button */}
        <button
          className="btn btn-icon"
          onClick={() => void handlePickFiles()}
          disabled={sending}
          title="添加附件"
          style={{ width: 30, height: 30, flexShrink: 0, color: 'rgb(var(--text-tertiary))' }}
        >
          <Paperclip size={15} />
        </button>
        <textarea
          ref={textareaRef}
          disabled={sending}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t('typeMessage')}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'rgb(var(--text-primary))',
            fontSize: 14,
            lineHeight: '22px',
            fontFamily: 'inherit',
            padding: 0,
            maxHeight: 132,
            overflowY: 'auto',
            textAlign: 'left',
          }}
        />
        <button
          className="btn btn-primary"
          disabled={sending}
          onClick={submit}
          title={t('sendHint')}
          style={{
            width: 34,
            height: 34,
            padding: 0,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
          }}
        >
          <Send size={15} />
        </button>
      </div>
      <div
        style={{
          textAlign: 'center',
          fontSize: 11,
          color: 'rgb(var(--text-tertiary))',
          marginTop: 6,
        }}
      >
        {t('sendHint')}
      </div>
    </div>
  );
}

function inferAttachmentType(path: string): AttachmentRef['type'] {
  const lower = path.toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|heic)$/.test(lower)) return 'image';
  if (/\.(mp4|mov|mkv|webm)$/.test(lower)) return 'video';
  if (/\.(mp3|wav|m4a|ogg|flac)$/.test(lower)) return 'audio';
  if (/\.(txt|md|json|csv|html|yaml|yml)$/.test(lower)) return 'text';
  return 'file';
}

function inferAttachmentMime(path: string, type: AttachmentRef['type']): string | undefined {
  const lower = path.toLowerCase();
  if (type === 'image') {
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }
  if (type === 'video') {
    if (lower.endsWith('.mov')) return 'video/quicktime';
    if (lower.endsWith('.webm')) return 'video/webm';
    return 'video/mp4';
  }
  if (type === 'audio') {
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.ogg')) return 'audio/ogg';
    if (lower.endsWith('.m4a')) return 'audio/mp4';
    return 'audio/mpeg';
  }
  if (type === 'text') {
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.csv')) return 'text/csv';
    return 'text/plain';
  }
  return undefined;
}

function formatAttachmentType(type: AttachmentRef['type']): string {
  if (type === 'image') return t('attachmentTypeImage');
  if (type === 'video') return t('attachmentTypeVideo');
  if (type === 'audio') return t('attachmentTypeAudio');
  if (type === 'text') return t('attachmentTypeText');
  return t('attachmentTypeFile');
}

function renderAttachmentIcon(type: AttachmentRef['type']) {
  if (type === 'image') return <ImageIcon size={13} />;
  if (type === 'video') return <Video size={13} />;
  if (type === 'audio') return <FileAudio size={13} />;
  if (type === 'text') return <FileText size={13} />;
  return <File size={13} />;
}
