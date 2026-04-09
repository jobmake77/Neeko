import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Send, Paperclip, X } from 'lucide-react';
import { useChatStore } from '@/stores/chat';
import { useAppStore } from '@/stores/app';
import { t } from '@/lib/i18n';

export function ChatInput() {
  const { sending, sendMessage } = useChatStore();
  const { view } = useAppStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef('');
  const [attachments, setAttachments] = useState<File[]>([]);

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
    setAttachments([]);
    await sendMessage(val);
    textareaRef.current?.focus();
  }, [sending, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  function handleFiles(files: FileList | null) {
    if (!files) return;
    setAttachments((prev) => [...prev, ...Array.from(files)]);
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {attachments.map((file, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 20,
              background: 'rgb(var(--accent) / 0.1)',
              border: '1px solid rgb(var(--accent) / 0.3)',
              fontSize: 12, color: 'rgb(var(--accent))',
            }}>
              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'inherit' }}
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
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          title="添加附件"
          style={{ width: 30, height: 30, flexShrink: 0, color: 'rgb(var(--text-tertiary))' }}
        >
          <Paperclip size={15} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          onChange={(e) => handleFiles(e.target.files)}
        />

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
