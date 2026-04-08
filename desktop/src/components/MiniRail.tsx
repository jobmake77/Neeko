import { ShellView } from '../lib/types';
import { useI18n } from '../lib/i18n';

interface MiniRailProps {
  activeView: ShellView;
  onChangeView: (view: ShellView) => void;
}

export function MiniRail({ activeView, onChangeView }: MiniRailProps) {
  const { locale } = useI18n();
  const isZh = locale === 'zh-CN';

  const items: Array<{ key: ShellView; label: string; short: string }> = [
    { key: 'chat', label: isZh ? '聊天' : 'Chat', short: '聊' },
    { key: 'personas', label: isZh ? '人格库' : 'Personas', short: '库' },
    { key: 'settings', label: isZh ? '设置' : 'Settings', short: '设' },
  ];

  return (
    <aside className="mini-rail">
      <button type="button" className="brand-mark" onClick={() => onChangeView('chat')} aria-label="Neeko">
        N
      </button>
      <nav className="rail-nav">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={activeView === item.key ? 'rail-button active' : 'rail-button'}
            onClick={() => onChangeView(item.key)}
            title={item.label}
          >
            <span className="rail-button-short">{item.short}</span>
            <span className="rail-button-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
