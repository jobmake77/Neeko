import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FolderOpen, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { DiscoveredSourceCandidate, PersonaConfig, PersonaDetail, PersonaSource, PersonaSourcePreview, PersonaSummary } from '@/lib/types';
import * as api from '@/lib/api';
import { usePersonaStore } from '@/stores/persona';
import { pickFiles } from '@/lib/tauri';
import { PersonaGenesisAscii } from './PersonaGenesisAscii';

type Props = {
  mode: 'create' | 'edit';
  persona?: PersonaSummary;
  open: boolean;
  onClose: () => void;
};

type SourceCategory = 'text' | 'video' | 'audio';
type SourceTemplate =
  | 'twitter_account'
  | 'web_links'
  | 'chat_upload'
  | 'video_channel'
  | 'video_links'
  | 'video_upload'
  | 'podcast_links'
  | 'audio_upload';

type WizardStep = 1 | 2;

const DEFAULT_POLICY: PersonaConfig['update_policy'] = {
  auto_check_remote: true,
  check_interval_minutes: 60,
  training_threshold: 500,
  strategy: 'incremental',
};

const CATEGORY_META: Record<SourceCategory, { label: string; description: string }> = {
  text: { label: '文本', description: '适合 X/Twitter、网页文章与聊天记录。' },
  video: { label: '视频', description: '适合频道、公开视频链接与本地视频素材。' },
  audio: { label: '音频', description: '适合播客、访谈链接与本地录音。' },
};

const TEMPLATE_META: Record<SourceTemplate, { category: SourceCategory; label: string; description: string; remote: boolean }> = {
  twitter_account: {
    category: 'text',
    label: 'X/Twitter 账号',
    description: '输入账号或主页链接，系统会按时间窗口持续深抓取。',
    remote: true,
  },
  web_links: {
    category: 'text',
    label: '网页链接',
    description: '支持博客、公众号文章、掘金或个人站，多条链接合并为一个主要来源。',
    remote: true,
  },
  chat_upload: {
    category: 'text',
    label: '聊天记录上传',
    description: '上传聊天文件或 ZIP，系统会根据目标人物名称自动生成识别配置。',
    remote: false,
  },
  video_channel: {
    category: 'video',
    label: '频道/账号',
    description: '输入 YouTube 或 B 站频道页，系统会抓取公开视频进行转写和整理。',
    remote: true,
  },
  video_links: {
    category: 'video',
    label: '视频链接',
    description: '支持一次录入多个公开视频链接，系统会统一纳入素材来源。',
    remote: true,
  },
  video_upload: {
    category: 'video',
    label: '本地视频上传',
    description: '上传视频文件或 ZIP，系统会自动转写并进入培养流程。',
    remote: false,
  },
  podcast_links: {
    category: 'audio',
    label: '播客/访谈链接',
    description: '支持多个播客或访谈链接，优先解析音频媒体，必要时回退页面文本。',
    remote: true,
  },
  audio_upload: {
    category: 'audio',
    label: '本地音频上传',
    description: '上传音频文件或 ZIP，系统会自动转写并进入正式培养流程。',
    remote: false,
  },
};

const CATEGORY_TEMPLATES: Record<SourceCategory, SourceTemplate[]> = {
  text: ['twitter_account', 'web_links', 'chat_upload'],
  video: ['video_channel', 'video_links', 'video_upload'],
  audio: ['podcast_links', 'audio_upload'],
};

function slugifyPersonaName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'persona';
}

function normalizeStringArray(values?: string[]): string[] {
  return (values ?? []).map((item) => item.trim()).filter(Boolean);
}

