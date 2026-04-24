import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Send, Paperclip, X, Image as ImageIcon, Video, FileAudio, FileText, File, ChevronDown } from 'lucide-react';
import { CHAT_MODEL_OPTIONS, useChatStore } from '@/stores/chat';
import { useAppStore } from '@/stores/app';
import { t } from '@/lib/i18n';
import type { AttachmentRef, RuntimeModelConfig } from '@/lib/types';
import { pickFiles } from '@/lib/tauri';

const PROVIDER_LABELS: Record<RuntimeModelConfig['provider'], string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  kimi: 'Kimi',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
};

const PROVIDER_SHORT_LABELS: Record<RuntimeModelConfig['provider'], string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  kimi: 'Kimi',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
};

export function ChatInput() {
  const {
    sending,
    draft,
    composerAttachments,
    availableProviders,
    chatModel,
    hydrateComposer,
    setDraft,
    addAttachmentsFromPaths,
    removeAttachment,
    setChatProvider,
    setChatModel,
    submitComposer,
  } = useChatStore();
  const { view } = useAppStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(draft);
  const [focused, setFocused] = useState(false);

  // Auto-focus when chat view is active
  useEffect(() => {
    if (view === 'chat') {
      textareaRef.current?.focus();
    }
  }, [view]);

  useEffect(() => {
    if (view !== 'chat') return;
    void hydrateComposer();
  }, [hydrateComposer, view]);

  useEffect(() => {
    valueRef.current = draft;
    const el = textareaRef.current;
    if (!el) return;
    el.value = draft;
    resize();
  }, [draft]);

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
    setDraft(e.target.value);
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
    await submitComposer();
    textareaRef.current?.focus();
  }, [sending, submitComposer]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  async function handlePickFiles() {
    const paths = await pickFiles({ multiple: true });
    if (paths.length === 0) return;
    addAttachmentsFromPaths(paths);
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
      {composerAttachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {composerAttachments.map((file) => (
            <div key={file.id} style={{
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
                onClick={() => removeAttachment(file.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'rgb(var(--text-tertiary))', flexShrink: 0 }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        onClick={() => textareaRef.current?.focus()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: 'rgb(var(--bg-card))',
          border: focused ? '1px solid rgb(var(--accent))' : '1px solid rgb(var(--border))',
          borderRadius: 18,
          padding: '12px 14px',
          minHeight: 96,
          boxShadow: focused ? '0 0 0 3px rgb(var(--accent) / 0.12)' : '0 1px 2px rgb(0 0 0 / 0.04)',
          cursor: 'text',
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        }}
      >
        <textarea
          ref={textareaRef}
          disabled={sending}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={t('typeMessage')}
          rows={1}
          style={{
            flex: 1,
            width: '100%',
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'rgb(var(--text-primary))',
            fontSize: 14.5,
            lineHeight: '22px',
            fontFamily: 'inherit',
            padding: 0,
            minHeight: 52,
            maxHeight: 132,
            overflowY: 'auto',
            textAlign: 'left',
            marginTop: 0,
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            borderTop: '1px solid rgb(var(--border-light))',
            paddingTop: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <button
              className="btn btn-icon"
              onClick={() => void handlePickFiles()}
              disabled={sending}
              title="添加附件"
              style={{
                width: 30,
                height: 30,
                flexShrink: 0,
                color: 'rgb(var(--text-tertiary))',
                borderRadius: 999,
              }}
            >
              <Paperclip size={15} />
            </button>
            {availableProviders.length > 0 && chatModel ? (
              <>
                <div style={{ position: 'relative' }}>
                  <select
                    value={chatModel.model}
                    onChange={(e) => setChatModel(e.target.value)}
                    style={compactSelectStyle(156)}
                  >
                    {(CHAT_MODEL_OPTIONS[chatModel.provider] ?? []).map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={12} style={compactChevronStyle} />
                </div>
                <div style={{ position: 'relative' }}>
                  <select
                    value={chatModel.provider}
                    onChange={(e) => setChatProvider(e.target.value as RuntimeModelConfig['provider'])}
                    style={compactSelectStyle(92)}
                  >
                    {availableProviders.map((provider) => (
                      <option key={provider} value={provider}>
                        {PROVIDER_SHORT_LABELS[provider]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={12} style={compactChevronStyle} />
                </div>
              </>
            ) : (
              <span style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))' }}>{t('noChatModel')}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <div
              style={{
                textAlign: 'right',
                fontSize: 11,
                color: 'rgb(var(--text-tertiary))',
              }}
            >
              {t('sendHint')}
            </div>
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
                borderRadius: 999,
              }}
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const compactChevronStyle: React.CSSProperties = {
  position: 'absolute',
  right: 10,
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'rgb(var(--text-tertiary))',
  pointerEvents: 'none',
};

function compactSelectStyle(width: number): React.CSSProperties {
  return {
    width,
    height: 28,
    padding: '0 28px 0 11px',
    border: '1px solid rgb(var(--border-light))',
    borderRadius: 10,
    background: 'rgb(var(--bg-hover))',
    color: 'rgb(var(--text-secondary))',
    fontSize: 11.5,
    fontWeight: 500,
    appearance: 'none',
    outline: 'none',
    boxShadow: 'none',
    lineHeight: 1,
  };
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
