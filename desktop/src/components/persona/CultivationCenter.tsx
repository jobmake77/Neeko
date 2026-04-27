import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Edit2, RefreshCw, Trash2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { CultivationDetail, PersonaSummary } from '@/lib/types';
import { useCultivationStore } from '@/stores/cultivation';
import { useChatStore } from '@/stores/chat';
import { useAppStore } from '@/stores/app';
import * as api from '@/lib/api';

function statusMeta(status: string) {
  if (status === 'error') return { color: '#ef4444', label: t('cultivationFailed') };
  if (status === 'soft_closed') return { color: '#f59e0b', label: '已按当前素材收口' };
  if (status === 'converged' || status === 'available' || status === 'ready') return { color: '#22c55e', label: t('cultivationComplete') };
  return { color: '#0ea5e9', label: t('cultivating') };
}

function formatPhaseLabel(phase?: string) {
  if (phase === 'queued') return '排队中';
  if (phase === 'deep_fetching') return '深抓取中';
  if (phase === 'incremental_syncing') return '增量拉取中';
  if (phase === 'normalizing') return '整理素材中';
  if (phase === 'building_evidence') return '构建训练上下文中';
  if (phase === 'building_network') return '构建人物关系与背景中';
  if (phase === 'training') return '人格收敛中';
  if (phase === 'continuing_collection') return '继续培养中';
  if (phase === 'soft_closed') return '已按当前素材收口';
  if (phase === 'ready') return '可聊天';
  if (phase === 'error') return '待处理';
  return '培养中';
}

function isFinishedStatus(status?: string) {
  return ['converged', 'available', 'ready', 'exported'].includes(String(status ?? '').toLowerCase());
}

function formatDate(value?: string) {
  if (!value) return '未记录';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatWindowDate(value?: string) {
  if (!value) return '未记录';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

function formatRelativeTime(value?: string) {
  if (!value) return '未记录';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  const diffMs = Date.now() - time;
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}

function formatSourceType(type: string) {
  if (type === 'social') return '公开账号';
  if (type === 'chat_file') return '聊天资料';
  if (type === 'video_file') return '视频资料';
  if (type === 'audio_file') return '音频资料';
  if (type === 'article') return '网页文章';
  return type;
}

function formatRoundStatus(status: string) {
  if (status === 'completed' || status === 'converged' || status === 'max_rounds_reached') return '本轮已完成';
  if (status === 'interrupted' || status === 'paused') return '本轮已产出，等待继续';
  if (status === 'running') return '本轮推进中';
  if (status === 'failed') return '本轮待重试';
  return '等待进入本轮';
}

function formatWindowStatus(status?: string) {
  if (status === 'running') return '正在推进';
  if (status === 'completed') return '窗口完成';
  if (status === 'empty') return '窗口无新增';
  if (status === 'timeout') return '超时重试';
  if (status === 'failed') return '失败待处理';
  if (status === 'skipped') return '已跳过';
  return '等待推进';
}

function formatCollectionStopReasonLabel(reason?: string) {
  if (!reason) return null;
  if (reason === 'soft_closed_material_exhausted') return '公开素材已触边，连续 2 轮未获得新增素材';
  if (reason === 'search_horizon_reached') return '公开素材已触边，当前暂无更多可补素材';
  if (reason === 'waiting_retrain_delta') return '测评未通过，正在等待累计到下一轮训练阈值';
  if (reason === 'retrain_ready') return '已达到下一轮训练条件';
  if (reason === 'evaluation_passed') return '测评已通过';
  if (reason === 'unable_to_progress') return '多轮重试后仍无法取得新增素材';
  return reason;
}

function formatWindowSentence(detail?: CultivationDetail) {
  const currentWindow = detail?.current_window;
  if (!currentWindow?.window_start || !currentWindow?.window_end) return null;
  const sourceLabel = currentWindow.source_label || detail?.source_summary?.current_source_label || '当前来源';
  return `${sourceLabel} · ${currentWindow.window_start.slice(0, 10)} ~ ${currentWindow.window_end.slice(0, 10)}`;
}

function getLatestSourceWindow(detail?: CultivationDetail) {
  if (!detail?.source_items?.length) return undefined;
  return detail.source_items
    .filter((item) => item.active_window)
    .map((item) => ({
      source_label: item.label,
      ...item.active_window,
    }))
    .sort((a, b) => String(b.updated_at ?? b.finished_at ?? b.started_at ?? '').localeCompare(String(a.updated_at ?? a.finished_at ?? a.started_at ?? '')))[0];
}

function StageIndicator({ stages }: { stages: CultivationDetail['progress']['stages'] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', marginTop: 10 }}>
      {stages.map((s) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.completed ? '#22c55e' : s.active ? '#0ea5e9' : '#cbd5e1' }} />
          <span style={{ fontSize: 11, color: s.active ? 'rgb(var(--text-primary))' : 'rgb(var(--text-tertiary))' }}>{t(s.label)}</span>
        </div>
      ))}
    </div>
  );
}

