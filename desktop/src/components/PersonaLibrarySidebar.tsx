import { useMemo, useState } from 'react';
import { PersonaSummary } from '../lib/types';
import { useI18n } from '../lib/i18n';

interface PersonaLibrarySidebarProps {
  personas: PersonaSummary[];
  selectedPersonaSlug: string | null;
  onSelectPersona: (slug: string) => void;
  onCreatePersona: () => void;
}

export function PersonaLibrarySidebar({ personas, selectedPersonaSlug, onSelectPersona, onCreatePersona }: PersonaLibrarySidebarProps) {
  const { locale } = useI18n();
  const isZh = locale === 'zh-CN';
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return personas;
    return personas.filter((persona) => `${persona.name} ${persona.slug}`.toLowerCase().includes(normalized));
  }, [personas, query]);

  return (
    <aside className="sidebar-panel">
      <div className="sidebar-header persona-sidebar-header">
        <div>
          <p className="sidebar-eyebrow">{isZh ? '人格库' : 'Persona Library'}</p>
          <h2>{isZh ? '已创建的人格' : 'Saved Personas'}</h2>
        </div>
        <button type="button" className="ghost-button" onClick={onCreatePersona}>
          {isZh ? '新建人格' : 'New'}
        </button>
      </div>

      <label className="search-field">
        <span>{isZh ? '搜索人格' : 'Search personas'}</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isZh ? '按名称或标识查找' : 'Find by name or slug'} />
      </label>

      <div className="list-stack">
        {filtered.map((persona) => (
          <button
            key={persona.slug}
            type="button"
            className={persona.slug === selectedPersonaSlug ? 'persona-card active' : 'persona-card'}
            onClick={() => onSelectPersona(persona.slug)}
          >
            <div className="thread-card-top">
              <strong>{persona.name}</strong>
              <span>{statusLabel(persona.status, isZh)}</span>
            </div>
            <p>{persona.slug}</p>
            <small>{isZh ? '更新于' : 'Updated'} {new Date(persona.updated_at).toLocaleString()}</small>
          </button>
        ))}
        {personas.length === 0 ? <div className="empty-note">{isZh ? '还没有人格，先创建一个。' : 'No personas yet. Create your first one.'}</div> : null}
        {personas.length > 0 && filtered.length === 0 ? <div className="empty-note">{isZh ? '没有匹配的人格。' : 'No matching personas.'}</div> : null}
      </div>
    </aside>
  );
}

function statusLabel(status: string, isZh: boolean): string {
  if (['creating'].includes(status)) return isZh ? '创建中' : 'Creating';
  if (['training', 'ingesting', 'refining', 'updating'].includes(status)) return isZh ? '更新中' : 'Updating';
  if (['converged', 'exported', 'available'].includes(status)) return isZh ? '可用' : 'Ready';
  return isZh ? '可用' : 'Ready';
}
