import React, { useState } from 'react';
import { t } from '@/lib/i18n';
import type { PersonaSummary } from '@/lib/types';
import { useChatStore } from '@/stores/chat';
import { useAppStore } from '@/stores/app';
import { Edit2, Trash2 } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  creating:   '#f59e0b',
  created:    '#94a3b8',
  ingesting:  '#f59e0b',
  refining:   '#f59e0b',
  training:   '#f59e0b',
  converged:  '#22c55e',
  exported:   '#22c55e',
  available:  '#22c55e',
  pending:    '#94a3b8',
  building:   '#f59e0b',
  ready:      '#22c55e',
  error:      '#ef4444',
};

interface Props {
  persona: PersonaSummary;
  onEdit: () => void;
  onDelete: () => void;
}

export function PersonaCard({ persona, onEdit, onDelete }: Props) {
  const { setPersona } = useChatStore();
  const { setView } = useAppStore();
  const [hovered, setHovered] = useState(false);

  function handleCardClick() {
    setPersona(persona.slug);
    setView('chat');
  }

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation();
    onEdit();
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    onDelete();
  }

  const statusColor = STATUS_COLORS[persona.status ?? 'created'] ?? '#94a3b8';
  const initial = persona.name.charAt(0).toUpperCase();

  return (
    <div
      className="card card-hover"
      onClick={handleCardClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        position: 'relative',
        cursor: 'pointer',
        minHeight: 152,
      }}
    >
      {/* 操作按钮 */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          display: 'flex',
          gap: 4,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.15s',
          pointerEvents: hovered ? 'auto' : 'none',
        }}
      >
        <button
          className="btn btn-icon"
          onClick={handleEdit}
          title={t('editPersona')}
          style={{ width: 28, height: 28, borderRadius: 6 }}
        >
          <Edit2 size={13} />
        </button>
        <button
          className="btn btn-icon"
          onClick={handleDelete}
          title={t('deletePersona')}
          style={{ width: 28, height: 28, borderRadius: 6, color: '#ef4444' }}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* 头像 + 名称 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            background: 'rgb(var(--accent))',
            color: 'rgb(var(--accent-fg))',
            fontSize: 18,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
        <div style={{ minWidth: 0, paddingRight: 40 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'rgb(var(--text-primary))', marginBottom: 2, lineHeight: 1.3 }}>
            {persona.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))' }}>
              {t(`status_${persona.status ?? 'created'}`)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'rgb(var(--text-tertiary))', marginTop: 'auto' }}>
        <span>{persona.doc_count} 条素材</span>
        <span>{persona.training_rounds} 轮</span>
      </div>
    </div>
  );
}
