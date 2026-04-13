import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Send, Paperclip, X, Image as ImageIcon, Video, FileAudio, FileText, File } from 'lucide-react';
import { useChatStore } from '@/stores/chat';
import { useAppStore } from '@/stores/app';
import { t } from '@/lib/i18n';
import type { AttachmentRef, ChatModelOverride, RuntimeModelConfig } from '@/lib/types';
import { pickFiles } from '@/lib/tauri';
import { getRuntimeModelConfig } from '@/lib/api';

const MODEL_OPTIONS: Record<RuntimeModelConfig['provider'], string[]> = {
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3'],
  kimi: ['kimi-for-coding', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
};

const PROVIDER_LABELS: Record<RuntimeModelConfig['provider'], string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  kimi: 'Kimi',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
};

export function ChatInput() {
  const { sending, sendMessage } = useChatStore();
  const { view } = useAppStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef('');
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [availableProviders, setAvailableProviders] = useState<RuntimeModelConfig['provider'][]>([]);
  const [chatModel, setChatModel] = useState<ChatModelOverride | null>(null);

  // Auto-focus when chat view is active
  useEffect(() => {
    if (view === 'chat') {
      textareaRef.current?.focus();
    }
  }, [view]);

  useEffect(() => {
    if (view !== 'chat') return;
    void getRuntimeModelConfig().then((config) => {
      const providers = (Object.entries(config.api_keys) as Array<[RuntimeModelConfig['provider'], string | undefined]>)
        .filter(([, key]) => Boolean(String(key ?? '').trim()))
        .map(([provider]) => provider);
      setAvailableProviders(providers);

      const savedProvider = localStorage.getItem('neeko.chat.provider') as RuntimeModelConfig['provider'] | null;
      const savedModel = localStorage.getItem('neeko.chat.model');
      const provider = savedProvider && providers.includes(savedProvider) ? savedProvider : (providers[0] ?? config.provider);
      const modelOptions = MODEL_OPTIONS[provider] ?? [];
      const model = savedModel && modelOptions.includes(savedModel) ? savedModel : (provider === config.provider ? config.model : modelOptions[0]);
      if (provider && model) {
        setChatModel({ provider, model });
      }
    }).catch(() => undefined);
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
    await sendMessage(val, currentAttachments, chatModel ?? undefined);
    textareaRef.current?.focus();
  }, [attachments, chatModel, sending, sendMessage]);

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

  function handleProviderChange(provider: RuntimeModelConfig['provider']) {
    const model = MODEL_OPTIONS[provider][0];
    const next = { provider, model };
    setChatModel(next);
    localStorage.setItem('neeko.chat.provider', provider);
    localStorage.setItem('neeko.chat.model', model);
  }

  function handleModelChange(model: string) {
    if (!chatModel) return;
    const next = { ...chatModel, model };
    setChatModel(next);
    localStorage.setItem('neeko.chat.provider', next.provider);
    localStorage.setItem('neeko.chat.model', next.model);
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', flexShrink: 0 }}>
            {t('modelForThisChat')}
          </span>
          {availableProviders.length > 0 && chatModel ? (
            <>
              <select
                className="input"
                value={chatModel.provider}
                onChange={(e) => handleProviderChange(e.target.value as RuntimeModelConfig['provider'])}
                style={{ width: 108, fontSize: 12, padding: '5px 8px' }}
              >
                {availableProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {PROVIDER_LABELS[provider]}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={chatModel.model}
                onChange={(e) => handleModelChange(e.target.value)}
                style={{ width: 168, fontSize: 12, padding: '5px 8px' }}
              >
                {(MODEL_OPTIONS[chatModel.provider] ?? []).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))' }}>{t('noChatModel')}</span>
          )}
        </div>
        <div
          style={{
            textAlign: 'right',
            fontSize: 11,
            color: 'rgb(var(--text-tertiary))',
            flexShrink: 0,
          }}
        >
          {t('sendHint')}
        </div>
      </div>
      <div
        style={{
          textAlign: 'center',
          fontSize: 11,
          color: 'rgb(var(--text-tertiary))',
          marginTop: 4,
        }}
      >
        {t('chatModel')}
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
