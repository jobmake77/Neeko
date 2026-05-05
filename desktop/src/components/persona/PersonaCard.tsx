import React, { useState } from 'react';
import { t } from '@/lib/i18n';
import type { PersonaSummary } from '@/lib/types';
import { useChatStore } from '@/stores/chat';
import { useAppStore } from '@/stores/app';
import { Edit2, MessageCircle, Network, Trash2 } from 'lucide-react';

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

function isChatReady(status?: string, isReady?: boolean): boolean {
  if (isReady) return true;
  return ['ready', 'available', 'converged', 'exported'].includes(String(status ?? '').toLowerCase());
}

function formatPersonaStatus(status?: string): string {
  const normalized = String(status ?? 'created').toLowerCase();
  if (normalized === 'available' || normalized === 'ready' || normalized === 'converged' || normalized === 'exported') {
    return '可对话';
  }
  if (normalized === 'creating' || normalized === 'created' || normalized === 'pending') return '待培养';
  if (normalized === 'ingesting' || normalized === 'refining' || normalized === 'training' || normalized === 'building') {
    return '培养中';
  }
  if (normalized === 'error') return '异常';
  return t(`status_${normalized}`);
}

interface Props {
  persona: PersonaSummary;
  onEdit: () => void;
  onDelete: () => void;
  selected?: boolean;
  onSelect?: () => void;
}

export function PersonaCard({ persona, onEdit, onDelete, selected = false, onSelect }: Props) {
  const { setPersona } = useChatStore();
  const { setView } = useAppStore();
  const [hovered, setHovered] = useState(false);
  const chatReady = isChatReady(persona.status, persona.is_ready);

  function handleCardClick() {
    onSelect?.();
  }

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation();
    onEdit();
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    onDelete();
  }

  function handleStartChat(e: React.MouseEvent) {
    e.stopPropagation();
    if (!chatReady) return;
    setPersona(persona.slug);
    setView('chat');
  }

  const statusColor = STATUS_COLORS[persona.status ?? 'created'] ?? '#94a3b8';
  const initial = persona.name.charAt(0).toUpperCase();

  return (
    <div
      className="surface-panel"
      onClick={handleCardClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: 12,
        display: 'grid',
        gridTemplateColumns: '54px minmax(0, 1fr)',
        gap: 12,
        position: 'relative',
        cursor: 'pointer',
        minHeight: 112,
        opacity: chatReady ? 1 : 0.9,
        borderColor: selected ? 'rgb(var(--text-primary) / 0.32)' : 'rgb(var(--border))',
        background: selected ? 'rgb(var(--bg-hover))' : 'rgb(var(--bg-card))',
        boxShadow: selected ? 'inset 3px 0 0 rgb(var(--accent))' : 'none',
      }}
    >
      {/* 操作按钮 */}
      <div
          style={{
            position: 'absolute',
          top: 10,
          right: 10,
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

      <div className="persona-avatar" style={{ width: 54, height: 54, fontSize: 20, borderWidth: 3, alignSelf: 'start' }}>
        <span>{initial}</span>
        <i className="avatar-status" style={{ background: statusColor }} />
      </div>
      <div style={{ minWidth: 0, paddingRight: hovered ? 60 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, marginBottom: 5 }}>
          <div style={{ fontSize: 15, fontWeight: 750, color: 'rgb(var(--text-primary))', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {persona.name}
          </div>
          <span className="status-pill" style={{ minHeight: 22, padding: '0 8px', flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: statusColor }} />
            {formatPersonaStatus(persona.status)}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7, marginBottom: 9 }}>
          <MiniStat label="素材" value={persona.doc_count.toLocaleString()} />
          <MiniStat label="来源" value={persona.source_count ?? 0} />
          <MiniStat label="关系" value={persona.memory_node_count.toLocaleString()} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgb(var(--text-tertiary))', fontSize: 11.5 }}>
          <Network size={13} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {persona.source_type_count ?? 0} 类来源 · 更新于 {new Date(persona.updated_at).toLocaleDateString()}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          {chatReady ? (
            <button className="btn btn-secondary" onClick={handleStartChat} style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}>
              <MessageCircle size={13} />
              {t('startChat')}
            </button>
          ) : (
            <span className="muted-copy">后台更新完成后可对话</span>
          )}
          <button className="btn btn-ghost" onClick={handleEdit} style={{ minHeight: 30, padding: '0 8px', fontSize: 12 }}>
            {t('editPersona')}
          </button>
          </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: 'rgb(var(--text-tertiary))', lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'rgb(var(--text-primary))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
    </div>
  );
}
