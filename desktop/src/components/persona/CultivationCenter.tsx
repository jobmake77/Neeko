import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, RefreshCw, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { PersonaSummary, CultivationDetail } from '@/lib/types';
import { useCultivationStore } from '@/stores/cultivation';

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

function StageIndicator({ stages }: { stages: CultivationDetail['progress']['stages'] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', marginTop: 10 }}>
      {stages.map((s) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: s.completed ? '#22c55e' : s.active ? '#f59e0b' : '#cbd5e1',
          }} />
          <span style={{
            fontSize: 11,
            color: s.active ? 'rgb(var(--text-primary))' : 'rgb(var(--text-tertiary))',
            fontWeight: s.active ? 500 : 400,
          }}>
            {t(s.label)}
          </span>
        </div>
      ))}
    </div>
  );
}

interface TrainingCardProps {
  persona: PersonaSummary;
  detail?: CultivationDetail;
  onReload: () => void;
  onDelete: () => void;
  onExpand: () => void;
  expanded: boolean;
}

function TrainingCard({ persona, detail, onReload, onDelete, onExpand, expanded }: TrainingCardProps) {
  const status = persona.status ?? 'created';
  const meta = (persona.current_stage === 'error' ? STATUS_META.error : STATUS_META[status]) ?? STATUS_META.created;
  const isBuilding = meta.inProgress;
  const spinner = useSpinner(isBuilding);
  const initial = persona.name.charAt(0).toUpperCase();
  const [hovered, setHovered] = useState(false);
  const progress = persona.progress_percent ?? 0;

  return (
    <div
      className="card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}
    >
      {/* 顶部行：头像 + 名称 + 状态 + 展开/删除按钮 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        {/* 头像 */}
        <div style={{
          width: 44, height: 44, borderRadius: 11,
          background: 'rgb(var(--accent))', color: 'rgb(var(--accent-fg))',
          fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {initial}
        </div>

        {/* 内容 */}
        <div style={{ flex: 1, minWidth: 0, paddingRight: 64 }}>
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

          {/* 真实进度条 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <div style={{ flex: 1, height: 4, background: 'rgb(var(--border))', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                background: meta.color,
                width: `${progress}%`,
                transition: 'width 0.5s ease',
              }} />
            </div>
            <span style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', minWidth: 32, textAlign: 'right' }}>
              {progress}%
            </span>
          </div>
        </div>
      </div>

      {/* 操作按钮区（右上角） */}
      <div style={{
        position: 'absolute', top: 12, right: 12, display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <button
          className="btn btn-icon"
          onClick={(e) => { e.stopPropagation(); onExpand(); }}
          title={expanded ? t('collapse') : t('expand')}
          style={{ width: 28, height: 28, borderRadius: 6, color: 'rgb(var(--text-secondary))' }}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          className="btn btn-icon"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title={t('deletePersona')}
          style={{
            width: 28, height: 28, borderRadius: 6, color: '#ef4444',
            opacity: hovered ? 1 : 0, transition: 'opacity 0.15s', pointerEvents: hovered ? 'auto' : 'none',
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* 展开详情 */}
      {expanded && detail && (
        <div style={{
          marginTop: 8, paddingTop: 12,
          borderTop: '1px solid rgb(var(--border-light))',
        }}>
          {/* 阶段指示器 */}
          <StageIndicator stages={detail.progress.stages} />

          {/* 轮次 */}
          <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))', marginTop: 10 }}>
            {t('currentRound')}: <b>{detail.progress.current_round} / {detail.progress.total_rounds}</b> {t('rounds')}
          </div>

          {/* 技能 */}
          {(detail.skills.origin_skills.length > 0 || detail.skills.distilled_skills.length > 0) && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--text-primary))', marginBottom: 6 }}>
                {t('skillsTitle')}
              </div>
              {detail.skills.origin_skills.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginBottom: 4 }}>{t('originSkills')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {detail.skills.origin_skills.map((s) => (
                      <span key={s.id} style={{
                        fontSize: 11, color: 'rgb(var(--text-secondary))',
                        padding: '3px 8px', background: 'rgb(var(--border))', borderRadius: 4,
                      }}>{s.name}</span>
                    ))}
                  </div>
                </div>
              )}
              {detail.skills.distilled_skills.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginBottom: 4 }}>{t('distilledSkills')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {detail.skills.distilled_skills.map((s) => (
                      <span key={s.id} style={{
                        fontSize: 11, color: 'rgb(var(--accent))',
                        padding: '3px 8px', background: 'rgb(var(--accent) / 0.08)', borderRadius: 4,
                      }}>{s.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 素材资产 */}
          {(detail.assets.evidence_imports.length > 0 || detail.assets.training_preps.length > 0) && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--text-primary))', marginBottom: 6 }}>
                {t('cultivationAssets')}
              </div>
              {detail.assets.evidence_imports.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginBottom: 4 }}>{t('evidenceImports')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {detail.assets.evidence_imports.map((imp) => (
                      <div key={imp.id} style={{ fontSize: 11, color: 'rgb(var(--text-secondary))' }}>
                        {imp.source_path.split(/[\\/]/).pop()} • <span style={{ color: 'rgb(var(--text-tertiary))' }}>{imp.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detail.assets.training_preps.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginBottom: 4 }}>{t('trainingPreps')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {detail.assets.training_preps.map((prep) => (
                      <div key={prep.id} style={{ fontSize: 11, color: 'rgb(var(--text-secondary))' }}>
                        {t('trainingPrep')} {prep.id.slice(0, 8)}… {prep.handoff_id ? `(${t('fromHandoff')})` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 错误重试 */}
          {status === 'error' && (
            <button className="btn btn-ghost" onClick={onReload} style={{ padding: '4px 10px', fontSize: 12, gap: 4, marginTop: 10 }}>
              <RefreshCw size={12} /> {t('retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface CultivationCenterProps {
  onDelete: (p: PersonaSummary) => void;
}

export function CultivationCenter({ onDelete }: CultivationCenterProps) {
  const { cultivating, load, reload, details, loadDetail } = useCultivationStore();
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (cultivating.some((p) => (p.progress_percent ?? 0) < 100)) {
        reload();
        if (expandedSlug) {
          loadDetail(expandedSlug);
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [cultivating, expandedSlug]);

  useEffect(() => {
    if (expandedSlug && !details[expandedSlug]) {
      loadDetail(expandedSlug);
    }
  }, [expandedSlug]);

  if (cultivating.length === 0) {
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
        <div style={{ fontSize: 36, opacity: 0.3 }}>🌱</div>
        <div style={{ fontSize: 14, color: 'rgb(var(--text-secondary))' }}>{t('noCultivating')}</div>
        <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>{t('noCultivatingHint')}</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, overflow: 'auto', height: '100%' }}>
      <section>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--text-tertiary))', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
          {t('cultivatingCount', { count: cultivating.length })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cultivating.map((p) => (
            <TrainingCard
              key={p.slug}
              persona={p}
              detail={details[p.slug]}
              onReload={reload}
              onDelete={() => onDelete(p)}
              expanded={expandedSlug === p.slug}
              onExpand={() => setExpandedSlug((s) => s === p.slug ? null : p.slug)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
