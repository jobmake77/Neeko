import { NavView } from '../lib/types';

const NAV_ITEMS: NavView[] = ['Chat', 'Create', 'Train', 'Experiment', 'Export', 'Settings'];

interface NavigationRailProps {
  activeView: NavView;
  onChange: (view: NavView) => void;
}

export function NavigationRail({ activeView, onChange }: NavigationRailProps) {
  return (
    <aside className="nav-rail panel">
      <div>
        <p className="eyebrow">Neeko</p>
        <h1>Workbench</h1>
      </div>
      <nav className="nav-list">
        {NAV_ITEMS.map((item) => (
          <button
            key={item}
            type="button"
            className={item === activeView ? 'nav-item active' : 'nav-item'}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ))}
      </nav>
    </aside>
  );
}
