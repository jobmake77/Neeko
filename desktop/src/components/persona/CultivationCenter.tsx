import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, RefreshCw, Trash2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { CultivationDetail, PersonaSummary } from '@/lib/types';
import { useCultivationStore } from '@/stores/cultivation';
import * as api from '@/lib/api';

function statusMeta(status: string) {
  if (status === 'error') return { color: '#ef4444', label: t('cultivationFailed') };
  if (status === 'converged' || status === 'available' || status === 'ready') return { color: '#22c55e', label: t('cultivationComplete') };
  return { color: '#f59e0b', label: t('cultivating') };
}

function StageIndicator({ stages }: { stages: CultivationDetail['progress']['stages'] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', marginTop: 10 }}>
      {stages.map((s) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.completed ? '#22c55e' : s.active ? '#f59e0b' : '#cbd5e1' }} />
          <span style={{ fontSize: 11, color: s.active ? 'rgb(var(--text-primary))' : 'rgb(var(--text-tertiary))' }}>{t(s.label)}</span>
        </div>
      ))}
    </div>
  );
}

function TrainingCard({
  persona,
  detail,
  expanded,
  onExpand,
  onDelete,
  onReload,
  onCheckUpdates,
  onContinue,
  pendingOperation,
}: {
  persona: PersonaSummary;
  detail?: CultivationDetail;
  expanded: boolean;
  onExpand: () => void;
  onDelete: () => void;
  onReload: () => void;
  onCheckUpdates: () => Promise<void>;
  onContinue: () => Promise<void>;
  pendingOperation?: 'deep_fetch' | 'incremental_sync';
}) {
  const meta = statusMeta(persona.current_stage ?? persona.status);
  const progress = persona.progress_percent ?? 0;
  const operationLabel = pendingOperation === 'deep_fetch'
    ? '深抓取中'
    : pendingOperation === 'incremental_sync'
      ? '增量拉取中'
      : detail?.source_summary?.current_operation === 'deep_fetch'
        ? '深抓取中'
        : detail?.source_summary?.current_operation === 'incremental_sync'
          ? '增量拉取中'
          : detail?.source_summary?.current_operation === 'discovery'
            ? '发现来源中'
            : null;

  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: 'rgb(var(--accent))', color: 'rgb(var(--accent-fg))', fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {persona.name.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 84 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{persona.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: meta.color, fontSize: 12, fontWeight: 600 }}>
              {meta.color === '#22c55e' ? <CheckCircle2 size={14} /> : meta.color === '#ef4444' ? <AlertCircle size={14} /> : <RefreshCw size={14} />}
              {meta.label}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 4, background: 'rgb(var(--border))', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: meta.color, transition: 'width 0.25s ease' }} />
            </div>
            <span style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', minWidth: 34, textAlign: 'right' }}>{progress}%</span>
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 4 }}>
        <button className="btn btn-icon" onClick={onExpand}>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
        <button className="btn btn-icon" onClick={onDelete} style={{ color: '#ef4444' }}><Trash2 size={13} /></button>
      </div>

      {expanded && detail ? (
        <div style={{ borderTop: '1px solid rgb(var(--border-light))', paddingTop: 12 }}>
          <StageIndicator stages={detail.progress.stages} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 12, fontSize: 12, color: 'rgb(var(--text-secondary))' }}>
            <div>当前轮次: <b>{detail.progress.current_round} / {detail.progress.total_rounds}</b></div>
            <div>技能数: <b>{detail.skills.origin_skills.length + detail.skills.distilled_skills.length}</b></div>
            <div>素材来源: <b>{detail.source_summary?.enabled_sources ?? 0} / {detail.source_summary?.total_sources ?? 0}</b></div>
            <div>最近检查: <b>{detail.source_summary?.last_update_check_at ? new Date(detail.source_summary.last_update_check_at).toLocaleString() : '未检查'}</b></div>
            <div>素材文档: <b>{detail.source_summary?.document_count ?? 0}</b></div>
            <div>近 7 天增量: <b>{detail.source_summary?.recent_delta_count ?? 0}</b></div>
          </div>

          {detail.source_summary?.source_breakdown && Object.keys(detail.source_summary.source_breakdown).length > 0 ? (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(detail.source_summary.source_breakdown).map(([key, value]) => (
                <span key={key} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: 'rgb(var(--bg-hover))', border: '1px solid rgb(var(--border))' }}>
                  {key} {value}
                </span>
              ))}
            </div>
          ) : null}

          {operationLabel ? (
            <div style={{ marginTop: 10, fontSize: 12, color: 'rgb(var(--accent))' }}>
              当前任务：<b>{operationLabel}</b>{detail?.source_summary?.current_source_label ? ` · ${detail.source_summary.current_source_label}` : ''}
            </div>
          ) : null}

          {(detail.skills.origin_skills.length > 0 || detail.skills.distilled_skills.length > 0) && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t('skillsTitle')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {detail.skills.origin_skills.map((s) => <span key={s.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: 'rgb(var(--bg-hover))', border: '1px solid rgb(var(--border))' }}>{s.name}</span>)}
                {detail.skills.distilled_skills.map((s) => <span key={s.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: 'rgb(var(--accent) / 0.08)', color: 'rgb(var(--accent))' }}>{s.name}</span>)}
              </div>
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 12, color: 'rgb(var(--text-secondary))' }}>
            素材摘要：最近同步 <b>{detail.assets.evidence_imports.length}</b> 批素材，最近整理 <b>{detail.assets.training_preps.length}</b> 批培养上下文。
            {detail.source_summary?.latest_update_result ? ` ${detail.source_summary.latest_update_result}` : ''}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => void onCheckUpdates()} style={{ fontSize: 12 }} disabled={Boolean(pendingOperation)}>
              {pendingOperation === 'incremental_sync' ? '增量拉取中…' : '检查更新'}
            </button>
            <button className="btn btn-primary" onClick={() => void onContinue()} style={{ fontSize: 12 }} disabled={Boolean(pendingOperation)}>
              {pendingOperation === 'deep_fetch' ? '深抓取中…' : '继续培养'}
            </button>
            {(persona.current_stage ?? persona.status) === 'error' ? <button className="btn btn-ghost" onClick={onReload} style={{ fontSize: 12 }}>{t('retry')}</button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CultivationCenter({ onDelete }: { onDelete: (p: PersonaSummary) => void }) {
  const { cultivating, load, reload, details, loadDetail } = useCultivationStore();
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [pendingOps, setPendingOps] = useState<Record<string, 'deep_fetch' | 'incremental_sync' | undefined>>({});

  const hasActiveSourceOp = cultivating.some((item) => {
    const detail = details[item.slug];
    return Boolean(pendingOps[item.slug]) || Boolean(detail?.source_summary?.current_operation && detail.source_summary.current_operation !== 'idle');
  });

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!expandedSlug || details[expandedSlug]) return;
    void loadDetail(expandedSlug);
  }, [details, expandedSlug, loadDetail]);

  useEffect(() => {
    const poll = setInterval(() => {
      if (cultivating.some((item) => (item.progress_percent ?? 0) < 100) || hasActiveSourceOp) {
        void reload();
        if (expandedSlug) void loadDetail(expandedSlug);
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [cultivating, expandedSlug, hasActiveSourceOp, loadDetail, reload]);

  useEffect(() => {
    const autoSync = setInterval(() => {
      if (cultivating.length === 0) return;
      cultivating.forEach((persona) => {
        void api.checkPersonaUpdates(persona.slug).catch(() => undefined);
      });
    }, 10 * 60 * 1000);
    return () => clearInterval(autoSync);
  }, [cultivating]);

  async function handleCheckUpdates(slug: string) {
    setPendingOps((prev) => ({ ...prev, [slug]: 'incremental_sync' }));
    try {
      await api.checkPersonaUpdates(slug);
      for (let i = 0; i < 24; i += 1) {
        await reload();
        const detail = await api.getCultivationDetail(slug).catch(() => null);
        if (detail) {
          await loadDetail(slug);
          if (!detail.source_summary?.current_operation || detail.source_summary.current_operation === 'idle') break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
      }
    } finally {
      setPendingOps((prev) => ({ ...prev, [slug]: undefined }));
    }
  }

  async function handleContinue(slug: string) {
    setPendingOps((prev) => ({ ...prev, [slug]: 'deep_fetch' }));
    try {
      await api.continueCultivation(slug);
      for (let i = 0; i < 48; i += 1) {
        await reload();
        const detail = await api.getCultivationDetail(slug).catch(() => null);
        if (detail) {
          await loadDetail(slug);
          if (!detail.source_summary?.current_operation || detail.source_summary.current_operation === 'idle') break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
      }
    } finally {
      setPendingOps((prev) => ({ ...prev, [slug]: undefined }));
    }
  }

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
      <div style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--text-tertiary))', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
        {t('cultivatingCount', { count: cultivating.length })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {cultivating.map((persona) => (
          <TrainingCard
            key={persona.slug}
            persona={persona}
            detail={details[persona.slug]}
            expanded={expandedSlug === persona.slug}
            pendingOperation={pendingOps[persona.slug]}
            onExpand={() => setExpandedSlug((current) => current === persona.slug ? null : persona.slug)}
            onDelete={() => onDelete(persona)}
            onReload={() => void reload()}
            onCheckUpdates={() => handleCheckUpdates(persona.slug)}
            onContinue={() => handleContinue(persona.slug)}
          />
        ))}
      </div>
    </div>
  );
}
