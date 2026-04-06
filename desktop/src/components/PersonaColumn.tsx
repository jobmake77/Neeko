import { PersonaSummary } from '../lib/types';

interface PersonaColumnProps {
  personas: PersonaSummary[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}

export function PersonaColumn({ personas, selectedSlug, onSelect }: PersonaColumnProps) {
  return (
    <section className="panel column persona-column">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Personas</p>
          <h2>Active Cast</h2>
        </div>
        <span className="badge">{personas.length}</span>
      </div>
      <div className="persona-list">
        {personas.map((persona) => (
          <button
            key={persona.slug}
            type="button"
            className={persona.slug === selectedSlug ? 'list-card active' : 'list-card'}
            onClick={() => onSelect(persona.slug)}
          >
            <div className="list-card-top">
              <strong>{persona.name}</strong>
              <span className={`status-chip status-${persona.status}`}>{persona.status}</span>
            </div>
            <p>{persona.slug}</p>
            <small>
              {persona.doc_count} docs · {persona.memory_node_count} memory · {persona.training_rounds} rounds
            </small>
          </button>
        ))}
        {personas.length === 0 ? <div className="empty-state">No personas yet.</div> : null}
      </div>
    </section>
  );
}