function parseMultilineValue(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAliases(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSource(source: PersonaSource): PersonaSource {
  return {
    ...source,
    links: normalizeStringArray(source.links),
    target_aliases: normalizeStringArray(source.target_aliases),
  };
}

function buildSourceFromTemplate(template: SourceTemplate, id = crypto.randomUUID()): PersonaSource {
  switch (template) {
    case 'twitter_account':
      return {
        id,
        type: 'social',
        mode: 'handle',
        enabled: true,
        status: 'idle',
        platform: 'twitter',
        sync_strategy: 'deep_window',
        horizon_mode: 'deep_archive',
        horizon_years: 8,
        batch_limit: 100,
        links: [],
        target_aliases: [],
      };
    case 'web_links':
      return {
        id,
        type: 'article',
        mode: 'remote_url',
        enabled: true,
        status: 'idle',
        platform: 'web',
        sync_strategy: 'incremental',
        links: [],
        target_aliases: [],
      };
    case 'chat_upload':
      return {
        id,
        type: 'chat_file',
        mode: 'local_file',
        enabled: true,
        status: 'idle',
        platform: 'wechat',
        sync_strategy: 'incremental',
        links: [],
        target_aliases: [],
      };
    case 'video_channel':
      return {
        id,
        type: 'video_file',
        mode: 'channel_url',
        enabled: true,
        status: 'idle',
        platform: 'youtube',
        sync_strategy: 'incremental',
        links: [],
        target_aliases: [],
      };
    case 'video_links':
      return {
        id,
        type: 'video_file',
        mode: 'single_url',
        enabled: true,
        status: 'idle',
        platform: 'youtube',
        sync_strategy: 'incremental',
        links: [],
        target_aliases: [],
      };
    case 'video_upload':
      return {
        id,
        type: 'video_file',
        mode: 'local_file',
        enabled: true,
        status: 'idle',
        platform: 'local',
        sync_strategy: 'incremental',
        links: [],
        target_aliases: [],
      };
    case 'podcast_links':
      return {
        id,
        type: 'audio_file',
        mode: 'remote_url',
        enabled: true,
        status: 'idle',
        platform: 'podcast',
        sync_strategy: 'incremental',
        links: [],
        target_aliases: [],
      };
    case 'audio_upload':
      return {
        id,
        type: 'audio_file',
        mode: 'local_file',
        enabled: true,
        status: 'idle',
        platform: 'local',
        sync_strategy: 'incremental',
        links: [],
        target_aliases: [],
      };
    default:
      return buildSourceFromTemplate('twitter_account', id);
  }
}

function inferTemplateFromSource(source: PersonaSource): SourceTemplate {
  if (source.type === 'social') return 'twitter_account';
  if (source.type === 'article') return 'web_links';
  if (source.type === 'chat_file') return 'chat_upload';
  if (source.type === 'audio_file') return source.mode === 'local_file' ? 'audio_upload' : 'podcast_links';
  if (source.type === 'video_file') {
    if (source.mode === 'channel_url') return 'video_channel';
    if (source.mode === 'local_file') return 'video_upload';
    return 'video_links';
  }
  return 'twitter_account';
}

function resolveSourceLinks(source: PersonaSource): string[] {
  const links = normalizeStringArray(source.links);
  if (links.length > 0) return links;
  if (source.handle_or_url?.trim()) return [source.handle_or_url.trim()];
  return [];
}

function stringifyLinks(source: PersonaSource): string {
  return resolveSourceLinks(source).join('\n');
}

function stringifyAliases(source: PersonaSource): string {
  return normalizeStringArray(source.target_aliases).join('，');
}

function isRemoteSource(source: PersonaSource): boolean {
  return source.type === 'social' || source.mode !== 'local_file';
}

function isSourceConfigured(source: PersonaSource): boolean {
  const template = inferTemplateFromSource(source);
  switch (template) {
    case 'twitter_account':
      return Boolean(source.handle_or_url?.trim());
    case 'web_links':
    case 'video_links':
    case 'podcast_links':
      return resolveSourceLinks(source).length > 0;
    case 'video_channel':
      return Boolean(source.platform?.trim()) && Boolean(source.handle_or_url?.trim());
    case 'chat_upload':
      return Boolean(source.local_path?.trim()) && Boolean(source.platform?.trim()) && Boolean(source.target_label?.trim());
    case 'video_upload':
    case 'audio_upload':
      return Boolean(source.local_path?.trim()) && Boolean(source.target_label?.trim());
    default:
      return false;
  }
}

function describeSourceValue(source: PersonaSource): string {
  const template = inferTemplateFromSource(source);
  if (template === 'twitter_account' || template === 'video_channel') return source.handle_or_url?.trim() || '未填写';
  if (template === 'web_links' || template === 'video_links' || template === 'podcast_links') {
    const count = resolveSourceLinks(source).length;
    return count > 0 ? `已录入 ${count} 条链接` : '未填写';
  }
  if (template === 'chat_upload' || template === 'video_upload' || template === 'audio_upload') {
    return source.local_path?.trim() || '未选择文件';
  }
  return source.summary ?? '未填写';
}

function normalizePolicy(policy?: PersonaConfig['update_policy']): PersonaConfig['update_policy'] {
  return {
    ...DEFAULT_POLICY,
    ...(policy ?? {}),
  };
}

function previewStatusTone(status?: PersonaSourcePreview['status'] | 'error') {
  if (status === 'accepted') return { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.28)', text: '#15803d', label: '已通过' };
  if (status === 'quarantined') return { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.28)', text: '#b45309', label: '待确认' };
  if (status === 'rejected') return { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.28)', text: '#b91c1c', label: '建议移除' };
  return { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.24)', text: 'rgb(var(--text-secondary))', label: '抓取失败' };
}

function formatSourceHealthLabel(status?: string) {
  if (status === 'healthy') return '健康';
  if (status === 'degraded') return '不稳定';
  if (status === 'cooldown') return '冷却中';
  if (status === 'blocked') return '已阻断';
  return '未记录';
}

function formatPreviewSummary(summary?: string) {
  if (!summary) return '当前没有可展示的预览结果。';
  if (summary === 'No new source content.') return '当前没有抓到新的来源内容。';
  if (summary === 'No new source content was available for additional cultivation.') {
    return '当前没有更多可继续纳入培养的新来源内容。';
  }
  return summary;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--text-secondary))' }}>{label}</span>
      {children}
      {hint ? <span style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))' }}>{hint}</span> : null}
    </label>
  );
}

