import { useI18n } from '../lib/i18n';

interface SettingsScreenProps {
  apiBaseUrl: string;
  repoRoot: string;
  dataDir: string;
  serviceHealthy: boolean;
  onApiBaseUrlChange: (value: string) => void;
  onRepoRootChange: (value: string) => void;
  onDataDirChange: (value: string) => void;
  onRefreshConnection: () => Promise<void>;
}

export function SettingsScreen({
  apiBaseUrl,
  repoRoot,
  dataDir,
  serviceHealthy,
  onApiBaseUrlChange,
  onRepoRootChange,
  onDataDirChange,
  onRefreshConnection,
}: SettingsScreenProps) {
  const { locale, setLocale } = useI18n();
  const isZh = locale === 'zh-CN';

  return (
    <section className="screen settings-screen">
      <header className="screen-header compact-gap">
        <div>
          <p className="screen-eyebrow">{isZh ? '基础设置' : 'Basic Settings'}</p>
          <h1>{isZh ? '只保留必要配置' : 'Only the essentials'}</h1>
          <p className="screen-subtitle">
            {isZh ? '这里不展示训练、实验或内部诊断术语，只保留连接和语言等基础项。' : 'Training and internal diagnostics stay hidden here too.'}
          </p>
        </div>
        <div className={serviceHealthy ? 'service-pill healthy' : 'service-pill'}>
          {serviceHealthy ? (isZh ? '连接正常' : 'Connected') : (isZh ? '连接异常' : 'Offline')}
        </div>
      </header>

      <div className="settings-grid">
        <section className="detail-card wide">
          <h3>{isZh ? '连接' : 'Connection'}</h3>
          <label className="field-block">
            <span>{isZh ? 'API 地址' : 'API Address'}</span>
            <input value={apiBaseUrl} onChange={(event) => onApiBaseUrlChange(event.target.value)} placeholder="http://127.0.0.1:4310" />
          </label>
          <label className="field-block">
            <span>{isZh ? '仓库根目录' : 'Repository Root'}</span>
            <input value={repoRoot} onChange={(event) => onRepoRootChange(event.target.value)} placeholder="/absolute/path/to/Neeko" />
          </label>
          <label className="field-block">
            <span>{isZh ? '数据目录' : 'Data Directory'}</span>
            <input value={dataDir} onChange={(event) => onDataDirChange(event.target.value)} placeholder="/absolute/path/to/data" />
          </label>
          <div className="form-actions">
            <button type="button" className="primary-button" onClick={() => void onRefreshConnection()}>
              {isZh ? '刷新连接' : 'Refresh Connection'}
            </button>
          </div>
        </section>

        <section className="detail-card">
          <h3>{isZh ? '语言' : 'Language'}</h3>
          <div className="language-switcher">
            <button type="button" className={locale === 'zh-CN' ? 'ghost-button active' : 'ghost-button'} onClick={() => setLocale('zh-CN')}>
              中文
            </button>
            <button type="button" className={locale === 'en-US' ? 'ghost-button active' : 'ghost-button'} onClick={() => setLocale('en-US')}>
              English
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
