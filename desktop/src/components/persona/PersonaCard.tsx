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
}

export function PersonaCard({ persona, onEdit, onDelete }: Props) {
  const { setPersona } = useChatStore();
  const { setView } = useAppStore();
  const [hovered, setHovered] = useState(false);
  const chatReady = isChatReady(persona.status, persona.is_ready);

  function handleCardClick() {
    if (!chatReady) return;
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
        cursor: chatReady ? 'pointer' : 'default',
        minHeight: 152,
        opacity: chatReady ? 1 : 0.9,
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
              {formatPersonaStatus(persona.status)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'rgb(var(--text-tertiary))', marginTop: 'auto' }}>
        <span>{persona.doc_count} 条素材</span>
        <span>{persona.training_rounds} 轮</span>
      </div>
      {chatReady ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 11.5, color: '#16a34a', fontWeight: 600 }}>
            {persona.source_type_count && persona.source_count
              ? `已基于 ${persona.source_type_count} 类来源、${persona.doc_count} 条素材完成培养`
              : '已完成培养，可开始对话'}
          </div>
          <button className="btn btn-primary" onClick={handleStartChat} style={{ minHeight: 30, padding: '0 12px', fontSize: 12 }}>
            {t('startChat')}
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'rgb(var(--text-secondary))' }}>
          培养完成后可聊天
        </div>
      )}
    </div>
  );
}
