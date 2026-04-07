import { ShellView } from '../lib/types';

interface MiniRailProps {
  activeView: ShellView;
  personaName: string | null;
  onChangeView: (view: ShellView) => void;
  onCreateThread: () => void;
}

export function MiniRail({ activeView, personaName, onChangeView, onCreateThread }: MiniRailProps) {
  return (
    <aside className="mini-rail panel">
      <div className="mini-rail-group">
        <button
          type="button"
          className="mini-rail-brand"
          onClick={() => onChangeView('chat')}
          title={personaName ? `Current persona: ${personaName}` : 'Open chat'}
        >
          N
        </button>
        <div className="mini-rail-persona">
          <span className="eyebrow">Persona</span>
          <strong>{personaName ?? 'None'}</strong>
        </div>
      </div>

      <nav className="mini-rail-nav">
        <button
          type="button"
          className={activeView === 'chat' ? 'mini-rail-button active' : 'mini-rail-button'}
          onClick={() => onChangeView('chat')}
          title="Chat"
        >
          C
        </button>
        <button
          type="button"
          className="mini-rail-button"
          onClick={onCreateThread}
          title="New thread"
        >
          +
        </button>
      </nav>

      <div className="mini-rail-footer">
        <button
          type="button"
          className={activeView === 'settings' ? 'mini-rail-button active' : 'mini-rail-button'}
          onClick={() => onChangeView('settings')}
          title="Settings"
        >
          S
        </button>
      </div>
    </aside>
  );
}
