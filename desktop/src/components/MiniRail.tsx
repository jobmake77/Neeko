import { ShellView } from '../lib/types';
import { formatCurrentPersonaTitle, useI18n } from '../lib/i18n';

interface MiniRailProps {
  activeView: ShellView;
  personaName: string | null;
  onChangeView: (view: ShellView) => void;
  onCreateThread: () => void;
}

export function MiniRail({ activeView, personaName, onChangeView, onCreateThread }: MiniRailProps) {
  const { locale, t } = useI18n();
  return (
    <aside className="mini-rail panel">
      <div className="mini-rail-group">
        <button
          type="button"
          className="mini-rail-brand"
          onClick={() => onChangeView('chat')}
          title={formatCurrentPersonaTitle(personaName, locale)}
        >
          N
        </button>
        <div className="mini-rail-persona">
          <span className="eyebrow">{t('Persona')}</span>
          <strong>{personaName ?? t('None')}</strong>
        </div>
      </div>

      <nav className="mini-rail-nav">
        <button
          type="button"
          className={activeView === 'chat' ? 'mini-rail-button active' : 'mini-rail-button'}
          onClick={() => onChangeView('chat')}
          title={t('Chat')}
        >
          C
        </button>
        <button
          type="button"
          className="mini-rail-button"
          onClick={onCreateThread}
          title={t('New thread')}
        >
          +
        </button>
      </nav>

      <div className="mini-rail-footer">
        <button
          type="button"
          className={activeView === 'settings' ? 'mini-rail-button active' : 'mini-rail-button'}
          onClick={() => onChangeView('settings')}
          title={t('Settings')}
        >
          S
        </button>
      </div>
    </aside>
  );
}