function TideBar({ progress, finished, tickerText }: { progress: number; finished: boolean; tickerText: string }) {
  const markerOffset = finished ? progress : Math.max(progress, 6);
  const asciiWave = '▒░▒░▒ :: signal-flow :: persona-growth :: tide-wave ::'.repeat(8);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 44,
          background: finished
            ? 'linear-gradient(180deg, rgba(214,255,230,0.95), rgba(187,247,208,0.95))'
            : 'linear-gradient(180deg, rgba(6,10,20,0.98), rgba(11,18,32,0.98))',
          borderRadius: 14,
          overflow: 'hidden',
          position: 'relative',
          border: finished ? '1px solid rgba(34,197,94,0.16)' : '1px solid rgba(96,165,250,0.15)',
          boxShadow: finished ? 'inset 0 1px 2px rgb(255 255 255 / 0.55)' : 'inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {finished ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, rgba(34,197,94,0.76), rgba(74,222,128,0.92), rgba(167,243,208,0.76))',
            }}
          />
        ) : (
          <>
            <div
              className="ascii-breath cultivation-tide-primary"
              style={{
                position: 'absolute',
                inset: '-22% -6%',
                background: 'radial-gradient(ellipse at 18% 54%, rgba(34,211,238,0.22), rgba(34,211,238,0) 44%), radial-gradient(ellipse at 44% 48%, rgba(59,130,246,0.28), rgba(59,130,246,0) 50%), radial-gradient(ellipse at 72% 56%, rgba(45,212,191,0.20), rgba(45,212,191,0) 44%)',
              }}
            />
            <div
              className="ascii-breath cultivation-tide-secondary"
              style={{
                position: 'absolute',
                inset: '-14% -10%',
                background: 'radial-gradient(ellipse at 16% 70%, rgba(56,189,248,0.18), rgba(56,189,248,0) 40%), radial-gradient(ellipse at 58% 40%, rgba(99,102,241,0.20), rgba(99,102,241,0) 42%), radial-gradient(ellipse at 86% 68%, rgba(125,211,252,0.16), rgba(125,211,252,0) 36%)',
              }}
            />
            <div
              className="ascii-pulse-sweep"
              style={{
                position: 'absolute',
                inset: '-10% 0',
                width: '22%',
                background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(191,219,254,0.18), rgba(255,255,255,0))',
                mixBlendMode: 'screen',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 9,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'rgba(186,230,253,0.42)',
                whiteSpace: 'nowrap',
              }}
            >
              <div className="ascii-wave-travel" style={{ display: 'inline-flex', paddingLeft: 18 }}>
                <span>{asciiWave}</span>
                <span style={{ paddingLeft: 22 }}>{asciiWave}</span>
              </div>
            </div>
            <div
              style={{
                position: 'absolute',
                inset: 'auto 0 0 0',
                height: 15,
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                borderTop: '1px solid rgba(148,163,184,0.12)',
                background: 'linear-gradient(180deg, rgba(2,6,23,0), rgba(2,6,23,0.26))',
              }}
            >
              <div
                className="hacker-ticker"
                style={{
                  display: 'inline-flex',
                  whiteSpace: 'nowrap',
                  paddingLeft: 12,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: 8,
                  letterSpacing: '0.14em',
                  color: 'rgba(191,219,254,0.78)',
                  textTransform: 'uppercase',
                }}
              >
                <span>{tickerText.repeat(4)}</span>
                <span style={{ paddingLeft: 24 }}>{tickerText.repeat(4)}</span>
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: 2,
                  bottom: 2,
                  left: `calc(${markerOffset}% - 20px)`,
                  width: 40,
                  borderRadius: 999,
                  background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.88), rgba(255,255,255,0))',
                  boxShadow: '0 0 18px rgba(96,165,250,0.24)',
                  opacity: 0.72,
                  transition: 'left 0.35s ease',
                }}
              />
            </div>
            <div
              style={{
                position: 'absolute',
                top: 6,
                bottom: 18,
                left: `calc(${markerOffset}% - 1px)`,
                width: 2,
                borderRadius: 999,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(125,211,252,0.22))',
                boxShadow: '0 0 14px rgba(125,211,252,0.32)',
                transition: 'left 0.35s ease',
              }}
            />
          </>
        )}
      </div>
      <span style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', minWidth: 34, textAlign: 'right' }}>{progress}%</span>
    </div>
  );
}

function InfoStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '12px 14px', minHeight: 72 }}>
      <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'rgb(var(--text-primary))' }}>{value}</div>
    </div>
  );
}

function SourceBreakdown({ detail }: { detail: CultivationDetail }) {
  const grouped = useMemo(() => {
    const map = new Map<string, { count: number; raw: number; clean: number; lastSyncedAt?: string }>();
    for (const item of detail.source_items ?? []) {
      const key = formatSourceType(item.type);
      const current = map.get(key) ?? { count: 0, raw: 0, clean: 0 };
      current.count += 1;
      current.raw += item.raw_count;
      current.clean += item.clean_count;
      current.lastSyncedAt = [current.lastSyncedAt, item.last_synced_at].filter(Boolean).sort().at(-1);
      map.set(key, current);
    }
    return [...map.entries()];
  }, [detail]);

  if (grouped.length === 0) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
      {grouped.map(([key, item]) => (
        <div key={key} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{key}</div>
          <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>{item.count} 个来源</div>
          <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>原始素材 {item.raw} 条</div>
          <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>纳入训练 {item.clean} 条</div>
          <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>最近同步 {formatDate(item.lastSyncedAt)}</div>
        </div>
      ))}
    </div>
  );
}

function NetworkSummaryBlock({ detail }: { detail: CultivationDetail }) {
  const network = detail.network_summary ?? detail.source_summary?.network_summary;
  if (!network) return null;
  const hasSignals =
    network.entity_count > 0
    || network.relation_count > 0
    || network.context_pack_count > 0
    || network.arc_count > 0
    || network.pending_candidate_count > 0
    || network.dominant_domains.length > 0;
  if (!hasSignals) return null;

  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>人物关系与背景</div>
          <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))', marginTop: 4 }}>
            当前人格的关系网、背景上下文和身份轨迹构建摘要。
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))' }}>
          实体 {network.entity_count} · 关系 {network.relation_count}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>实体数: <b>{network.entity_count}</b></div>
        <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>关系数: <b>{network.relation_count}</b></div>
        <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>背景包: <b>{network.context_pack_count}</b></div>
        <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>身份轨迹: <b>{network.arc_count}</b></div>
        <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>待审核候选: <b>{network.pending_candidate_count}</b></div>
      </div>
      {network.dominant_domains.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {network.dominant_domains.map((domain) => (
            <span
              key={domain}
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 999,
                background: 'rgb(var(--bg-hover))',
                border: '1px solid rgb(var(--border))',
                color: 'rgb(var(--text-secondary))',
              }}
            >
              {domain}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SourceItems({ detail }: { detail: CultivationDetail }) {
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);

  if (!detail.source_items || detail.source_items.length === 0) {
    return <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>暂时还没有来源明细。</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {detail.source_items.map((item) => {
        const expanded = expandedSourceId === item.source_id;
        const hasError = item.status === 'error';
        return (
          <div key={item.source_id} className="card" style={{ padding: 12, borderColor: hasError ? 'rgb(239 68 68 / 0.25)' : undefined }}>
            <button
              onClick={() => setExpandedSourceId((current) => current === item.source_id ? null : item.source_id)}
              style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <div style={{ minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgb(var(--text-primary))' }}>{item.label}</div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))', marginTop: 4 }}>
                  {formatSourceType(item.type)} · {item.enabled ? '启用中' : '已停用'} · 原始 {item.raw_count} / 纳入 {item.clean_count}
                </div>
              </div>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {expanded ? (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgb(var(--border-light))', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, fontSize: 12, color: 'rgb(var(--text-secondary))' }}>
                <div>抓取规模: <b>{item.raw_count}</b></div>
                <div>纳入训练: <b>{item.clean_count}</b></div>
                <div>校验通过: <b>{item.validation_summary?.accepted_count ?? item.clean_count}</b></div>
                <div>校验拒绝: <b>{item.validation_summary?.rejected_count ?? 0}</b></div>
                <div>校验隔离: <b>{item.validation_summary?.quarantined_count ?? 0}</b></div>
                <div>真实抓取窗口: <b>{item.coverage_start || item.coverage_end ? `${formatWindowDate(item.coverage_start)} ~ ${formatWindowDate(item.coverage_end)}` : '未记录'}</b></div>
                <div>最近同步: <b>{formatDate(item.last_synced_at)}</b></div>
                <div>最近结果: <b>{item.last_result || '等待下一步推进'}</b></div>
                <div>当前状态: <b>{item.status === 'error' ? '待重试' : item.status === 'syncing' ? '同步中' : item.status === 'ready' ? '已同步' : '等待同步'}</b></div>
                <div>最近心跳: <b>{formatRelativeTime(item.last_heartbeat_at)}</b></div>
                <div>缓存复用: <b>{item.cache_reused ? `已复用 ${item.cache_document_count ?? 0} 条` : '无'}</b></div>
                <div>当前窗口: <b>{item.active_window?.window_start && item.active_window?.window_end ? `${item.active_window.window_start.slice(0, 10)} ~ ${item.active_window.window_end.slice(0, 10)}` : '未记录'}</b></div>
                <div>窗口状态: <b>{formatWindowStatus(item.active_window?.status)}</b></div>
                <div style={{ gridColumn: '1 / -1' }}>校验摘要: <b>{item.validation_summary?.latest_summary ?? '当前来源暂无额外校验提示。'}</b></div>
                {item.cache_reused ? <div style={{ gridColumn: '1 / -1' }}>缓存说明: <b>{item.cache_summary ?? '当前来源已复用历史素材缓存作为起始语料。'}</b></div> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RoundSummary({ detail }: { detail: CultivationDetail }) {
  if (!detail.rounds || detail.rounds.length === 0) {
    return <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>轮次摘要将在培养推进后显示。</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {detail.rounds.map((round) => (
        <div key={round.round} className="card" style={{ padding: 12, display: 'grid', gridTemplateColumns: '72px 1fr auto', gap: 12, alignItems: 'start' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgb(var(--text-primary))' }}>第 {round.round} 轮</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{round.objective}</div>
            <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))', marginTop: 4 }}>本轮使用素材量 {round.document_count} 条，围绕当前阶段继续补齐人格稳定性。</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: round.status === 'failed' ? '#ef4444' : round.status === 'running' ? '#0ea5e9' : '#16a34a', fontWeight: 600 }}>
              {formatRoundStatus(round.status)}
            </div>
            <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>{formatDate(round.finished_at)}</div>
          </div>
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
  onEdit,
  onDelete,
  onReload,
  onCheckUpdates,
  onContinue,
  onOpenChat,
  pendingOperation,
}: {
  persona: PersonaSummary;
  detail?: CultivationDetail;
  expanded: boolean;
  onExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReload: () => void;
  onCheckUpdates: () => Promise<void>;
  onContinue: () => Promise<void>;
  onOpenChat: () => void;
  pendingOperation?: 'deep_fetch' | 'incremental_sync';
}) {
  const stageStatus = persona.current_stage ?? persona.status;
  const progress = persona.progress_percent ?? 0;
  const softClosed = detail?.soft_closed ?? detail?.source_summary?.soft_closed ?? false;
  const finished = isFinishedStatus(stageStatus) || softClosed;
  const phase = detail?.phase ?? (finished ? 'ready' : stageStatus);
  const threshold = detail?.training_threshold ?? detail?.source_summary?.training_threshold;
  const thresholdMet = detail?.training_threshold_met ?? detail?.source_summary?.training_threshold_met;
  const evaluationPassed = detail?.evaluation_passed ?? detail?.source_summary?.evaluation_passed;
  const lastTrainingPrepCount = detail?.last_training_prep_count ?? detail?.source_summary?.last_training_prep_count;
  const retrainDeltaCount = detail?.retrain_delta_count ?? detail?.source_summary?.retrain_delta_count ?? 0;
  const retrainRequiredDelta = detail?.retrain_required_delta ?? detail?.source_summary?.retrain_required_delta;
  const retrainReady = detail?.retrain_ready ?? detail?.source_summary?.retrain_ready;
  const rawDocumentCount = detail?.raw_document_count ?? detail?.source_summary?.document_count ?? 0;
  const cleanDocumentCount = detail?.clean_document_count ?? detail?.source_summary?.clean_document_count ?? detail?.source_summary?.document_count ?? 0;
  const networkSummary = detail?.network_summary ?? detail?.source_summary?.network_summary;
  const displayPhaseLabel = softClosed
    ? '已按当前素材收口'
    : evaluationPassed === false && thresholdMet
    ? (retrainReady ? '准备进入下一轮训练' : '继续培养中')
    : formatPhaseLabel(detail?.phase);
  const meta = statusMeta(phase);
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
            : detail?.source_summary?.current_operation === 'web_build'
              ? '构建人物关系与背景中'
            : null;
  const tickerText = `[${String(progress).padStart(3, '0')}%] ${operationLabel ?? displayPhaseLabel} :: win ${String(detail?.source_summary?.completed_windows ?? 0).padStart(2, '0')} / ${String(detail?.source_summary?.estimated_total_windows ?? 0).padStart(2, '0')} :: raw ${String(rawDocumentCount).padStart(4, '0')} :: clean ${String(cleanDocumentCount).padStart(4, '0')} :: entity ${String(networkSummary?.entity_count ?? 0).padStart(3, '0')} :: rel ${String(networkSummary?.relation_count ?? 0).padStart(3, '0')} :: round ${String(persona.current_round ?? detail?.progress.current_round ?? 0).padStart(2, '0')} / ${String(persona.total_rounds ?? detail?.progress.total_rounds ?? 0).padStart(2, '0')} :: ${String(detail?.phase ?? stageStatus).toUpperCase()} ::`;
  const latestActivity = detail?.latest_activity || (operationLabel ? `当前任务：${operationLabel}` : '正在等待培养推进');
  const currentWindowText = formatWindowSentence(detail);
  const latestSourceWindow = getLatestSourceWindow(detail);
  const latestWindowNewCount = Math.max(
    latestSourceWindow?.new_count ?? 0,
    latestSourceWindow?.result_count ?? 0,
    latestSourceWindow?.matched_count ?? 0,
  );
  const latestWindowHint = latestWindowNewCount > 0
    ? `${latestSourceWindow?.source_label || '当前来源'} 最近窗口新增 ${latestWindowNewCount} 条`
    : null;
  const cacheReuse = detail?.cache_reuse;
  const collectionCycle = detail?.collection_cycle ?? detail?.source_summary?.collection_cycle;
  const collectionStopReason = detail?.collection_stop_reason ?? detail?.source_summary?.collection_stop_reason;
  const collectionStopReasonLabel = formatCollectionStopReasonLabel(collectionStopReason);
  const historyExhausted = detail?.history_exhausted ?? detail?.source_summary?.history_exhausted;
  const providerExhausted = detail?.provider_exhausted ?? detail?.source_summary?.provider_exhausted;
  const thresholdLabel = threshold ? `${cleanDocumentCount} / ${threshold}` : null;
  const thresholdHint = threshold && thresholdMet === false
    ? `未达到自动训练门槛，继续深抓中`
    : threshold && thresholdMet
      ? `已达到自动训练门槛`
      : null;
  const retrainProgressLabel = evaluationPassed === false && retrainRequiredDelta
    ? `新增素材 ${retrainDeltaCount} / ${retrainRequiredDelta}`
    : null;
  const evaluationHint = evaluationPassed === true
    ? '测评已通过'
    : softClosed
      ? '当前版本未完全通过测评'
      : evaluationPassed === false
      ? retrainReady
        ? '测评未通过，已达到下一轮训练条件'
        : '测评未通过，系统会继续补充素材'
      : null;

  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div
          className={finished ? undefined : 'soft-pulse'}
          style={{
            width: 44,
            height: 44,
            borderRadius: 11,
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
          {persona.name.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 84 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{persona.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: meta.color, fontSize: 12, fontWeight: 600 }}>
                {meta.color === '#22c55e' ? <CheckCircle2 size={14} /> : meta.color === '#ef4444' ? <AlertCircle size={14} /> : <RefreshCw size={14} />}
                {displayPhaseLabel || meta.label}
              </div>
            </div>
          <TideBar progress={progress} finished={finished} tickerText={tickerText} />
          <div style={{ marginTop: 10, fontSize: 12, color: finished ? '#16a34a' : 'rgb(var(--text-secondary))' }}>
            {latestActivity}
          </div>
          {cacheReuse?.active ? (
            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(56,189,248,0.18)', background: 'rgba(8,47,73,0.14)', fontSize: 12, color: 'rgb(var(--text-secondary))' }}>
              {cacheReuse.summary}，当前人格会在这批历史素材基础上继续培养。
            </div>
          ) : null}
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: 'rgb(var(--text-tertiary))' }}>
            <span>最近活动 {formatRelativeTime(detail?.last_heartbeat_at ?? detail?.last_success_at)}</span>
            {detail?.source_summary?.completed_windows !== undefined ? <span>窗口 {detail.source_summary.completed_windows ?? 0} / {detail.source_summary.estimated_total_windows ?? 0}</span> : null}
            <span>原始 {rawDocumentCount}</span>
            <span>纳入 {cleanDocumentCount}</span>
            {networkSummary ? <span>实体 {networkSummary.entity_count}</span> : null}
            {networkSummary ? <span>关系 {networkSummary.relation_count}</span> : null}
            {thresholdLabel ? <span>门槛 {thresholdLabel}</span> : null}
            {retrainProgressLabel ? <span>重训进度 {retrainProgressLabel}</span> : null}
            {typeof collectionCycle === 'number' && collectionCycle > 0 ? <span>循环 {collectionCycle}</span> : null}
            {evaluationHint ? <span>{evaluationHint}</span> : null}
            {latestWindowHint ? <span>{latestWindowHint}</span> : null}
            {cacheReuse?.active ? <span>缓存复用 {cacheReuse.reused_document_count}</span> : null}
            {currentWindowText ? <span>{currentWindowText}</span> : null}
          </div>
          {softClosed ? (
            <div style={{ marginTop: 8, fontSize: 11, color: 'rgb(var(--text-secondary))' }}>
              公开素材已触边，当前暂无更多可补素材，系统已基于现有语料生成当前版本人格。
            </div>
          ) : null}
          {thresholdHint ? (
            <div style={{ marginTop: 8, fontSize: 11, color: thresholdMet ? '#16a34a' : 'rgb(var(--text-secondary))' }}>
              {thresholdHint}
            </div>
          ) : null}
          {retrainProgressLabel ? (
            <div style={{ marginTop: 8, fontSize: 11, color: retrainReady ? '#16a34a' : 'rgb(var(--text-secondary))' }}>
              {retrainReady
                ? `${retrainProgressLabel}，已达到下一轮训练条件`
                : `${retrainProgressLabel}，达到后自动进入下一轮训练`}
            </div>
          ) : null}
          {evaluationPassed === false && latestWindowHint ? (
            <div style={{ marginTop: 8, fontSize: 11, color: 'rgb(var(--text-secondary))' }}>
              {latestWindowHint}，当前还未累计进下一轮重训进度。
            </div>
          ) : null}
          {collectionStopReason || historyExhausted || providerExhausted ? (
            <div style={{ marginTop: 8, fontSize: 11, color: 'rgb(var(--text-secondary))' }}>
              {collectionStopReasonLabel ? `收口状态：${collectionStopReasonLabel}` : null}
              {historyExhausted ? `${collectionStopReasonLabel ? ' · ' : ''}历史窗口已触边` : null}
              {providerExhausted ? `${collectionStopReason || historyExhausted ? ' · ' : ''}Provider 待恢复` : null}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 4 }}>
        <button className="btn btn-icon" onClick={onEdit} title="编辑来源" aria-label="编辑来源">
          <Edit2 size={13} />
        </button>
        <button
          className="btn btn-secondary"
          onClick={onExpand}
          title={expanded ? '收起详情' : '查看详情'}
          aria-label={expanded ? '收起详情' : '查看详情'}
          style={{ height: 28, padding: '0 10px', gap: 6, fontSize: 12 }}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span>{expanded ? '收起详情' : '查看详情'}</span>
        </button>
        <button className="btn btn-icon" onClick={onDelete} title="删除人格" aria-label="删除人格" style={{ color: '#ef4444' }}>
          <Trash2 size={13} />
        </button>
      </div>

      {expanded && detail ? (
        <div style={{ borderTop: '1px solid rgb(var(--border-light))', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <StageIndicator stages={detail.progress.stages} />

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>培养概览</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <InfoStat label="当前阶段" value={displayPhaseLabel} />
              <InfoStat label="当前轮次" value={`${detail.progress.current_round} / ${detail.progress.total_rounds}`} />
              <InfoStat label="原始素材总量" value={rawDocumentCount} />
              <InfoStat label="纳入训练量" value={cleanDocumentCount} />
              <InfoStat label="自动训练门槛" value={detail.training_threshold ?? '未配置'} />
              <InfoStat label="达训条件" value={detail.training_threshold_met ? '已达到' : '未达到'} />
              <InfoStat label="测评结果" value={evaluationPassed === true ? '已通过' : evaluationPassed === false ? '未通过' : '待测评'} />
              <InfoStat label="上一轮训练素材" value={lastTrainingPrepCount ?? '未记录'} />
              <InfoStat label="重训新增进度" value={retrainRequiredDelta ? `${retrainDeltaCount} / ${retrainRequiredDelta}` : '未启用'} />
              <InfoStat label="抓取循环轮次" value={collectionCycle ?? 0} />
              <InfoStat label="最近成功推进" value={formatDate(detail.last_success_at)} />
              <InfoStat label="最近活动心跳" value={formatRelativeTime(detail.last_heartbeat_at)} />
              <InfoStat label="最近检查更新" value={formatDate(detail.source_summary?.last_update_check_at)} />
              <InfoStat label="最近窗口新增" value={latestWindowNewCount} />
              <InfoStat label="人物实体" value={networkSummary?.entity_count ?? 0} />
              <InfoStat label="人物关系" value={networkSummary?.relation_count ?? 0} />
              <InfoStat label="背景包" value={networkSummary?.context_pack_count ?? 0} />
              <InfoStat label="身份轨迹" value={networkSummary?.arc_count ?? 0} />
              <InfoStat label="历史缓存复用" value={detail.cache_reuse?.active ? `${detail.cache_reuse.reused_document_count} 条` : '无'} />
              <InfoStat label="历史窗口状态" value={historyExhausted ? '已耗尽' : '未耗尽'} />
              <InfoStat label="Provider 状态" value={providerExhausted ? '待恢复' : '正常'} />
            </div>
            {detail.training_block_reason ? (
              <div style={{ marginTop: 10, fontSize: 12, color: 'rgb(var(--text-secondary))' }}>
                {detail.training_block_reason}
              </div>
            ) : null}
            {collectionStopReasonLabel ? (
              <div style={{ marginTop: 10, fontSize: 12, color: 'rgb(var(--text-secondary))' }}>
                当前收口原因：{collectionStopReasonLabel}
              </div>
            ) : null}
            {softClosed ? (
              <div style={{ marginTop: 10, fontSize: 12, color: 'rgb(var(--text-secondary))' }}>
                当前版本未完全通过测评，但公开素材已触边，系统已按现有语料收口；补充新来源或手动继续培养后可继续优化。
              </div>
            ) : null}
            {evaluationPassed === false && retrainRequiredDelta ? (
              <div style={{ marginTop: 10, fontSize: 12, color: 'rgb(var(--text-secondary))' }}>
                {retrainReady
                  ? `上一轮训练素材 ${lastTrainingPrepCount ?? 0} 条，新增素材 ${retrainDeltaCount} / ${retrainRequiredDelta}，已达到下一轮训练条件。`
                  : `上一轮训练素材 ${lastTrainingPrepCount ?? 0} 条，新增素材 ${retrainDeltaCount} / ${retrainRequiredDelta}，达到后自动进入下一轮训练。`}
              </div>
            ) : null}
          </div>

          {detail.current_window ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>当前窗口</div>
              <div className="card" style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>来源: <b>{detail.current_window.source_label || detail.source_summary?.current_source_label || '当前来源'}</b></div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>窗口: <b>{detail.current_window.window_start && detail.current_window.window_end ? `${detail.current_window.window_start.slice(0, 10)} ~ ${detail.current_window.window_end.slice(0, 10)}` : '未记录'}</b></div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>Provider: <b>{detail.current_window.provider || '未记录'}</b></div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>模式: <b>{detail.current_window.filter_mode || '未记录'}</b></div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>状态: <b>{formatWindowStatus(detail.current_window.status)}</b></div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>窗口产出: <b>{detail.current_window.result_count ?? 0} 条</b></div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>命中作者: <b>{detail.current_window.matched_count ?? 0}</b></div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>拒绝条数: <b>{detail.current_window.rejected_count ?? 0}</b></div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>隔离条数: <b>{detail.current_window.quarantined_count ?? 0}</b></div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>尝试次数: <b>{detail.current_window.attempt ?? 1}</b></div>
              </div>
            </div>
          ) : null}

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>来源分布</div>
            <SourceBreakdown detail={detail} />
          </div>

          {(detail.network_summary ?? detail.source_summary?.network_summary) ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>关系网摘要</div>
              <NetworkSummaryBlock detail={detail} />
            </div>
          ) : null}

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>来源明细</div>
            <SourceItems detail={detail} />
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>轮次摘要</div>
            <RoundSummary detail={detail} />
          </div>

          {(detail.skills.origin_skills.length > 0 || detail.skills.distilled_skills.length > 0) && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t('skillsTitle')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {detail.skills.origin_skills.map((s) => <span key={s.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: 'rgb(var(--bg-hover))', border: '1px solid rgb(var(--border))' }}>{s.name}</span>)}
                {detail.skills.distilled_skills.map((s) => <span key={s.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: 'rgb(var(--accent) / 0.08)', color: 'rgb(var(--accent))' }}>{s.name}</span>)}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <button className="btn btn-secondary" onClick={onEdit} style={{ fontSize: 12 }}>
              编辑来源
            </button>
            <button className="btn btn-secondary" onClick={() => void onCheckUpdates()} style={{ fontSize: 12 }} disabled={Boolean(pendingOperation)}>
              {pendingOperation === 'incremental_sync' ? '增量拉取中…' : '检查更新'}
            </button>
            {finished ? (
              <button className="btn btn-primary" onClick={onOpenChat} style={{ fontSize: 12 }}>
                开始对话
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => void onContinue()} style={{ fontSize: 12 }} disabled={Boolean(pendingOperation)}>
                {pendingOperation === 'deep_fetch' ? '深抓取中…' : '继续培养'}
              </button>
            )}
            {softClosed ? (
              <button className="btn btn-secondary" onClick={() => void onContinue()} style={{ fontSize: 12 }} disabled={Boolean(pendingOperation)}>
                {pendingOperation === 'deep_fetch' ? '深抓取中…' : '继续培养'}
              </button>
            ) : null}
            {stageStatus === 'error' ? <button className="btn btn-ghost" onClick={onReload} style={{ fontSize: 12 }}>{t('retry')}</button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CultivationCenter({
  onDelete,
  onEdit,
}: {
  onDelete: (p: PersonaSummary) => void;
  onEdit: (p: PersonaSummary) => void;
}) {
  const { cultivating, load, reload, details, loadDetail } = useCultivationStore();
  const { setPersona } = useChatStore();
  const { setView } = useAppStore();
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [pendingOps, setPendingOps] = useState<Record<string, 'deep_fetch' | 'incremental_sync' | undefined>>({});
  const pollInFlightRef = useRef(false);
  const detailInFlightRef = useRef(new Set<string>());
  const liveCultivatingSlugs = useMemo(() => new Set(cultivating.map((item) => item.slug)), [cultivating]);

  const loadDetailSafely = useCallback(async (slug: string) => {
    if (detailInFlightRef.current.has(slug)) return;
    detailInFlightRef.current.add(slug);
    try {
      await loadDetail(slug);
    } finally {
      detailInFlightRef.current.delete(slug);
    }
  }, [loadDetail]);

  const hasActiveSourceOp = cultivating.some((item) => {
    const detail = details[item.slug];
    return Boolean(pendingOps[item.slug]) || Boolean(detail?.source_summary?.current_operation && detail.source_summary.current_operation !== 'idle');
  });

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!expandedSlug || details[expandedSlug]) return;
    if (!liveCultivatingSlugs.has(expandedSlug)) {
      setExpandedSlug(null);
      return;
    }
    void loadDetailSafely(expandedSlug);
  }, [details, expandedSlug, liveCultivatingSlugs, loadDetailSafely]);

  useEffect(() => {
    if (expandedSlug && !liveCultivatingSlugs.has(expandedSlug)) {
      setExpandedSlug(null);
    }
  }, [expandedSlug, liveCultivatingSlugs]);

  useEffect(() => {
    cultivating.forEach((persona) => {
      if (!details[persona.slug]) {
        void loadDetailSafely(persona.slug);
      }
    });
  }, [cultivating, details, loadDetailSafely]);

  useEffect(() => {
    const poll = setInterval(() => {
      if (!(cultivating.some((item) => (item.progress_percent ?? 0) < 100) || hasActiveSourceOp)) return;
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      void (async () => {
        try {
          await reload();
          if (expandedSlug && liveCultivatingSlugs.has(expandedSlug)) {
            await loadDetailSafely(expandedSlug);
          }
        } finally {
          pollInFlightRef.current = false;
        }
      })();
    }, 5000);
    return () => clearInterval(poll);
  }, [cultivating, expandedSlug, hasActiveSourceOp, liveCultivatingSlugs, loadDetailSafely, reload]);

  useEffect(() => {
    const autoSync = setInterval(() => {
      if (cultivating.length === 0) return;
      cultivating.forEach((persona) => {
        const detail = details[persona.slug];
        const softClosed = detail?.soft_closed ?? detail?.source_summary?.soft_closed ?? false;
        if (softClosed) {
          void api.checkPersonaUpdates(persona.slug).catch(() => undefined);
          return;
        }
        const shouldDeepFetch =
          detail?.evaluation_passed === false
          || detail?.source_summary?.evaluation_passed === false
          || detail?.collection_stop_reason === 'evaluation_retry_pending'
          || detail?.source_summary?.collection_stop_reason === 'evaluation_retry_pending';
        if (shouldDeepFetch) {
          void api.continueCultivation(persona.slug).catch(() => undefined);
          return;
        }
        void api.checkPersonaUpdates(persona.slug).catch(() => undefined);
      });
    }, 10 * 60 * 1000);
    return () => clearInterval(autoSync);
  }, [cultivating, details]);

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

  async function handleOpenChat(persona: PersonaSummary) {
    await setPersona(persona.slug);
    setView('chat');
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
            onEdit={() => onEdit(persona)}
            onDelete={() => onDelete(persona)}
            onReload={() => void reload()}
            onCheckUpdates={() => handleCheckUpdates(persona.slug)}
            onContinue={() => handleContinue(persona.slug)}
            onOpenChat={() => void handleOpenChat(persona)}
          />
        ))}
      </div>
    </div>
  );
}
