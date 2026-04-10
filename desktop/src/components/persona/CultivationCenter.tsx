import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, RefreshCw, Trash2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { PersonaSummary } from '@/lib/types';
import { usePersonaStore } from '@/stores/persona';

// Unicode spinner
function useSpinner(active: boolean) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), 80);
    return () => clearInterval(id);
  }, [active]);
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  return frames[frame];
}

// 服务端 PersonaSchema 实际返回的状态：created / ingesting / refining / training / converged / exported
// 以及 config summary 回退状态：creating / available
// 统一映射到产品态展示
const STATUS_META: Record<string, { color: string; labelKey: string; descKey: string; inProgress: boolean }> = {
  creating:   { color: '#f59e0b', labelKey: 'cultivating', descKey: 'cultivationDesc_building', inProgress: true },
  created:    { color: '#94a3b8', labelKey: 'awaitingCultivation', descKey: 'cultivationDesc_pending', inProgress: true },
  ingesting:  { color: '#f59e0b', labelKey: 'cultivating', descKey: 'cultivationDesc_building', inProgress: true },
  refining:   { color: '#f59e0b', labelKey: 'cultivating', descKey: 'cultivationDesc_building', inProgress: true },
  training:   { color: '#f59e0b', labelKey: 'cultivating', descKey: 'cultivationDesc_building', inProgress: true },
  converged:  { color: '#22c55e', labelKey: 'cultivationComplete', descKey: 'cultivationDesc_ready', inProgress: false },
  exported:   { color: '#22c55e', labelKey: 'cultivationComplete', descKey: 'cultivationDesc_ready', inProgress: false },
  available:  { color: '#22c55e', labelKey: 'cultivationComplete', descKey: 'cultivationDesc_ready', inProgress: false },
  pending:    { color: '#94a3b8', labelKey: 'awaitingCultivation', descKey: 'cultivationDesc_pending', inProgress: true },
  building:   { color: '#f59e0b', labelKey: 'cultivating', descKey: 'cultivationDesc_building', inProgress: true },
  ready:      { color: '#22c55e', labelKey: 'cultivationComplete', descKey: 'cultivationDesc_ready', inProgress: false },
  error:      { color: '#ef4444', labelKey: 'cultivationFailed', descKey: 'cultivationDesc_error', inProgress: false },
};

interface TrainingCardProps {
  persona: PersonaSummary;
  onReload: () => void;
  onDelete: () => void;
}

function TrainingCard({ persona, onReload, onDelete }: TrainingCardProps) {
  const status = persona.status ?? 'created';
  const meta = STATUS_META[status] ?? STATUS_META.created;
  const isBuilding = meta.inProgress;
  const spinner = useSpinner(isBuilding);
  const initial = persona.name.charAt(0).toUpperCase();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ padding: 20, display: 'flex', alignItems: 'flex-start', gap: 16, position: 'relative' }}
    >
      {/* 删除按钮 */}
      <button
        className="btn btn-icon"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title={t('deletePersona')}
        style={{
          position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 6, color: '#ef4444',
          opacity: hovered ? 1 : 0, transition: 'opacity 0.15s', pointerEvents: hovered ? 'auto' : 'none',
        }}
      >
        <Trash2 size={13} />
      </button>

      {/* 头像 */}
      <div style={{
        width: 44, height: 44, borderRadius: 11,
        background: 'rgb(var(--accent))', color: 'rgb(var(--accent-fg))',
        fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {initial}
      </div>

      {/* 内容 */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'rgb(var(--text-primary))' }}>{persona.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isBuilding && (
              <span style={{ fontFamily: 'monospace', fontSize: 14, color: meta.color }}>{spinner}</span>
            )}
            {!isBuilding && status !== 'error' && <CheckCircle2 size={15} style={{ color: meta.color }} />}
            {status === 'error' && <AlertCircle size={15} style={{ color: meta.color }} />}
            <span style={{ fontSize: 12, fontWeight: 500, color: meta.color }}>{t(meta.labelKey)}</span>
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginBottom: 10 }}>
          {t(meta.descKey)}
        </div>

        {/* 进度条（进行中时显示） */}
        {isBuilding && (
          <div style={{ height: 3, background: 'rgb(var(--border))', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: meta.color,
              width: '60%',
              animation: 'cultivation-progress 2s ease-in-out infinite alternate',
            }} />
          </div>
        )}

        {/* 就绪时的提示 */}
        {!isBuilding && status !== 'error' && (
          <div style={{
            fontSize: 11, color: '#22c55e',
            padding: '4px 8px', background: 'rgb(34 197 94 / 0.08)',
            borderRadius: 4, display: 'inline-block',
          }}>
            已就绪，可前往「我的人格」开始对话
          </div>
        )}

        {/* 错误重试 */}
        {status === 'error' && (
          <button className="btn btn-ghost" onClick={onReload} style={{ padding: '3px 8px', fontSize: 11, gap: 4 }}>
            <RefreshCw size={11} /> {t('retry')}
          </button>
        )}
      </div>

      <style>{`
        @keyframes cultivation-progress {
          from { width: 20%; margin-left: 0; }
          to   { width: 40%; margin-left: 55%; }
        }
      `}</style>
    </div>
  );
}

interface CultivationCenterProps {
  onDelete: (p: PersonaSummary) => void;
}

export function CultivationCenter({ onDelete }: CultivationCenterProps) {
  const { personas, load, reload } = usePersonaStore();

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    // 每 5 秒轮询一次，用于进行中状态刷新
    const interval = setInterval(() => {
      if (personas.some((p) => (STATUS_META[p.status ?? 'created']?.inProgress ?? true))) {
        reload();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [personas]);

  const inProgress = personas.filter((p) => STATUS_META[p.status ?? 'created']?.inProgress ?? true);
  const done = personas.filter((p) => !(STATUS_META[p.status ?? 'created']?.inProgress ?? true));

  if (personas.length === 0) {
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
        <div style={{ fontSize: 36, opacity: 0.3 }}>🌱</div>
        <div style={{ fontSize: 14, color: 'rgb(var(--text-secondary))' }}>还没有人格在培养中</div>
        <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>在「我的人格」中创建人格后，可在此查看培养进度</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, overflow: 'auto', height: '100%' }}>
      {inProgress.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--text-tertiary))', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            培养中 ({inProgress.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {inProgress.map((p) => (
              <TrainingCard key={p.slug} persona={p} onReload={reload} onDelete={() => onDelete(p)} />
            ))}
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--text-tertiary))', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            已完成 ({done.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {done.map((p) => (
              <TrainingCard key={p.slug} persona={p} onReload={reload} onDelete={() => onDelete(p)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
