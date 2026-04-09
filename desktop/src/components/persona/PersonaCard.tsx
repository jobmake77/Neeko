import React from 'react';
import { t } from '@/lib/i18n';
import type { PersonaSummary } from '@/lib/types';
import { useChatStore } from '@/stores/chat';
import { useAppStore } from '@/stores/app';
import { Edit2, Trash2 } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  ready: '#22c55e',
  building: '#f59e0b',
  pending: '#94a3b8',
  error: '#ef4444',
};

interface Props {
  persona: PersonaSummary;
  onEdit: () => void;
  onDelete: () => void;
}

export function PersonaCard({ persona, onEdit, onDelete }: Props) {
  const { setPersona } = useChatStore();
  const { setView } = useAppStore();

  function handleClick(e: React.MouseEvent) {
    // 点击编辑/删除按钮不触发切换
    if ((e.target as HTMLElement).closest('.card-action-btn')) return;
    setPersona(persona.slug);
    setView('chat');
  }

  const statusColor = STATUS_COLORS[persona.status ?? 'pending'];
  const initial = persona.name.charAt(0).toUpperCase();

  return (
    <div
      className="card card-hover"
      onClick={handleClick}
      style={{
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        position: 'relative',
        cursor: 'pointer',
      }}
    >
      {/* 操作按钮（悬停显示） */}
      <div
        className="card-actions"
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          display: 'flex',
          gap: 4,
          opacity: 0,
          transition: 'opacity 0.15s',
        }}
      >
        <button
          className="btn btn-icon card-action-btn"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          title={t('editPersona')}
          style={{ width: 28, height: 28, borderRadius: 6 }}
        >
          <Edit2 size={13} />
        </button>
        <button
          className="btn btn-icon card-action-btn"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
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
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'rgb(var(--accent))',
            color: 'rgb(var(--accent-fg))',
            fontSize: 17,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'rgb(var(--text-primary))', marginBottom: 2 }}>
            {persona.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))' }}>
              {t(`status_${persona.status ?? 'pending'}`)}
            </span>
          </div>
        </div>
      </div>

      {/* 描述 */}
      {persona.description && (
        <div
          style={{
            fontSize: 13,
            color: 'rgb(var(--text-secondary))',
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {persona.description}
        </div>
      )}

      <style>{`
        .card:hover .card-actions { opacity: 1 !important; }
      `}</style>
    </div>
  );
}
