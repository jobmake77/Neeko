import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useAppStore } from '@/stores/app';
import { t } from '@/lib/i18n';
import { getBaseUrl, setBaseUrl, checkHealth } from '@/lib/api';
import type { Theme } from '@/stores/app';
import type { Locale } from '@/lib/i18n';

type Provider = 'claude' | 'openai' | 'kimi';

const MODEL_OPTIONS: Record<Provider, string[]> = {
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: ['o3', 'gpt-4o', 'gpt-4o-mini'],
  kimi:   ['kimi-k2.5', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
};

const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  kimi:   'Kimi',
};

function loadModelConfig() {
  try { return JSON.parse(localStorage.getItem('neeko.modelConfig') || '{}'); } catch { return {}; }
}

function ModelConfigSection() {
  const [provider, setProvider] = useState<Provider>(() => loadModelConfig().provider || 'claude');
  const [apiKey, setApiKey] = useState(() => loadModelConfig().apiKey || '');
  const [model, setModel] = useState(() => loadModelConfig().model || MODEL_OPTIONS.claude[1]);
  const [showKey, setShowKey] = useState(false);
  const [savedModel, setSavedModel] = useState(false);

  // 切换 provider 时重置 model 为该 provider 默认值
  function handleProvider(p: Provider) {
    setProvider(p);
    const saved = loadModelConfig();
    setApiKey(saved[`apiKey_${p}`] || '');
    setModel(MODEL_OPTIONS[p][1] || MODEL_OPTIONS[p][0]);
  }

  function handleSave() {
    const existing = loadModelConfig();
    localStorage.setItem('neeko.modelConfig', JSON.stringify({
      ...existing,
      provider,
      model,
      [`apiKey_${provider}`]: apiKey,
      apiKey, // active key
    }));
    setSavedModel(true);
    setTimeout(() => setSavedModel(false), 2000);
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'rgb(var(--text-secondary))', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {t('modelConfig')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 服务商 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: 'rgb(var(--text-primary))' }}>{t('provider')}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
              <button key={p}
                className={`btn ${provider === p ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleProvider(p)}
                style={{ fontSize: 12, padding: '4px 12px' }}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* API Key */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: 'rgb(var(--text-primary))' }}>API Key</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type={showKey ? 'text' : 'password'}
              className="input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('apiKeyHint')}
              style={{ width: 200, fontSize: 12 }}
            />
            <button className="btn btn-icon" onClick={() => setShowKey((v) => !v)} style={{ width: 30, height: 30 }}>
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </div>

        {/* 模型 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: 'rgb(var(--text-primary))' }}>{t('modelSelect')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="input"
              style={{ width: 220, fontSize: 12 }}
            >
              {MODEL_OPTIONS[provider].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 保存 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={handleSave} style={{ fontSize: 12 }}>
            {savedModel ? t('saved') : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

type ServiceStatus = 'checking' | 'connected' | 'disconnected';

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'rgb(var(--text-secondary))', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'rgb(var(--text-primary))' }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export function SettingsView() {
  const { theme, setTheme, locale, setLocale } = useAppStore();
  const [apiUrl, setApiUrlState] = useState(getBaseUrl());
  const [status, setStatus] = useState<ServiceStatus>('checking');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    setStatus('checking');
    const result = await checkHealth();
    setStatus(result.ok ? 'connected' : 'disconnected');
  }

  function handleSaveUrl() {
    setBaseUrl(apiUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    checkStatus();
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

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24, maxWidth: 600 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'rgb(var(--text-primary))', margin: 0 }}>
          {t('settings')}
        </h1>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 连接配置 */}
        <SectionCard title={t('connection')}>
          <Row label={t('apiUrl')} desc={t('apiUrlDesc')}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                value={apiUrl}
                onChange={(e) => setApiUrlState(e.target.value)}
                style={{ width: 220, fontSize: 12 }}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveUrl()}
              />
              <button className="btn btn-secondary" onClick={handleSaveUrl} style={{ fontSize: 12 }}>
                {saved ? t('saved') : t('save')}
              </button>
            </div>
          </Row>

          <Row label={t('serviceStatus')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {status === 'checking' ? (
                <RefreshCw size={14} style={{ color: 'rgb(var(--text-tertiary))', animation: 'spin 1s linear infinite' }} />
              ) : status === 'connected' ? (
                <CheckCircle2 size={14} style={{ color: 'rgb(34 197 94)' }} />
              ) : (
                <XCircle size={14} style={{ color: 'rgb(239 68 68)' }} />
              )}
              <span style={{ fontSize: 13, color: status === 'connected' ? 'rgb(34 197 94)' : status === 'disconnected' ? 'rgb(239 68 68)' : 'rgb(var(--text-tertiary))' }}>
                {status === 'checking' ? t('loading') : status === 'connected' ? t('connected') : t('disconnected')}
              </span>
              <button className="btn btn-ghost" onClick={checkStatus} style={{ padding: '3px 8px', fontSize: 11 }}>
                {t('checkStatus')}
              </button>
            </div>
          </Row>
        </SectionCard>

        {/* 外观 */}
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
                  onClick={() => setLocale(opt.value as Locale)}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Row>
        </SectionCard>
        {/* 模型配置 */}
        <ModelConfigSection />
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