function TemplatePicker({
  category,
  template,
  onCategoryChange,
  onTemplateChange,
}: {
  category: SourceCategory;
  template: SourceTemplate;
  onCategoryChange: (next: SourceCategory) => void;
  onTemplateChange: (next: SourceTemplate) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>来源大类</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          {Object.entries(CATEGORY_META).map(([key, item]) => {
            const resolvedKey = key as SourceCategory;
            const active = category === resolvedKey;
            return (
              <button
                key={resolvedKey}
                type="button"
                onClick={() => onCategoryChange(resolvedKey)}
                style={{
                  textAlign: 'left',
                  borderRadius: 12,
                  border: active ? '1px solid rgba(14,165,233,0.45)' : '1px solid rgb(var(--border-light))',
                  background: active ? 'rgba(14,165,233,0.08)' : 'rgb(var(--bg-card))',
                  padding: 14,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--text-primary))' }}>{item.label}</div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', lineHeight: 1.6, marginTop: 4 }}>{item.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>来源模板</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
          {CATEGORY_TEMPLATES[category].map((item) => {
            const meta = TEMPLATE_META[item];
            const active = template === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => onTemplateChange(item)}
                style={{
                  textAlign: 'left',
                  borderRadius: 12,
                  border: active ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgb(var(--border-light))',
                  background: active ? 'rgba(34,197,94,0.08)' : 'rgb(var(--bg-card))',
                  padding: 14,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--text-primary))' }}>{meta.label}</div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', lineHeight: 1.6, marginTop: 4 }}>{meta.description}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: WizardStep }) {
  const items: Array<{ id: WizardStep; label: string }> = [
    { id: 1, label: '基础信息与主要来源' },
    { id: 2, label: '填写来源信息' },
  ];

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {items.map((item) => {
        const active = item.id === step;
        const completed = item.id < step;
        return (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                background: completed ? 'rgba(34,197,94,0.14)' : active ? 'rgba(14,165,233,0.14)' : 'rgba(148,163,184,0.12)',
                color: completed ? '#16a34a' : active ? '#0284c7' : 'rgb(var(--text-tertiary))',
              }}
            >
              {item.id}
            </div>
            <span style={{ fontSize: 12, fontWeight: active ? 700 : 600, color: active ? 'rgb(var(--text-primary))' : 'rgb(var(--text-secondary))' }}>
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SourceCard({
  heading,
  source,
  onChange,
  onRemove,
  onPickLocalPath,
  allowToggle,
  preview,
  previewLoading,
  onPreview,
}: {
  heading: string;
  source: PersonaSource;
  onChange: (next: PersonaSource) => void;
  onRemove?: () => void;
  onPickLocalPath: () => void;
  allowToggle: boolean;
  preview?: PersonaSourcePreview;
  previewLoading?: boolean;
  onPreview?: () => void;
}) {
  const template = inferTemplateFromSource(source);
  const templateMeta = TEMPLATE_META[template];
  const previewVisible = Boolean(onPreview) && isRemoteSource(source);
  const previewEnabled = previewVisible && isSourceConfigured(source);
  const previewTone = previewStatusTone(preview?.status);

  const updateLinks = (value: string) => {
    onChange({
      ...source,
      links: parseMultilineValue(value),
      handle_or_url: undefined,
    });
  };

  const updateAliases = (value: string) => {
    onChange({
      ...source,
      target_aliases: parseAliases(value),
    });
  };

  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--text-primary))' }}>{heading}</div>
          <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))', marginTop: 4 }}>
            {templateMeta.label} · {CATEGORY_META[templateMeta.category].label}
          </div>
          <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginTop: 6 }}>{describeSourceValue(source)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {previewVisible ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onPreview}
              disabled={!previewEnabled || previewLoading}
              title={previewEnabled ? '抓取预览' : '先填写来源后再抓取预览'}
            >
              <RefreshCw size={14} /> {previewLoading ? '抓取中…' : '抓取预览'}
            </button>
          ) : null}
          {allowToggle ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgb(var(--text-secondary))' }}>
              <input
                type="checkbox"
                checked={source.enabled}
                onChange={(event) => onChange({ ...source, enabled: event.target.checked })}
              />
              启用
            </label>
          ) : null}
          {onRemove ? (
            <button type="button" className="btn btn-icon" onClick={onRemove} title="删除来源" style={{ color: '#ef4444' }}>
              <Trash2 size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {template === 'twitter_account' ? (
          <>
            <Field label="账号或主页链接" hint="支持 @handle 或完整主页链接。">
              <input
                className="input"
                value={source.handle_or_url ?? ''}
                onChange={(event) => onChange({ ...source, handle_or_url: event.target.value, platform: 'twitter' })}
                placeholder="@onevcat 或 https://x.com/onevcat"
              />
            </Field>
            <Field label="抓取范围">
              <select
                className="input"
                value={source.horizon_mode === 'recent_3y' ? 'recent_3y' : 'deep_archive'}
                onChange={(event) => onChange({
                  ...source,
                  horizon_mode: event.target.value as PersonaSource['horizon_mode'],
                  horizon_years: event.target.value === 'recent_3y' ? 3 : 8,
                })}
              >
                <option value="recent_3y">近 3 年</option>
                <option value="deep_archive">5-10 年</option>
              </select>
            </Field>
          </>
        ) : null}

        {template === 'web_links' ? (
          <Field label="网页链接" hint="每行一个链接，可一次录入多条文章或页面。">
            <textarea
              className="input"
              rows={6}
              value={stringifyLinks(source)}
              onChange={(event) => updateLinks(event.target.value)}
              placeholder={'https://example.com/post-1\nhttps://example.com/post-2'}
              style={{ resize: 'vertical', minHeight: 128 }}
            />
          </Field>
        ) : null}

        {template === 'chat_upload' ? (
          <>
            <Field label="上传文件或 ZIP" hint="支持导出聊天文件或单个 ZIP。">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="input"
                  value={source.local_path ?? ''}
                  onChange={(event) => onChange({ ...source, local_path: event.target.value })}
                  placeholder="选择聊天文件或 ZIP"
                  style={{ minWidth: 0, flex: '1 1 260px' }}
                />
                <button type="button" className="btn btn-secondary" onClick={onPickLocalPath}>
                  <FolderOpen size={14} /> 选择文件
                </button>
              </div>
            </Field>
            <Field label="聊天平台">
              <select
                className="input"
                value={source.platform ?? 'wechat'}
                onChange={(event) => onChange({ ...source, platform: event.target.value })}
              >
                <option value="wechat">微信</option>
                <option value="feishu">飞书</option>
                <option value="telegram">Telegram</option>
                <option value="other">其他</option>
              </select>
            </Field>
            <Field label="目标人物名称/备注" hint="用于从聊天记录中识别目标人物发言。">
              <input
                className="input"
                value={source.target_label ?? ''}
                onChange={(event) => onChange({ ...source, target_label: event.target.value })}
                placeholder="例如：One Cat"
              />
            </Field>
            <Field label="可选别名" hint="多个别名用逗号或换行分隔。">
              <input
                className="input"
                value={stringifyAliases(source)}
                onChange={(event) => updateAliases(event.target.value)}
                placeholder="例如：老王，OneCat"
              />
            </Field>
          </>
        ) : null}

        {template === 'video_channel' ? (
          <>
            <Field label="平台">
              <select
                className="input"
                value={source.platform ?? 'youtube'}
                onChange={(event) => onChange({ ...source, platform: event.target.value })}
              >
                <option value="youtube">YouTube</option>
                <option value="bilibili">B 站</option>
              </select>
            </Field>
            <Field label="频道链接或账号页">
              <input
                className="input"
                value={source.handle_or_url ?? ''}
                onChange={(event) => onChange({ ...source, handle_or_url: event.target.value })}
                placeholder="https://www.youtube.com/@channel 或 https://space.bilibili.com/..."
              />
            </Field>
          </>
        ) : null}

        {template === 'video_links' ? (
          <>
            <Field label="平台">
              <select
                className="input"
                value={source.platform ?? 'youtube'}
                onChange={(event) => onChange({ ...source, platform: event.target.value })}
              >
                <option value="youtube">YouTube</option>
                <option value="bilibili">B 站</option>
                <option value="other">其他</option>
              </select>
            </Field>
            <Field label="视频链接" hint="每行一个链接，可一次录入多个视频。">
              <textarea
                className="input"
                rows={6}
                value={stringifyLinks(source)}
                onChange={(event) => updateLinks(event.target.value)}
                placeholder={'https://www.youtube.com/watch?v=...\nhttps://www.bilibili.com/video/BV...'}
                style={{ resize: 'vertical', minHeight: 128 }}
              />
            </Field>
          </>
        ) : null}

        {template === 'video_upload' ? (
          <>
            <Field label="上传视频文件或 ZIP" hint="支持单个视频文件或单个 ZIP。">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="input"
                  value={source.local_path ?? ''}
                  onChange={(event) => onChange({ ...source, local_path: event.target.value })}
                  placeholder="选择视频文件或 ZIP"
                  style={{ minWidth: 0, flex: '1 1 260px' }}
                />
                <button type="button" className="btn btn-secondary" onClick={onPickLocalPath}>
                  <FolderOpen size={14} /> 选择文件
                </button>
              </div>
            </Field>
            <Field label="目标人物名称">
              <input
                className="input"
                value={source.target_label ?? ''}
                onChange={(event) => onChange({ ...source, target_label: event.target.value })}
                placeholder="例如：One Cat"
              />
            </Field>
            <Field label="可选别名" hint="多个别名用逗号或换行分隔。">
              <input
                className="input"
                value={stringifyAliases(source)}
                onChange={(event) => updateAliases(event.target.value)}
                placeholder="例如：老王，OneCat"
              />
            </Field>
          </>
        ) : null}

        {template === 'podcast_links' ? (
          <Field label="播客/访谈链接" hint="每行一个链接，可一次录入多个播客页面或访谈页。">
            <textarea
              className="input"
              rows={6}
              value={stringifyLinks(source)}
              onChange={(event) => updateLinks(event.target.value)}
              placeholder={'https://podcast.example.com/episode-1\nhttps://example.com/interview'}
              style={{ resize: 'vertical', minHeight: 128 }}
            />
          </Field>
        ) : null}

        {template === 'audio_upload' ? (
          <>
            <Field label="上传音频文件或 ZIP" hint="支持 mp3、wav、m4a 等音频文件，或单个 ZIP。">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="input"
                  value={source.local_path ?? ''}
                  onChange={(event) => onChange({ ...source, local_path: event.target.value })}
                  placeholder="选择音频文件或 ZIP"
                  style={{ minWidth: 0, flex: '1 1 260px' }}
                />
                <button type="button" className="btn btn-secondary" onClick={onPickLocalPath}>
                  <FolderOpen size={14} /> 选择文件
                </button>
              </div>
            </Field>
            <Field label="目标人物名称">
              <input
                className="input"
                value={source.target_label ?? ''}
                onChange={(event) => onChange({ ...source, target_label: event.target.value })}
                placeholder="例如：One Cat"
              />
            </Field>
            <Field label="可选别名" hint="多个别名用逗号或换行分隔。">
              <input
                className="input"
                value={stringifyAliases(source)}
                onChange={(event) => updateAliases(event.target.value)}
                placeholder="例如：老王，OneCat"
              />
            </Field>
          </>
        ) : null}
      </div>

      {previewLoading ? (
        <div className="card" style={{ padding: 14, background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.18)' }}>
          <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>正在抓取并校验这个来源的内容归属…</div>
        </div>
      ) : null}

      {preview ? (
        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: previewTone.bg, border: `1px solid ${previewTone.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--text-primary))' }}>抓取预览</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: previewTone.text }}>{previewTone.label}</div>
          </div>
          <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))', lineHeight: 1.7 }}>{formatPreviewSummary(preview.summary)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {preview.target_results.map((item) => {
              const itemTone = previewStatusTone(item.status);
              return (
                <div key={item.target} style={{ borderRadius: 10, border: `1px solid ${itemTone.border}`, background: 'rgb(var(--bg-card))', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--text-primary))', wordBreak: 'break-all' }}>{item.target}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: itemTone.text }}>{itemTone.label}</div>
                  </div>
                  {item.title ? <div style={{ fontSize: 12, color: 'rgb(var(--text-primary))' }}>标题: <b>{item.title}</b></div> : null}
                  {item.author ? <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>作者: <b>{item.author}</b></div> : null}
                  <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))', lineHeight: 1.7 }}>{item.summary}</div>
                  {typeof item.identity_match === 'number' || typeof item.source_integrity === 'number' ? (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'rgb(var(--text-tertiary))' }}>
                      {typeof item.identity_match === 'number' ? <span>归属匹配 {Math.round(item.identity_match * 100)}%</span> : null}
                      {typeof item.source_integrity === 'number' ? <span>来源完整度 {Math.round(item.source_integrity * 100)}%</span> : null}
                      {item.fetched_via ? <span>抓取方式 {item.fetched_via}</span> : null}
                    </div>
                  ) : null}
                  {item.health || item.quality_assessment ? (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'rgb(var(--text-tertiary))' }}>
                      {item.health ? <span>来源健康 {formatSourceHealthLabel(item.health.status)}</span> : null}
                      {item.quality_assessment ? <span>提取质量 {Math.round(item.quality_assessment.score * 100)}%</span> : null}
                    </div>
                  ) : null}
                  {item.content_preview ? (
                    <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                      {item.content_preview}
                    </div>
                  ) : null}
                  {item.error ? <div style={{ fontSize: 11, color: '#b91c1c' }}>{item.error}</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {source.summary ? (
        <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', lineHeight: 1.6 }}>{source.summary}</div>
      ) : null}
    </div>
  );
}

function PolicySection({
  policy,
  onChange,
  showRemoteSettings,
}: {
  policy: PersonaConfig['update_policy'];
  onChange: (next: PersonaConfig['update_policy']) => void;
  showRemoteSettings: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--text-primary))' }}>培养设置</div>

      {showRemoteSettings ? (
        <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220, flex: '1 1 320px' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>自动检查更新</div>
            <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>远程来源会按固定周期检查新增内容，发现增量后继续进入培养流程。</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={policy.auto_check_remote}
                onChange={(event) => onChange({ ...policy, auto_check_remote: event.target.checked })}
              />
              自动
            </label>
            <input
              className="input"
              type="number"
              min={5}
              value={policy.check_interval_minutes}
              onChange={(event) => onChange({ ...policy, check_interval_minutes: Math.max(5, Number(event.target.value || 60)) })}
              style={{ width: 96 }}
            />
            <span style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>分钟</span>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 16, fontSize: 12, color: 'rgb(var(--text-tertiary))', lineHeight: 1.7 }}>
          当前来源为本地上传素材，不需要自动检查更新；保存后系统会直接进入整理、转写和培养流程。
        </div>
      )}

      <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220, flex: '1 1 320px' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>自动进入训练门槛</div>
          <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>达到这个素材量后系统才会自动进入训练。达到门槛后如果测评未通过，系统仍会继续补充素材再进入下一轮训练。</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="input"
            type="number"
            min={1}
            max={20000}
            value={policy.training_threshold ?? 500}
            onChange={(event) => onChange({ ...policy, training_threshold: Math.max(1, Number(event.target.value || 500)) })}
            style={{ width: 120 }}
          />
          <span style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>条</span>
        </div>
      </div>
    </div>
  );
}

export function PersonaEditor({ mode, persona, open, onClose }: Props) {
  const { reload } = usePersonaStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [createCategory, setCreateCategory] = useState<SourceCategory>('text');
  const [createTemplate, setCreateTemplate] = useState<SourceTemplate>('twitter_account');
  const [supplementCategory, setSupplementCategory] = useState<SourceCategory>('text');
  const [supplementTemplate, setSupplementTemplate] = useState<SourceTemplate>('twitter_account');
  const [sources, setSources] = useState<PersonaSource[]>([buildSourceFromTemplate('twitter_account')]);
  const [policy, setPolicy] = useState<PersonaConfig['update_policy']>(DEFAULT_POLICY);
  const [discovered, setDiscovered] = useState<DiscoveredSourceCandidate[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [sourcePreviews, setSourcePreviews] = useState<Record<string, PersonaSourcePreview | undefined>>({});
  const [previewing, setPreviewing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    setError('');
    if (mode === 'create' || !persona) {
      setLoading(false);
      setSaving(false);
      setName('');
      setWizardStep(1);
      setCreateCategory('text');
      setCreateTemplate('twitter_account');
      setSupplementCategory('text');
      setSupplementTemplate('twitter_account');
      setSources([buildSourceFromTemplate('twitter_account')]);
      setPolicy(DEFAULT_POLICY);
      setDiscovered([]);
      setSourcePreviews({});
      setPreviewing({});
      return;
    }

    setLoading(true);
    api.getPersona(persona.slug)
      .then((detail: PersonaDetail) => {
        const nextSources = detail.config.sources.map(normalizeSource);
        setName(detail.config.name ?? detail.persona.name);
        setSources(nextSources);
        setPolicy(normalizePolicy(detail.config.update_policy));
        if (nextSources[0]) {
          const firstTemplate = inferTemplateFromSource(nextSources[0]);
          setCreateTemplate(firstTemplate);
          setCreateCategory(TEMPLATE_META[firstTemplate].category);
        }
        return api.getDiscoveredSources(persona.slug).then(setDiscovered).catch(() => setDiscovered([]));
      })
      .catch((nextError) => setError((nextError as Error).message))
      .finally(() => {
        setSourcePreviews({});
        setPreviewing({});
        setLoading(false);
      });
  }, [open, mode, persona]);

  const enabledSources = useMemo(
    () => sources.filter((source) => source.enabled),
    [sources],
  );

  const hasRemoteSources = useMemo(
    () => enabledSources.some((source) => isRemoteSource(source)),
    [enabledSources],
  );

  const canSave = useMemo(() => {
    if (!name.trim()) return false;
    if (enabledSources.length === 0) return false;
    return enabledSources.every((source) => isSourceConfigured(source));
  }, [enabledSources, name]);

  function replaceCreateTemplate(nextCategory: SourceCategory, nextTemplate: SourceTemplate) {
    setCreateCategory(nextCategory);
    setCreateTemplate(nextTemplate);
    setSources([buildSourceFromTemplate(nextTemplate)]);
  }

  function updateSourceAt(index: number, next: PersonaSource) {
    const previewKey = sources[index]?.id;
    if (previewKey) {
      setSourcePreviews((prev) => {
        const draft = { ...prev };
        delete draft[previewKey];
        return draft;
      });
      setPreviewing((prev) => {
        const draft = { ...prev };
        delete draft[previewKey];
        return draft;
      });
    }
    setSources((prev) => prev.map((source, sourceIndex) => sourceIndex === index ? normalizeSource(next) : source));
  }

  async function pickLocalSourcePath(index: number) {
    const paths = await pickFiles({ multiple: false });
    if (!paths[0]) return;
    const previewKey = sources[index]?.id;
    if (previewKey) {
      setSourcePreviews((prev) => {
        const draft = { ...prev };
        delete draft[previewKey];
        return draft;
      });
    }
    setSources((prev) => prev.map((source, sourceIndex) => sourceIndex === index ? normalizeSource({ ...source, local_path: paths[0] }) : source));
  }

  async function handlePreviewSource(source: PersonaSource) {
    if (previewing[source.id]) return;
    if (!name.trim()) {
      setError('请先填写人格名称，再抓取来源预览。');
      return;
    }
    setPreviewing((prev) => ({ ...prev, [source.id]: true }));
    setError('');
    try {
      const preview = await api.previewPersonaSource({
        persona_name: name.trim(),
        source: normalizeSource(source),
      });
      setSourcePreviews((prev) => ({ ...prev, [source.id]: preview }));
    } catch (nextError) {
      const message = (nextError as Error).message;
      setError(message.includes('aborted') ? '抓取预览超时，请稍后重试。' : message);
    } finally {
      setPreviewing((prev) => ({ ...prev, [source.id]: false }));
    }
  }

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError('');
    const payloadSources = mode === 'create' ? [normalizeSource(sources[0])] : sources.map(normalizeSource);
    try {
      if (mode === 'create') {
        await api.createPersona({
          name: name.trim(),
          persona_slug: slugifyPersonaName(name),
          sources: payloadSources,
          update_policy: policy,
        });
        await new Promise((resolve) => window.setTimeout(resolve, 2200));
      } else if (persona) {
        await api.updatePersonaSources(persona.slug, {
          name: name.trim(),
          sources: payloadSources,
          update_policy: policy,
        });
      }
      await reload();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscover() {
    if (!persona || discovering) return;
    setDiscovering(true);
    setError('');
    try {
      const next = await api.discoverSources(persona.slug);
      setDiscovered(next);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setDiscovering(false);
    }
  }

  async function handleAcceptCandidate(candidateId: string) {
    if (!persona) return;
    try {
      await api.acceptDiscoveredSource(persona.slug, candidateId);
      const [detail, candidates] = await Promise.all([
        api.getPersona(persona.slug),
        api.getDiscoveredSources(persona.slug),
      ]);
      setSources(detail.config.sources.map(normalizeSource));
      setDiscovered(candidates);
      await reload();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  async function handleRejectCandidate(candidateId: string) {
    if (!persona) return;
    try {
      await api.rejectDiscoveredSource(persona.slug, candidateId);
      setDiscovered((prev) => prev.map((item) => item.id === candidateId ? { ...item, status: 'rejected' } : item));
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  function handleAddSupplementSource() {
    setSources((prev) => [...prev, buildSourceFromTemplate(supplementTemplate)]);
  }

  const primarySource = sources[0] ?? buildSourceFromTemplate(createTemplate);
  const createTemplateMeta = TEMPLATE_META[createTemplate];

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgb(0 0 0 / 0.46)', zIndex: 200 }}
          />
          <div
            style={{
              position: 'fixed',
              zIndex: 201,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              inset: 0,
              padding: 24,
              pointerEvents: 'none',
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              style={{
                width: 920,
                maxWidth: 'min(920px, calc(100vw - 48px))',
                maxHeight: 'min(900px, calc(100vh - 48px))',
                overflow: 'hidden',
                background: 'rgb(var(--bg-card))',
                border: '1px solid rgb(var(--border))',
                borderRadius: 14,
                boxShadow: '0 24px 60px rgb(0 0 0 / 0.24)',
                display: 'flex',
                flexDirection: 'column',
                pointerEvents: 'auto',
              }}
            >
              {saving && mode === 'create' ? (
                <div style={{ padding: 20 }}>
                  <PersonaGenesisAscii
                    name={name}
                    subtitle="正在整理素材来源、抽取人格结构并创建可持续培养的初始人格。"
                  />
                </div>
              ) : (
                <>
                  <div style={{ padding: '18px 20px', borderBottom: '1px solid rgb(var(--border-light))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{mode === 'create' ? '新建人格' : '编辑人格'}</div>
                      <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>
                        {mode === 'create' ? '先选择一个主要来源完成创建，创建后可继续补充来源。' : '在这里维护当前素材来源，并继续补充新的来源。'}
                      </div>
                    </div>
                    <button type="button" className="btn btn-icon" onClick={onClose}><X size={16} /></button>
                  </div>

                  <div style={{ padding: 20, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
                    {mode === 'create' ? <Stepper step={wizardStep} /> : null}

                    <Field label={t('personaName')}>
                      <input
                        className="input"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="输入人格名称"
                      />
                    </Field>

                    {mode === 'create' && wizardStep === 1 ? (
                      <>
                        <TemplatePicker
                          category={createCategory}
                          template={createTemplate}
                          onCategoryChange={(nextCategory) => replaceCreateTemplate(nextCategory, CATEGORY_TEMPLATES[nextCategory][0])}
                          onTemplateChange={(nextTemplate) => replaceCreateTemplate(TEMPLATE_META[nextTemplate].category, nextTemplate)}
                        />
                        <div className="card" style={{ padding: 16, fontSize: 12, color: 'rgb(var(--text-tertiary))', lineHeight: 1.7 }}>
                          当前只选择一个主要来源模板进行创建；创建完成后，可以在编辑页继续补充网页、视频、音频或聊天记录来源。
                        </div>
                      </>
                    ) : null}

                    {mode === 'create' && wizardStep === 2 ? (
                      <>
                        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>主要来源</div>
                          <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>{createTemplateMeta.label}</div>
                          <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', lineHeight: 1.7 }}>{createTemplateMeta.description}</div>
                        </div>
                        <SourceCard
                          heading="主要来源"
                          source={primarySource}
                          onChange={(next) => updateSourceAt(0, next)}
                          onPickLocalPath={() => void pickLocalSourcePath(0)}
                          allowToggle={false}
                          preview={sourcePreviews[primarySource.id]}
                          previewLoading={previewing[primarySource.id]}
                          onPreview={() => void handlePreviewSource(primarySource)}
                        />
                        <PolicySection
                          policy={policy}
                          onChange={setPolicy}
                          showRemoteSettings={isRemoteSource(primarySource)}
                        />
                      </>
                    ) : null}

                    {mode === 'edit' ? (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700 }}>已有素材来源</div>
                              <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>主要来源在最前，其余来源会作为补充来源继续参与培养。</div>
                            </div>
                            <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>{sources.length} 个来源</div>
                          </div>

                          {sources.length === 0 ? (
                            <div className="card" style={{ padding: 16, fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>当前还没有素材来源，可以先在下方补充一个来源后再保存。</div>
                          ) : (
                            sources.map((source, index) => (
                              <SourceCard
                                key={source.id}
                                heading={index === 0 ? '主要来源' : `补充来源 ${index}`}
                                source={source}
                                onChange={(next) => updateSourceAt(index, next)}
                                onRemove={() => {
                                  setSources((prev) => prev.filter((item) => item.id !== source.id));
                                  setSourcePreviews((prev) => {
                                    const draft = { ...prev };
                                    delete draft[source.id];
                                    return draft;
                                  });
                                  setPreviewing((prev) => {
                                    const draft = { ...prev };
                                    delete draft[source.id];
                                    return draft;
                                  });
                                }}
                                onPickLocalPath={() => void pickLocalSourcePath(index)}
                                allowToggle
                                preview={sourcePreviews[source.id]}
                                previewLoading={previewing[source.id]}
                                onPreview={() => void handlePreviewSource(source)}
                              />
                            ))
                          )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700 }}>补充来源</div>
                              <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>使用与创建时相同的模板体系继续补充公开链接或本地素材。</div>
                            </div>
                            <button type="button" className="btn btn-secondary" onClick={handleAddSupplementSource}>
                              <Plus size={14} /> 添加这个来源
                            </button>
                          </div>
                          <TemplatePicker
                            category={supplementCategory}
                            template={supplementTemplate}
                            onCategoryChange={(nextCategory) => {
                              setSupplementCategory(nextCategory);
                              setSupplementTemplate(CATEGORY_TEMPLATES[nextCategory][0]);
                            }}
                            onTemplateChange={(nextTemplate) => {
                              setSupplementTemplate(nextTemplate);
                              setSupplementCategory(TEMPLATE_META[nextTemplate].category);
                            }}
                          />
                        </div>

                        <PolicySection
                          policy={policy}
                          onChange={setPolicy}
                          showRemoteSettings={hasRemoteSources}
                        />

                        {persona ? (
                          <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                              <div style={{ minWidth: 220, flex: '1 1 320px' }}>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>自动发现候选来源</div>
                                <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>搜索官网、YouTube 和公开播客访谈页；确认后再加入补充来源。</div>
                              </div>
                              <button type="button" className="btn btn-secondary" onClick={() => void handleDiscover()} disabled={discovering}>
                                <RefreshCw size={14} /> {discovering ? '搜索中…' : '发现来源'}
                              </button>
                            </div>

                            {discovered.length === 0 ? (
                              <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>还没有候选来源。可先保存已有来源，再执行自动发现。</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {discovered.map((item) => (
                                  <div key={item.id} style={{ border: '1px solid rgb(var(--border-light))', borderRadius: 10, padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                    <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                                      <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</div>
                                      <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))', marginTop: 4 }}>{item.summary}</div>
                                      <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginTop: 4, wordBreak: 'break-all' }}>{item.url_or_handle}</div>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flex: '0 0 auto' }}>
                                      <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))' }}>{Math.round(item.confidence * 100)}%</div>
                                      {item.status === 'pending' ? (
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                          <button type="button" className="btn btn-secondary" onClick={() => void handleRejectCandidate(item.id)}>忽略</button>
                                          <button type="button" className="btn btn-primary" onClick={() => void handleAcceptCandidate(item.id)}>加入补充来源</button>
                                        </div>
                                      ) : (
                                        <div style={{ fontSize: 12, color: item.status === 'accepted' ? '#16a34a' : 'rgb(var(--text-tertiary))' }}>
                                          {item.status === 'accepted' ? '已加入补充来源' : '已忽略'}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    {loading ? <div style={{ fontSize: 13, color: 'rgb(var(--text-tertiary))' }}><RefreshCw size={14} style={{ verticalAlign: 'middle' }} /> 加载中…</div> : null}
                    {error ? <div style={{ fontSize: 12, color: '#ef4444', background: 'rgb(239 68 68 / 0.08)', borderRadius: 8, padding: '10px 12px' }}>{error}</div> : null}
                  </div>

                  <div style={{ padding: '16px 20px', borderTop: '1px solid rgb(var(--border-light))', display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
                    {mode === 'create' && wizardStep === 2 ? (
                      <button type="button" className="btn btn-secondary" onClick={() => setWizardStep(1)}>上一步</button>
                    ) : null}
                    {mode === 'create' && wizardStep === 1 ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setWizardStep(2)}
                        disabled={!name.trim()}
                      >
                        下一步
                      </button>
                    ) : (
                      <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={!canSave || saving}>
                        {saving ? '保存中…' : mode === 'create' ? '创建人格' : '保存修改'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
