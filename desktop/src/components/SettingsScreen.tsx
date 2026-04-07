import { SettingsSection } from '../lib/types';
import { WorkbenchForms, WorkbenchFormsProps } from './WorkbenchForms';

interface SettingsScreenProps extends Omit<WorkbenchFormsProps, 'activeView' | 'embedded'> {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

const SECTION_CONFIG: Array<{
  id: SettingsSection;
  title: string;
  summary: string;
  view: WorkbenchFormsProps['activeView'];
}> = [
  {
    id: 'persona',
    title: 'Persona',
    summary: 'Create personas, point to target manifests, and manage source inputs.',
    view: 'Create',
  },
  {
    id: 'training',
    title: 'Training',
    summary: 'Launch training, attach evidence context, and run smoke verification.',
    view: 'Train',
  },
  {
    id: 'experiment',
    title: 'Experiment',
    summary: 'Compare profiles, routing strategies, and seed modes without leaving the client.',
    view: 'Experiment',
  },
  {
    id: 'export',
    title: 'Export',
    summary: 'Export persona artifacts and keep the output path easy to recover later.',
    view: 'Export',
  },
  {
    id: 'runtime',
    title: 'Runtime',
    summary: 'Check the local service, bundled runtime, and recovery readiness.',
    view: 'Settings',
  },
];

export function SettingsScreen({ activeSection, onSectionChange, ...formProps }: SettingsScreenProps) {
  return (
    <section className="settings-screen panel">
      <div className="settings-screen-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Workbench Controls</h2>
          <p className="settings-screen-copy">
            Advanced actions stay here so the main surface can stay focused on conversation.
          </p>
        </div>
      </div>

      <div className="settings-section-pills">
        {SECTION_CONFIG.map((section) => (
          <button
            key={section.id}
            type="button"
            className={section.id === activeSection ? 'settings-pill active' : 'settings-pill'}
            onClick={() => onSectionChange(section.id)}
          >
            {section.title}
          </button>
        ))}
      </div>

      <div className="settings-section-stack">
        {SECTION_CONFIG.map((section) => {
          const open = section.id === activeSection;
          return (
            <section key={section.id} className={open ? 'settings-group active' : 'settings-group'}>
              <button
                type="button"
                className="settings-group-header"
                onClick={() => onSectionChange(section.id)}
              >
                <div>
                  <strong>{section.title}</strong>
                  <p>{section.summary}</p>
                </div>
                <span className={open ? 'badge success' : 'badge'}>{open ? 'open' : 'show'}</span>
              </button>
              {open ? (
                <div className="settings-group-body">
                  <WorkbenchForms {...formProps} activeView={section.view} embedded />
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}
