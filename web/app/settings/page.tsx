'use client';

import { Database, ChevronDown, ChevronUp, Globe, Code2 } from 'lucide-react';
import { useState, useEffect } from 'react';

type IngestMode = 'opencli' | 'api';
type ProviderId = 'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek';

interface ProviderConfig {
  key: string;
  expanded: boolean;
}

export default function SettingsPage() {
  const [ingestMode, setIngestMode] = useState<IngestMode>('opencli');
  const [twitterKey, setTwitterKey] = useState('');

  const [providers, setProviders] = useState<Record<ProviderId, ProviderConfig>>({
    claude: { key: '', expanded: true },
    openai: { key: '', expanded: false },
    kimi:   { key: '', expanded: false },
    gemini: { key: '', expanded: false },
    deepseek: { key: '', expanded: false },
  });

  const [activeProvider, setActiveProvider] = useState<ProviderId>('claude');
  const [qdrantUrl, setQdrantUrl] = useState('http://localhost:6333');
  const [saved, setSaved] = useState(false);

  // Load saved config on mount
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.ingestMode) setIngestMode(cfg.ingestMode as IngestMode);
        if (cfg.twitterApiKey) setTwitterKey(cfg.twitterApiKey);
        if (cfg.activeProvider) setActiveProvider(cfg.activeProvider as ProviderId);
        if (cfg.qdrantUrl) setQdrantUrl(cfg.qdrantUrl);
        setProviders((prev) => ({
          claude: { ...prev.claude, key: cfg.anthropicApiKey || '' },
          openai: { ...prev.openai, key: cfg.openaiApiKey    || '' },
          kimi:   { ...prev.kimi,   key: cfg.kimiApiKey      || '' },
          gemini: { ...prev.gemini, key: cfg.geminiApiKey    || '' },
          deepseek: { ...prev.deepseek, key: cfg.deepseekApiKey || '' },
        }));
      })
      .catch(() => {/* ignore */});
  }, []);

  function updateProvider(name: ProviderId, patch: Partial<ProviderConfig>) {
    setProviders((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  }

  function handleSave() {
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anthropicApiKey: providers.claude.key,
        openaiApiKey:    providers.openai.key,
        kimiApiKey:      providers.kimi.key,
        geminiApiKey:    providers.gemini.key,
        deepseekApiKey:  providers.deepseek.key,
        qdrantUrl,
        activeProvider,
        ingestMode,
        twitterApiKey:   twitterKey,
      }),
    })
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch(() => alert('保存失败，请检查服务是否运行'));
  }

  const providerDefs: { id: ProviderId; label: string; placeholder: string; hint: string }[] = [
    {
      id: 'claude',
      label: 'Claude（Anthropic）',
      placeholder: 'sk-ant-...',
      hint: 'Soul 提炼 + 对话，claude-sonnet-4-6 / claude-haiku-4-5',
    },
    {
      id: 'openai',
      label: 'OpenAI',
      placeholder: 'sk-...',
      hint: 'Embedding（text-embedding-3-small）+ 音视频转录（Whisper）',
    },
    {
      id: 'kimi',
      label: 'Kimi（月之暗面）',
      placeholder: 'sk-...',
      hint: 'Soul 提炼 + 对话',
    },
    {
      id: 'gemini',
      label: 'Gemini（Google）',
      placeholder: 'AIza...',
      hint: 'Soul 提炼 + 对话',
    },
    {
      id: 'deepseek',
      label: 'DeepSeek',
      placeholder: 'sk-...',
      hint: 'Soul 提炼 + 对话（deepseek-chat）',
    },
  ];

  return (
    <div className="p-8 max-w-[700px]">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-[oklch(0.15_0_0)]">设置</h1>
      </div>
      <p className="text-[14px] text-[oklch(0.55_0_0)] mb-8">配置数据摄取方式、模型和基础服务</p>

      <div className="space-y-6">
        {/* Section A: 数据摄取方式 */}
        <div>
          <h2 className="text-[13px] font-semibold text-[oklch(0.45_0_0)] uppercase tracking-wider mb-3">
            数据摄取方式
          </h2>
          <div className="bg-white rounded-2xl border border-[oklch(0.91_0_0)] p-5 space-y-3">
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                ingestMode === 'opencli'
                  ? 'border-[oklch(0.72_0.18_142)] bg-[oklch(0.97_0.02_142)]'
                  : 'border-[oklch(0.91_0_0)] hover:bg-[oklch(0.98_0_0)]'
              }`}
            >
              <input
                type="radio"
                name="ingestMode"
                value="opencli"
                checked={ingestMode === 'opencli'}
                onChange={() => setIngestMode('opencli')}
                className="mt-0.5 accent-[oklch(0.55_0.18_142)]"
              />
              <div>
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-[oklch(0.55_0_0)]" />
                  <span className="text-[13.5px] font-medium text-[oklch(0.2_0_0)]">
                    OpenCLI 模式（浏览器，免 API）
                  </span>
                  <span className="text-[11px] bg-[oklch(0.94_0.05_142)] text-[oklch(0.3_0.12_142)] px-2 py-0.5 rounded-full">
                    默认
                  </span>
                </div>
                <p className="text-[12px] text-[oklch(0.55_0_0)] mt-1">
                  通过浏览器抓取数据，无需 Twitter API Key。确保 Chrome 已登录 X.com。
                </p>
              </div>
            </label>

            <label
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                ingestMode === 'api'
                  ? 'border-[oklch(0.72_0.18_142)] bg-[oklch(0.97_0.02_142)]'
                  : 'border-[oklch(0.91_0_0)] hover:bg-[oklch(0.98_0_0)]'
              }`}
            >
              <input
                type="radio"
                name="ingestMode"
                value="api"
                checked={ingestMode === 'api'}
                onChange={() => setIngestMode('api')}
                className="mt-0.5 accent-[oklch(0.55_0.18_142)]"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Code2 className="w-3.5 h-3.5 text-[oklch(0.55_0_0)]" />
                  <span className="text-[13.5px] font-medium text-[oklch(0.2_0_0)]">
                    API 模式（需要 Twitter API Key）
                  </span>
                </div>
                <p className="text-[12px] text-[oklch(0.55_0_0)] mt-1">
                  通过 Twitter 官方 API 拉取数据，速率限制更稳定。
                </p>
                {ingestMode === 'api' && (
                  <div className="mt-3">
                    <label className="block text-[12px] text-[oklch(0.5_0_0)] mb-1.5">
                      Twitter API Key
                    </label>
                    <input
                      type="password"
                      value={twitterKey}
                      onChange={(e) => setTwitterKey(e.target.value)}
                      placeholder="AAAAAAAAAAAAAAAAAAAAAxxxxxx..."
                      className="w-full px-3 py-2.5 bg-[oklch(0.97_0_0)] border border-[oklch(0.88_0_0)] rounded-xl text-[13.5px] outline-none focus:ring-2 focus:ring-[oklch(0.72_0.18_142)] transition-all"
                    />
                  </div>
                )}
              </div>
            </label>
          </div>
        </div>

        {/* Section B: 模型配置 */}
        <div>
          <h2 className="text-[13px] font-semibold text-[oklch(0.45_0_0)] uppercase tracking-wider mb-3">
            模型配置
          </h2>
          <div className="bg-white rounded-2xl border border-[oklch(0.91_0_0)] divide-y divide-[oklch(0.93_0_0)]">
            {providerDefs.map((p) => {
              const cfg = providers[p.id];
              const isConfigured = cfg.key.trim().length > 0;
              return (
                <div key={p.id}>
                  <button
                    onClick={() => updateProvider(p.id, { expanded: !cfg.expanded })}
                    className="w-full flex items-center gap-3 px-5 py-4 hover:bg-[oklch(0.98_0_0)] transition-colors text-left"
                  >
                    <span className="flex-1 text-[14px] font-medium text-[oklch(0.2_0_0)]">
                      {p.label}
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full ${
                        isConfigured
                          ? 'bg-[oklch(0.92_0.06_142)] text-[oklch(0.35_0.15_142)]'
                          : 'bg-[oklch(0.95_0_0)] text-[oklch(0.55_0_0)]'
                      }`}
                    >
                      {isConfigured ? '已填写' : '未填写'}
                    </span>
                    {cfg.expanded ? (
                      <ChevronUp className="w-4 h-4 text-[oklch(0.6_0_0)]" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[oklch(0.6_0_0)]" />
                    )}
                  </button>
                  {cfg.expanded && (
                    <div className="px-5 pb-4">
                      <label className="block text-[12.5px] text-[oklch(0.5_0_0)] mb-1.5">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={cfg.key}
                        onChange={(e) => updateProvider(p.id, { key: e.target.value })}
                        placeholder={p.placeholder}
                        className="w-full px-3 py-2.5 bg-[oklch(0.97_0_0)] border border-[oklch(0.88_0_0)] rounded-xl text-[13.5px] outline-none focus:ring-2 focus:ring-[oklch(0.72_0.18_142)] transition-all"
                      />
                      <p className="text-[11.5px] text-[oklch(0.65_0_0)] mt-1.5">{p.hint}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 当前使用模型 */}
          <div className="mt-4">
            <p className="text-[12.5px] text-[oklch(0.5_0_0)] mb-3">当前使用模型</p>
            <div className="flex gap-2 flex-wrap">
              {providerDefs.map((p) => {
                const isActive = activeProvider === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setActiveProvider(p.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium border transition-all ${
                      isActive
                        ? 'bg-[oklch(0.15_0_0)] text-white border-[oklch(0.15_0_0)]'
                        : 'bg-white text-[oklch(0.4_0_0)] border-[oklch(0.88_0_0)] hover:border-[oklch(0.6_0_0)] hover:text-[oklch(0.2_0_0)]'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        isActive ? 'bg-white' : 'bg-[oklch(0.85_0_0)]'
                      }`}
                    />
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section C: Qdrant */}
        <div>
          <h2 className="text-[13px] font-semibold text-[oklch(0.45_0_0)] uppercase tracking-wider mb-3">
            向量数据库
          </h2>
          <div className="bg-white rounded-2xl border border-[oklch(0.91_0_0)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Database className="w-4 h-4 text-[oklch(0.55_0_0)]" />
              <p className="text-[14px] font-semibold text-[oklch(0.25_0_0)]">Qdrant</p>
            </div>
            <label className="block text-[12.5px] text-[oklch(0.5_0_0)] mb-1.5">服务地址</label>
            <input
              value={qdrantUrl}
              onChange={(e) => setQdrantUrl(e.target.value)}
              placeholder="http://localhost:6333"
              className="w-full px-3 py-2.5 bg-[oklch(0.97_0_0)] border border-[oklch(0.88_0_0)] rounded-xl text-[13.5px] outline-none focus:ring-2 focus:ring-[oklch(0.72_0.18_142)] transition-all"
            />
            <p className="text-[11.5px] text-[oklch(0.65_0_0)] mt-1.5">
              本地启动：
              <code className="bg-[oklch(0.94_0_0)] px-1 rounded text-[11px]">
                docker run -p 6333:6333 qdrant/qdrant
              </code>
            </p>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="px-6 py-2.5 rounded-xl bg-[oklch(0.15_0_0)] text-white text-[13.5px] font-medium hover:bg-[oklch(0.25_0_0)] transition-colors"
        >
          {saved ? '✓ 已保存' : '保存配置'}
        </button>
      </div>
    </div>
  );
}
