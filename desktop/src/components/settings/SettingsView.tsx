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
  const [provider, setProvider] = useState<Provider>('claude');
  const [keys, setKeys] = useState<RuntimeModelConfig['api_keys']>({});
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(MODEL_OPTIONS.claude[1]);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getRuntimeModelConfig()
      .then((config) => {
        setProvider(config.provider);
        setKeys(config.api_keys);
        setApiKey(config.api_keys[config.provider] ?? '');
        setModel(config.model || MODEL_OPTIONS[config.provider][0]);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleProvider(nextProvider: Provider) {
    setProvider(nextProvider);
    setApiKey(keys[nextProvider] ?? '');
    setModel((current) => MODEL_OPTIONS[nextProvider].includes(current) ? current : MODEL_OPTIONS[nextProvider][0]);
  }

  async function handleSave() {
    const nextKeys = { ...keys, [provider]: apiKey.trim() };
    const nextConfig = await updateRuntimeModelConfig({ provider, model, api_keys: nextKeys });
    setKeys(nextConfig.api_keys);
    setApiKey(nextConfig.api_keys[nextConfig.provider] ?? '');
    setProvider(nextConfig.provider);
    setModel(nextConfig.model);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <SectionCard title={t('modelConfig')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: loading ? 0.7 : 1 }}>
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

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={() => void handleSave()} style={{ fontSize: 12 }} disabled={loading}>
            {saved ? t('saved') : t('save')}
          </button>
        </div>
      </div>
    </SectionCard>
  );
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
