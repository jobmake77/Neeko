import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, FolderOpen, RefreshCw, XCircle } from 'lucide-react';
import { useAppStore } from '@/stores/app';
import { t } from '@/lib/i18n';
import {
  checkHealth,
  getBaseUrl,
  getRuntimeModelConfig,
  getRuntimeSettings,
  setBaseUrl,
  updateRuntimeModelConfig,
  updateRuntimeSettings,
} from '@/lib/api';
import { pickFiles } from '@/lib/tauri';
import type { Theme } from '@/stores/app';
import type { Locale } from '@/lib/i18n';
import type { RuntimeModelConfig, RuntimeSettingsPayload } from '@/lib/types';

type Provider = RuntimeModelConfig['provider'];
type ConfigMode = NonNullable<RuntimeModelConfig['mode']>;
type ModelRole = 'shared_default' | 'chat_default' | 'training_default';
type ServiceStatus = 'checking' | 'connected' | 'disconnected';

const MODEL_OPTIONS: Record<Provider, string[]> = {
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: ['o3', 'gpt-4o', 'gpt-4o-mini'],
  kimi: ['kimi-k2.5', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
  gemini: ['gemini-1.5-flash', 'gemini-1.5-pro'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
};

const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  kimi: 'Kimi',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
};

type CapabilityItem = {
  key: string;
  status: 'ready' | 'needs_key' | 'partial' | 'planned';
  description: string;
};

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'rgb(var(--text-secondary))', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'rgb(var(--text-primary))' }}>{label}</div>
        {desc ? <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginTop: 2 }}>{desc}</div> : null}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function ModelConfigSection() {
  const [mode, setMode] = useState<ConfigMode>('shared');
  const [provider, setProvider] = useState<Provider>('claude');
  const [keys, setKeys] = useState<RuntimeModelConfig['api_keys']>({});
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(MODEL_OPTIONS.claude[1]);
  const [roles, setRoles] = useState<Record<ModelRole, { provider: Provider; model: string }>>({
    shared_default: { provider: 'claude', model: MODEL_OPTIONS.claude[1] },
    chat_default: { provider: 'claude', model: MODEL_OPTIONS.claude[1] },
    training_default: { provider: 'claude', model: MODEL_OPTIONS.claude[1] },
  });
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getRuntimeModelConfig()
      .then((config) => {
        const nextMode = config.mode ?? 'shared';
        const shared = config.shared_default ?? { provider: config.provider, model: config.model };
        const chat = config.chat_default ?? { provider: config.provider, model: config.model };
        const training = config.training_default ?? shared;
        setMode(nextMode);
        setRoles({
          shared_default: shared,
          chat_default: chat,
          training_default: training,
        });
        setProvider(chat.provider);
        setKeys(config.api_keys);
        setApiKey(config.api_keys[chat.provider] ?? '');
        setModel(chat.model || MODEL_OPTIONS[chat.provider][0]);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleProvider(nextProvider: Provider) {
    setProvider(nextProvider);
    setApiKey(keys[nextProvider] ?? '');
    setModel((current) => MODEL_OPTIONS[nextProvider].includes(current) ? current : MODEL_OPTIONS[nextProvider][0]);
  }

  function updateRole(role: ModelRole, nextProvider: Provider, nextModel?: string) {
    setRoles((current) => ({
      ...current,
      [role]: {
        provider: nextProvider,
        model: nextModel && MODEL_OPTIONS[nextProvider].includes(nextModel) ? nextModel : MODEL_OPTIONS[nextProvider][0],
      },
    }));
  }

  async function handleSave() {
    const nextKeys = { ...keys, [provider]: apiKey.trim() };
    const nextRoles = {
      ...roles,
      chat_default: {
        provider,
        model,
      },
    };
    const nextConfig = await updateRuntimeModelConfig({
      provider: nextRoles.chat_default.provider,
      model: nextRoles.chat_default.model,
      mode,
      shared_default: nextRoles.shared_default,
      chat_default: nextRoles.chat_default,
      training_default: mode === 'split' ? nextRoles.training_default : nextRoles.shared_default,
      api_keys: nextKeys,
    });
    const shared = nextConfig.shared_default ?? { provider: nextConfig.provider, model: nextConfig.model };
    const chat = nextConfig.chat_default ?? { provider: nextConfig.provider, model: nextConfig.model };
    const training = nextConfig.training_default ?? shared;
    setKeys(nextConfig.api_keys);
    setMode(nextConfig.mode ?? 'shared');
    setRoles({
      shared_default: shared,
      chat_default: chat,
      training_default: training,
    });
    setApiKey(nextConfig.api_keys[chat.provider] ?? '');
    setProvider(chat.provider);
    setModel(chat.model);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  const capabilityItems = useMemo<CapabilityItem[]>(() => {
    const normalizedKey = apiKey.trim();
    const isKimiCodeKey = provider === 'kimi' && /^sk-kimi-/i.test(normalizedKey);
    const hasKey = normalizedKey.length > 0;

    const imageCapability = (() => {
      if (provider === 'openai' && hasKey) {
        return { key: 'capabilityImage', status: 'ready' as const, description: t('capabilityImageReadyDesc') };
      }
      if (provider === 'gemini' && hasKey) {
        return { key: 'capabilityImage', status: 'ready' as const, description: t('capabilityImageReadyDesc') };
      }
      if (provider === 'kimi' && isKimiCodeKey) {
        return { key: 'capabilityImage', status: 'partial' as const, description: t('capabilityImageKimiCodeDesc') };
      }
      if (!hasKey) {
        return { key: 'capabilityImage', status: 'needs_key' as const, description: t('capabilityImageMissingDesc') };
      }
      return { key: 'capabilityImage', status: 'planned' as const, description: t('capabilityImagePlannedDesc') };
    })();

      const transcriptionCapability = (() => {
        if (provider === 'openai' && hasKey) {
          return { status: 'ready' as const, description: t('capabilityTranscriptionOpenaiDesc') };
        }
        if (provider === 'gemini' && hasKey) {
          return { status: 'ready' as const, description: t('capabilityTranscriptionGeminiDesc') };
        }
      if (provider === 'kimi' && isKimiCodeKey) {
        return { status: 'partial' as const, description: t('capabilityTranscriptionKimiCodeDesc') };
      }
      if (!hasKey) {
        return { status: 'needs_key' as const, description: t('capabilityTranscriptionMissingDesc') };
      }
      return { status: 'planned' as const, description: t('capabilityTranscriptionMissingDesc') };
    })();

    return [
      imageCapability,
      { key: 'capabilityAudio', ...transcriptionCapability },
      { key: 'capabilityVideo', ...transcriptionCapability },
    ];
  }, [apiKey, provider]);

  return (
    <SectionCard title={t('modelConfig')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: loading ? 0.7 : 1 }}>
        <Row label="模型作用域" desc="聊天与培养可以共用一套模型，也可以拆开配置。">
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className={`btn ${mode === 'shared' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('shared')}
              style={{ fontSize: 12, padding: '4px 10px' }}
              disabled={loading}
            >
              统一
            </button>
            <button
              className={`btn ${mode === 'split' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('split')}
              style={{ fontSize: 12, padding: '4px 10px' }}
              disabled={loading}
            >
              分开
            </button>
          </div>
        </Row>

        <Row label={t('provider')}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 320 }}>
            {(Object.keys(PROVIDER_LABELS) as Provider[]).map((item) => (
              <button
                key={item}
                className={`btn ${provider === item ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleProvider(item)}
                style={{ fontSize: 12, padding: '4px 12px' }}
                disabled={loading}
              >
                {PROVIDER_LABELS[item]}
              </button>
            ))}
          </div>
        </Row>

        <Row label="API Key" desc="当前服务商的默认凭据；聊天与培养共用。">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type={showKey ? 'text' : 'password'}
              className="input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('apiKeyHint')}
              style={{ width: 220, fontSize: 12 }}
            />
            <button className="btn btn-icon" onClick={() => setShowKey((v) => !v)} style={{ width: 30, height: 30 }}>
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </Row>

        <Row label={t('modelSelect')}>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="input"
            style={{ width: 240, fontSize: 12 }}
            disabled={loading}
          >
            {MODEL_OPTIONS[provider].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </Row>

        <RoleCard
          title="聊天默认模型"
          description="聊天页默认读取这套配置，用户仍可在输入框下临时切换。"
          role={roles.chat_default}
          disabled={loading}
          onProviderChange={(nextProvider) => {
            updateRole('chat_default', nextProvider);
            setProvider(nextProvider);
            setApiKey(keys[nextProvider] ?? '');
            setModel(MODEL_OPTIONS[nextProvider][0]);
          }}
          onModelChange={(nextModel) => {
            updateRole('chat_default', roles.chat_default.provider, nextModel);
            setModel(nextModel);
          }}
        />

        <RoleCard
          title="培养默认模型"
          description={mode === 'split' ? '培养链路读取这套配置，优先选择带多模态能力的模型。' : '当前与统一配置保持一致。'}
          role={mode === 'split' ? roles.training_default : roles.shared_default}
          disabled={loading || mode !== 'split'}
          onProviderChange={(nextProvider) => updateRole('training_default', nextProvider)}
          onModelChange={(nextModel) => updateRole('training_default', roles.training_default.provider, nextModel)}
        />

        <RoleCard
          title="统一默认模型"
          description="当作用域为“统一”时，聊天与培养都走这套配置。"
          role={roles.shared_default}
          disabled={loading || mode !== 'shared'}
          onProviderChange={(nextProvider) => updateRole('shared_default', nextProvider)}
          onModelChange={(nextModel) => updateRole('shared_default', roles.shared_default.provider, nextModel)}
        />

        <Row label={t('capabilityStatus')} desc={t('capabilityProviderHint')}>
          <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {capabilityItems.map((item) => {
              const tone = getCapabilityTone(item.status);
              return (
                <div
                  key={item.key}
                  style={{
                    border: '1px solid rgb(var(--border))',
                    borderRadius: 12,
                    padding: '10px 12px',
                    background: 'rgb(var(--bg-hover))',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgb(var(--text-primary))' }}>
                      {t(item.key)}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: tone.color,
                        background: tone.background,
                        borderRadius: 999,
                        padding: '2px 7px',
                      }}
                    >
                      {tone.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'rgb(var(--text-secondary))', marginTop: 6 }}>
                    {item.description}
                  </div>
                </div>
              );
            })}
          </div>
        </Row>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={() => void handleSave()} style={{ fontSize: 12 }} disabled={loading}>
            {saved ? t('saved') : t('save')}
          </button>
        </div>
      </div>
    </SectionCard>
  );
}

function RoleCard({
  title,
  description,
  role,
  disabled,
  onProviderChange,
  onModelChange,
}: {
  title: string;
  description: string;
  role: { provider: Provider; model: string };
  disabled?: boolean;
  onProviderChange: (provider: Provider) => void;
  onModelChange: (model: string) => void;
}) {
  return (
    <div style={{ border: '1px solid rgb(var(--border))', borderRadius: 14, padding: 14, background: 'rgb(var(--bg-hover))' }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgb(var(--text-primary))' }}>{title}</div>
      <div style={{ fontSize: 11.5, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>{description}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <select
          value={role.provider}
          onChange={(e) => onProviderChange(e.target.value as Provider)}
          className="input"
          style={{ width: 140, fontSize: 12 }}
          disabled={disabled}
        >
          {(Object.keys(PROVIDER_LABELS) as Provider[]).map((item) => (
            <option key={item} value={item}>{PROVIDER_LABELS[item]}</option>
          ))}
        </select>
        <select
          value={role.model}
          onChange={(e) => onModelChange(e.target.value)}
          className="input"
          style={{ width: 220, fontSize: 12 }}
          disabled={disabled}
        >
          {(MODEL_OPTIONS[role.provider] ?? []).map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function getCapabilityTone(status: CapabilityItem['status']) {
  if (status === 'ready') {
    return {
      label: t('capabilityReady'),
      color: 'rgb(var(--success))',
      background: 'rgb(var(--success) / 0.12)',
    };
  }
  if (status === 'partial') {
    return {
      label: t('capabilityPartial'),
      color: 'rgb(var(--warning))',
      background: 'rgb(var(--warning) / 0.12)',
    };
  }
  if (status === 'planned') {
    return {
      label: t('capabilityPlanned'),
      color: 'rgb(var(--text-secondary))',
      background: 'rgb(var(--bg-active))',
    };
  }
  return {
    label: t('capabilityNeedsKey'),
    color: 'rgb(var(--destructive))',
    background: 'rgb(var(--destructive) / 0.12)',
  };
}

export function SettingsView() {
  const { theme, setTheme, locale, setLocale } = useAppStore();
  const [apiUrl, setApiUrlState] = useState(getBaseUrl());
  const [status, setStatus] = useState<ServiceStatus>('checking');
  const [urlSaved, setUrlSaved] = useState(false);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeSaved, setRuntimeSaved] = useState(false);
  const [runtimeSettings, setRuntimeSettingsState] = useState<RuntimeSettingsPayload>({});

  useEffect(() => {
    void checkStatus();
    getRuntimeSettings()
      .then((settings) => setRuntimeSettingsState(settings))
      .finally(() => setRuntimeLoading(false));
  }, []);

  async function checkStatus() {
    setStatus('checking');
    const result = await checkHealth();
    setStatus(result.ok ? 'connected' : 'disconnected');
  }

  function handleSaveUrl() {
    setBaseUrl(apiUrl.trim());
    setUrlSaved(true);
    window.setTimeout(() => setUrlSaved(false), 1800);
    void checkStatus();
  }

  async function handleSaveRuntimeSettings() {
    const next = await updateRuntimeSettings(runtimeSettings);
    setRuntimeSettingsState(next);
    setRuntimeSaved(true);
    window.setTimeout(() => setRuntimeSaved(false), 1800);
  }

  async function handlePickDataDir() {
    const paths = await pickFiles({ directory: true, multiple: false });
    if (paths[0]) {
      setRuntimeSettingsState((current) => ({ ...current, data_dir: paths[0] }));
    }
  }

  const THEMES: { value: Theme; labelKey: string }[] = [
    { value: 'light', labelKey: 'themeLight' },
    { value: 'dark', labelKey: 'themeDark' },
    { value: 'system', labelKey: 'themeSystem' },
  ];

  const LOCALES: { value: Locale; label: string }[] = [
    { value: 'zh', label: '中文' },
    { value: 'en', label: 'English' },
  ];

  const statusNode = useMemo(() => {
    if (status === 'checking') {
      return (
        <>
          <RefreshCw size={14} style={{ color: 'rgb(var(--text-tertiary))', animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 13, color: 'rgb(var(--text-tertiary))' }}>{t('loading')}</span>
        </>
      );
    }
    if (status === 'connected') {
      return (
        <>
          <CheckCircle2 size={14} style={{ color: 'rgb(34 197 94)' }} />
          <span style={{ fontSize: 13, color: 'rgb(34 197 94)' }}>{t('connected')}</span>
        </>
      );
    }
    return (
      <>
        <XCircle size={14} style={{ color: 'rgb(239 68 68)' }} />
        <span style={{ fontSize: 13, color: 'rgb(239 68 68)' }}>{t('disconnected')}</span>
      </>
    );
  }, [status]);

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24, maxWidth: 720 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'rgb(var(--text-primary))', margin: 0 }}>{t('settings')}</h1>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SectionCard title={t('connection')}>
          <Row label={t('apiUrl')} desc={t('apiUrlDesc')}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                value={apiUrl}
                onChange={(e) => setApiUrlState(e.target.value)}
                style={{ width: 260, fontSize: 12 }}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveUrl()}
              />
              <button className="btn btn-secondary" onClick={handleSaveUrl} style={{ fontSize: 12 }}>
                {urlSaved ? t('saved') : t('save')}
              </button>
            </div>
          </Row>

          <Row label={t('serviceStatus')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {statusNode}
              <button className="btn btn-ghost" onClick={() => void checkStatus()} style={{ padding: '3px 8px', fontSize: 11 }}>
                {t('checkStatus')}
              </button>
            </div>
          </Row>

          <Row label={t('dataDir')} desc="本地人格资产与运行数据目录。">
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                value={runtimeSettings.data_dir ?? ''}
                onChange={(e) => setRuntimeSettingsState((current) => ({ ...current, data_dir: e.target.value }))}
                style={{ width: 260, fontSize: 12 }}
                placeholder="/Users/you/.neeko"
                disabled={runtimeLoading}
              />
              <button className="btn btn-secondary" onClick={() => void handlePickDataDir()} disabled={runtimeLoading}>
                <FolderOpen size={14} />
                {t('browse')}
              </button>
            </div>
          </Row>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={() => void handleSaveRuntimeSettings()} disabled={runtimeLoading}>
              {runtimeSaved ? t('saved') : t('save')}
            </button>
          </div>
        </SectionCard>

        <SectionCard title={t('appearance')}>
          <Row label={t('theme')}>
            <div style={{ display: 'flex', gap: 4 }}>
              {THEMES.map((opt) => (
                <button
                  key={opt.value}
                  className={`btn ${theme === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setTheme(opt.value)}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </Row>

          <Row label={t('language')}>
            <div style={{ display: 'flex', gap: 4 }}>
              {LOCALES.map((opt) => (
                <button
                  key={opt.value}
                  className={`btn ${locale === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setLocale(opt.value)}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Row>
        </SectionCard>

        <ModelConfigSection />
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
