'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dumbbell, Circle, TrendingUp, ShieldAlert, ChevronRight, Download } from 'lucide-react';

interface TrainingCardItem {
  slug: string;
  name: string;
  status?: string;
  gap_focused_trend_delta?: number | null;
  report: {
    generated_at: string;
    profile: string;
    total_rounds: number;
    summary: {
      avg_quality_score: number;
      avg_contradiction_rate: number;
      avg_duplication_rate: number;
      total_nodes_written: number;
      total_high_value_memories: number;
      origin_skills_added?: number;
      distilled_skills_added?: number;
      skill_coverage_score?: number;
      gap_focused_questions_ratio?: number;
      skill_trigger_precision?: number;
      skill_method_adherence?: number;
      skill_boundary_violation_rate?: number;
      skill_transfer_success_rate?: number;
      skill_set_stability?: number;
    };
  } | null;
  runtime_progress?: StreamProgress | null;
}

interface TrainingRoundDetail {
  round: number;
  status: 'running' | 'converged' | 'max_rounds_reached';
  avg_quality_score: number;
  nodes_written: number;
  nodes_reinforced: number;
  contradiction_rate: number;
  duplication_rate: number;
  low_confidence_coverage: number;
  new_high_value_memories: number;
  quarantined_memories: number;
  gap_focused_questions?: number;
  total_questions?: number;
}

interface TrainingDetailResponse {
  persona: { slug: string; name: string };
  report: {
    profile: string;
    summary?: {
      avg_quality_score?: number;
      avg_contradiction_rate?: number;
      avg_duplication_rate?: number;
      avg_low_confidence_coverage?: number;
      total_nodes_written?: number;
      total_nodes_reinforced?: number;
      total_high_value_memories?: number;
      total_quarantined_memories?: number;
      origin_skills_added?: number;
      distilled_skills_added?: number;
      skill_coverage_score?: number;
      gap_focused_questions_ratio?: number;
      skill_trigger_precision?: number;
      skill_method_adherence?: number;
      skill_boundary_violation_rate?: number;
      skill_transfer_success_rate?: number;
      skill_set_stability?: number;
    };
    rounds: TrainingRoundDetail[];
  };
  checkpoint_index?: {
    checkpoints?: Array<{
      id: string;
      created_at: string;
      track: string;
      round: number;
      stage: string;
    }>;
  } | null;
  latest_checkpoint?: {
    id: string;
    created_at: string;
    track: string;
    round: number;
    stage: string;
  } | null;
}

interface ExperimentSummaryRow {
  profile: string;
  totalRounds: number;
  avgQuality: number;
  contradictionRate: number;
  duplicationRate: number;
  coverage: number;
  run_quality?: string;
}

type ExperimentSuiteTier = 'official' | 'regression' | 'smoke' | 'ad_hoc';
type ExperimentPromotionReadiness = 'blocked' | 'provisional' | 'promotable';
type ExperimentSignificanceStatus = 'improved' | 'regressed' | 'not_significant' | 'insufficient_evidence';

interface ExperimentBenchmarkManifest {
  suite_tier?: ExperimentSuiteTier;
  suite_label?: string;
  pack_id?: string;
  pack_version?: string;
}

interface ExperimentEvaluationSummary {
  official_status?: 'available' | 'unavailable';
  official_best_profile?: string | null;
  observed_best_profile?: string | null;
  suite_tiers_present?: ExperimentSuiteTier[];
  suite_types_present?: string[];
  compatible_official_fallback_used?: boolean;
}

interface ExperimentBenchmarkPack {
  pack_id?: string;
  pack_version?: string;
  suite_type?: string;
  suite_tier?: ExperimentSuiteTier | string;
  status?: string;
}

interface ExperimentBenchmarkGovernance {
  version?: string;
  pack_id?: string;
  pack_version?: string;
  judge_mode?: string;
  official_benchmark_status?: 'available' | 'unavailable';
  promotion_readiness?: ExperimentPromotionReadiness;
  clean_replica_count?: number;
  benchmark_homogeneous?: boolean;
  significance_status?: ExperimentSignificanceStatus;
  judge_disagreement_rate?: number;
}

interface ExperimentReportData {
  generated_at: string;
  rounds_per_profile: number;
  best_profile: string | null;
  summary_rows: ExperimentSummaryRow[];
  official_summary_rows?: ExperimentSummaryRow[];
  benchmark_manifests?: ExperimentBenchmarkManifest[];
  benchmark_pack?: ExperimentBenchmarkPack;
  benchmark_governance?: ExperimentBenchmarkGovernance;
  evaluation_v2?: ExperimentEvaluationSummary;
}

interface ExperimentHistoryItem {
  kind: 'experiment' | 'ab_regression';
  filename: string;
  report:
    | ExperimentReportData
    | {
    generated_at: string;
    report_quality?: 'complete' | 'timeout_limited';
    group_a: string;
    group_b: string;
    execution?: {
      elapsed_ms?: number;
      fast_failures?: Array<{ profile: string; error: string }>;
    };
    deltas: {
      avg_quality: number;
      contradiction_rate: number;
      duplication_rate: number;
      coverage: number;
    };
    gate_result?: {
      enabled: boolean;
      passed: boolean;
      reason: string;
    };
  };
}

interface StreamProgress {
  stage: string;
  stageLabel: string;
  percent: number;
  currentRound: number;
  totalRounds: number;
  elapsedSec: number;
  etaMin: number;
  etaMax: number;
}

const TRAIN_STAGE_ORDER = [
  'init',
  'track_persona_extract',
  'skill_origin_extract',
  'skill_expand',
  'skill_merge',
  'track_work_execute',
  'training',
  'finalize',
  'done',
] as const;
const TRAIN_STAGE_LABEL: Record<string, string> = {
  init: '初始化任务',
  track_persona_extract: 'Track-A 人物能力提取',
  skill_origin_extract: 'Skill 原点提炼',
  skill_expand: 'Skill 证据融合',
  skill_merge: 'Skill 蒸馏入库',
  track_work_execute: 'Track-B 工程执行训练',
  training: '培养循环',
  finalize: '收尾与保存',
  done: '培养完成',
};

function formatDuration(sec: number): string {
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function isExperimentHistory(
  item: ExperimentHistoryItem
): item is ExperimentHistoryItem & {
  kind: 'experiment';
  report: ExperimentReportData;
} {
  return item.kind === 'experiment';
}

function isAbHistory(
  item: ExperimentHistoryItem
): item is ExperimentHistoryItem & {
  kind: 'ab_regression';
  report: {
    generated_at: string;
    report_quality?: 'complete' | 'timeout_limited';
    group_a: string;
    group_b: string;
    execution?: {
      elapsed_ms?: number;
      fast_failures?: Array<{ profile: string; error: string }>;
    };
    deltas: {
      avg_quality: number;
      contradiction_rate: number;
      duplication_rate: number;
      coverage: number;
    };
    gate_result?: {
      enabled: boolean;
      passed: boolean;
      reason: string;
    };
  };
} {
  return item.kind === 'ab_regression';
}

function getExperimentSuiteTier(report: ExperimentReportData): ExperimentSuiteTier {
  return report.benchmark_manifests?.[0]?.suite_tier
    ?? report.evaluation_v2?.suite_tiers_present?.[0]
    ?? 'ad_hoc';
}

function getExperimentOfficialStatus(report: ExperimentReportData): 'available' | 'unavailable' {
  return report.benchmark_governance?.official_benchmark_status
    ?? report.evaluation_v2?.official_status
    ?? 'unavailable';
}

function getExperimentPromotionReadiness(report: ExperimentReportData): ExperimentPromotionReadiness | null {
  return report.benchmark_governance?.promotion_readiness ?? null;
}

function getExperimentBenchmarkPackLabel(report: ExperimentReportData): string | null {
  const packId = report.benchmark_governance?.pack_id
    ?? report.benchmark_pack?.pack_id
    ?? report.benchmark_manifests?.[0]?.pack_id;
  const packVersion = report.benchmark_governance?.pack_version
    ?? report.benchmark_pack?.pack_version
    ?? report.benchmark_manifests?.[0]?.pack_version;
  if (!packId) return null;
  return packVersion ? `${packId}@${packVersion}` : packId;
}

function formatExperimentPromotionReadiness(readiness: ExperimentPromotionReadiness): string {
  switch (readiness) {
    case 'promotable':
      return 'promotable';
    case 'blocked':
      return 'blocked';
    default:
      return 'provisional';
  }
}

function formatExperimentSignificanceStatus(status: ExperimentSignificanceStatus): string {
  switch (status) {
    case 'improved':
      return 'improved';
    case 'regressed':
      return 'regressed';
    case 'insufficient_evidence':
      return 'insufficient_evidence';
    default:
      return 'not_significant';
  }
}

function getExperimentPrimaryProfile(report: ExperimentReportData): string | null {
  if (getExperimentOfficialStatus(report) === 'available') {
    return report.evaluation_v2?.official_best_profile ?? report.best_profile ?? null;
  }
  return report.best_profile ?? null;
}

function getExperimentDisplayRows(report: ExperimentReportData): ExperimentSummaryRow[] {
  if (getExperimentOfficialStatus(report) === 'available' && Array.isArray(report.official_summary_rows) && report.official_summary_rows.length > 0) {
    return report.official_summary_rows;
  }
  return report.summary_rows;
}

function canUseExperimentAsDefault(report: ExperimentReportData): boolean {
  const suiteTier = getExperimentSuiteTier(report);
  const readiness = getExperimentPromotionReadiness(report);
  if (readiness) {
    return readiness === 'promotable'
      && getExperimentOfficialStatus(report) === 'available'
      && suiteTier !== 'smoke'
      && suiteTier !== 'regression';
  }
  return getExperimentOfficialStatus(report) === 'available' && suiteTier !== 'smoke' && suiteTier !== 'regression';
}

function getExperimentDefaultDisabledReason(report: ExperimentReportData): string {
  const suiteTier = getExperimentSuiteTier(report);
  const readiness = getExperimentPromotionReadiness(report);
  if (readiness === 'blocked') {
    return 'benchmark governance 标记为 blocked，当前结果不能设为默认';
  }
  if (readiness === 'provisional') {
    return 'benchmark governance 仍为 provisional，需等待后续 judge/significance 验收';
  }
  if (getExperimentOfficialStatus(report) !== 'available') {
    return '当前实验没有 strict official 结论';
  }
  if (suiteTier === 'smoke') {
    return 'smoke 结果只用于冒烟验证，不能直接设为默认';
  }
  if (suiteTier === 'regression') {
    return 'A/B regression 结果只用于回归判断，不能直接设为默认';
  }
  return '';
}

function formatExperimentSuiteTier(suiteTier: ExperimentSuiteTier): string {
  switch (suiteTier) {
    case 'official':
      return 'official';
    case 'regression':
      return 'regression';
    case 'smoke':
      return 'smoke';
    default:
      return 'ad_hoc';
  }
}

function formatExperimentOfficialStatus(report: ExperimentReportData): string {
  return getExperimentOfficialStatus(report) === 'available' ? 'strict official available' : 'strict official unavailable';
}

export default function TrainingPage() {
  const [items, setItems] = useState<TrainingCardItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>('');
  const [detail, setDetail] = useState<TrainingDetailResponse | null>(null);
  const [experiments, setExperiments] = useState<ExperimentHistoryItem[]>([]);
  const [expandedExperiment, setExpandedExperiment] = useState<string>('');
  const [defaultTrainingProfile, setDefaultTrainingProfile] = useState<string>('full');
  const [savingProfile, setSavingProfile] = useState<string>('');
  const [continueMode, setContinueMode] = useState<'quick' | 'full'>('quick');
  const [continueStatus, setContinueStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [continueLogs, setContinueLogs] = useState<string[]>([]);
  const [resumeCheckpointId, setResumeCheckpointId] = useState<string>('latest');
  const [resumeStatus, setResumeStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [resumeMessage, setResumeMessage] = useState<string>('');
  const [continueProgress, setContinueProgress] = useState<StreamProgress>({
    stage: 'init',
    stageLabel: TRAIN_STAGE_LABEL.init,
    percent: 0,
    currentRound: 0,
    totalRounds: 3,
    elapsedSec: 0,
    etaMin: 15,
    etaMax: 30,
  });
  const continueSourceRef = useRef<EventSource | null>(null);

  const loadTrainingItems = useCallback(() => {
    fetch('/api/training', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TrainingCardItem[]) => {
        setItems(data);
        const slugFromUrl =
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('slug')
            : null;
        if (slugFromUrl && data.some((item) => item.slug === slugFromUrl)) {
          setSelectedSlug(slugFromUrl);
          return;
        }
        if (data.length > 0) setSelectedSlug((prev) => prev || data[0].slug);
      })
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    fetch('/api/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg?.defaultTrainingProfile) setDefaultTrainingProfile(String(cfg.defaultTrainingProfile));
      })
      .catch(() => null);

    loadTrainingItems();
  }, [loadTrainingItems]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadTrainingItems();
      if (selectedSlug) {
        fetch(`/api/training/${selectedSlug}`, { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: TrainingDetailResponse | null) => setDetail(data))
          .catch(() => null);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [loadTrainingItems, selectedSlug]);

  useEffect(() => {
    if (!selectedSlug) return;
    fetch(`/api/training/${selectedSlug}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TrainingDetailResponse | null) => {
        setDetail(data);
        setResumeCheckpointId('latest');
        setResumeStatus('idle');
        setResumeMessage('');
      })
      .catch(() => setDetail(null));
  }, [selectedSlug]);

  function reloadTrainingData(slug: string) {
    fetch('/api/training', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TrainingCardItem[]) => setItems(data))
      .catch(() => setItems([]));

    fetch(`/api/training/${slug}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TrainingDetailResponse | null) => setDetail(data))
      .catch(() => setDetail(null));
  }

  function continueTraining(mode: 'quick' | 'full') {
    if (!selectedSlug) return;
    if (continueSourceRef.current) {
      continueSourceRef.current.close();
      continueSourceRef.current = null;
    }
    setContinueMode(mode);
    setContinueStatus('running');
    setContinueLogs([]);
    setContinueProgress({
      stage: 'init',
      stageLabel: TRAIN_STAGE_LABEL.init,
      percent: 0,
      currentRound: 0,
      totalRounds: mode === 'quick' ? 3 : 10,
      elapsedSec: 0,
      etaMin: mode === 'quick' ? 15 : 30,
      etaMax: mode === 'quick' ? 30 : 90,
    });

    const params = new URLSearchParams({
      slug: selectedSlug,
      rounds: mode === 'quick' ? '3' : '10',
      trainingProfile: defaultTrainingProfile,
      track: 'full_serial',
      mode,
    });

    const es = new EventSource(`/api/train?${params}`);
    continueSourceRef.current = es;

    es.onmessage = (e) => {
      const { line } = JSON.parse(e.data);
      setContinueLogs((prev) => [...prev, line]);
    };
    es.addEventListener('progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as StreamProgress;
      setContinueProgress((prev) => ({ ...prev, ...data }));
    });

    es.addEventListener('done', (e) => {
      const { success } = JSON.parse((e as MessageEvent).data);
      setContinueStatus(success ? 'success' : 'error');
      if (success) {
        setContinueProgress((prev) => ({
          ...prev,
          stage: 'done',
          stageLabel: TRAIN_STAGE_LABEL.done,
          percent: 100,
          currentRound: prev.totalRounds,
          etaMin: 0,
          etaMax: 0,
        }));
      }
      es.close();
      continueSourceRef.current = null;
      if (success) reloadTrainingData(selectedSlug);
    });

    es.onerror = () => {
      setContinueLogs((prev) => [...prev, '连接中断，请检查服务是否正常运行。']);
      setContinueStatus('error');
      es.close();
      continueSourceRef.current = null;
    };
  }

  function stopContinueTraining() {
    if (!continueSourceRef.current) return;
    continueSourceRef.current.close();
    continueSourceRef.current = null;
    setContinueStatus('idle');
    setContinueLogs((prev) => [...prev, '⏹ 已手动停止继续培养']);
  }

  useEffect(() => {
    return () => {
      if (continueSourceRef.current) {
        continueSourceRef.current.close();
        continueSourceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    fetch(`/api/experiments/${selectedSlug}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ExperimentHistoryItem[]) => setExperiments(data))
      .catch(() => setExperiments([]));
  }, [selectedSlug]);

  async function setAsDefaultTrainingProfile(profile: string) {
    setSavingProfile(profile);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultTrainingProfile: profile }),
      });
      if (res.ok) setDefaultTrainingProfile(profile);
    } finally {
      setSavingProfile('');
    }
  }

  async function resumeTraining() {
    if (!selectedSlug) return;
    setResumeStatus('running');
    setResumeMessage('');
    try {
      const res = await fetch(`/api/train/${selectedSlug}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkpointId: resumeCheckpointId,
          track: 'full_serial',
        }),
      });
      const payload = await res.json().catch(() => ({})) as {
        ok?: boolean;
        status?: string;
        error?: string;
        resolvedCheckpoint?: string;
      };
      if (!res.ok || payload.ok === false) {
        setResumeStatus('error');
        setResumeMessage(payload.error ?? '恢复失败，请稍后重试');
        return;
      }
      setResumeStatus('success');
      const resolved = payload.resolvedCheckpoint ?? 'latest';
      setResumeMessage(`已入队恢复训练（checkpoint=${resolved}）`);
      reloadTrainingData(selectedSlug);
    } catch {
      setResumeStatus('error');
      setResumeMessage('恢复请求失败，请检查服务状态');
    }
  }

  function downloadDetailJson() {
    if (!detail) return;
    const blob = new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `training-report-${detail.persona.slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadRoundsCsv() {
    if (!detail) return;
    const head = [
      'round',
      'status',
      'avg_quality_score',
      'contradiction_rate',
      'duplication_rate',
      'low_confidence_coverage',
      'nodes_written',
      'nodes_reinforced',
      'new_high_value_memories',
      'quarantined_memories',
      'gap_focused_questions',
      'total_questions',
      'gap_focused_questions_ratio',
    ];
    const rows = detail.report.rounds.map((r) =>
      [
        r.round,
        r.status,
        r.avg_quality_score.toFixed(6),
        r.contradiction_rate.toFixed(6),
        r.duplication_rate.toFixed(6),
        r.low_confidence_coverage.toFixed(6),
        r.nodes_written,
        r.nodes_reinforced,
        r.new_high_value_memories,
        r.quarantined_memories,
        r.gap_focused_questions ?? 0,
        r.total_questions ?? 0,
        (typeof r.gap_focused_questions === 'number' && typeof r.total_questions === 'number' && r.total_questions > 0)
          ? (r.gap_focused_questions / r.total_questions).toFixed(6)
          : '0.000000',
      ].join(',')
    );
    const csv = [head.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `training-rounds-${detail.persona.slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadExperimentJson(item: ExperimentHistoryItem & {
    kind: 'experiment';
    report: ExperimentReportData;
  }) {
    const blob = new Blob([JSON.stringify(item.report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadExperimentCsv(item: ExperimentHistoryItem & {
    kind: 'experiment';
    report: ExperimentReportData;
  }) {
    const displayRows = getExperimentDisplayRows(item.report);
    const lines = [
      'profile,total_rounds,avg_quality,avg_contradiction_rate,avg_duplication_rate,coverage',
      ...displayRows.map((r) =>
        [
          r.profile,
          r.totalRounds,
          r.avgQuality.toFixed(6),
          r.contradictionRate.toFixed(6),
          r.duplicationRate.toFixed(6),
          r.coverage.toFixed(6),
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename.replace(/\.json$/, '.csv');
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadAbJson(item: ExperimentHistoryItem & {
    kind: 'ab_regression';
    report: {
      generated_at: string;
      report_quality?: 'complete' | 'timeout_limited';
      group_a: string;
      group_b: string;
      execution?: {
        elapsed_ms?: number;
        fast_failures?: Array<{ profile: string; error: string }>;
      };
      deltas: {
        avg_quality: number;
        contradiction_rate: number;
        duplication_rate: number;
        coverage: number;
      };
      gate_result?: {
        enabled: boolean;
        passed: boolean;
        reason: string;
      };
    };
  }) {
    const blob = new Blob([JSON.stringify(item.report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadAbCsv(item: ExperimentHistoryItem & {
    kind: 'ab_regression';
    report: {
      generated_at: string;
      group_a: string;
      group_b: string;
      deltas: {
        avg_quality: number;
        contradiction_rate: number;
        duplication_rate: number;
        coverage: number;
      };
      gate_result?: {
        enabled: boolean;
        passed: boolean;
        reason: string;
      };
    };
  }) {
    const lines = [
      'metric,delta_b_minus_a',
      `avg_quality,${item.report.deltas.avg_quality.toFixed(6)}`,
      `contradiction_rate,${item.report.deltas.contradiction_rate.toFixed(6)}`,
      `duplication_rate,${item.report.deltas.duplication_rate.toFixed(6)}`,
      `coverage,${item.report.deltas.coverage.toFixed(6)}`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename.replace(/\.json$/, '.csv');
    a.click();
    URL.revokeObjectURL(url);
  }

  const experimentReports = experiments.filter(isExperimentHistory);
  const abReports = experiments.filter(isAbHistory);

  return (
    <div className="p-8 max-w-[1200px]">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-[oklch(0.15_0_0)]">培养中心</h1>
      </div>
      <p className="text-[14px] text-[oklch(0.55_0_0)] mb-8">
        管理 Persona 的训练进度，查看每轮培养的质量变化。
      </p>

      {items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          {items.map((item) => (
            <button
              key={item.slug}
              onClick={() => setSelectedSlug(item.slug)}
              className="rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-5 text-left hover:border-[oklch(0.72_0.18_142)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-semibold text-[oklch(0.2_0_0)]">{item.name}</p>
                <div className="flex items-center gap-2">
                  {item.report ? (
                    <span className="text-[12px] px-2 py-1 rounded-full bg-[oklch(0.94_0.05_142)] text-[oklch(0.3_0.12_142)]">
                      {item.report.profile}
                    </span>
                  ) : (
                    <span className="text-[12px] px-2 py-1 rounded-full bg-[oklch(0.95_0.02_240)] text-[oklch(0.35_0.1_240)]">
                      {item.runtime_progress?.stageLabel ?? '运行中'}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-[oklch(0.7_0_0)]" />
                </div>
              </div>
              <p className="text-[12px] text-[oklch(0.6_0_0)] mt-1">/{item.slug}</p>
              {typeof item.gap_focused_trend_delta === 'number' && (
                <p className="text-[11.5px] mt-1 text-[oklch(0.52_0.08_240)]">
                  缺口趋势：{item.gap_focused_trend_delta >= 0 ? '+' : ''}{(item.gap_focused_trend_delta * 100).toFixed(1)}%
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 mt-4 text-[12.5px]">
                <div className="rounded-lg bg-[oklch(0.97_0_0)] p-3">
                  <p className="text-[oklch(0.55_0_0)]">{item.report ? '平均质量' : '当前进度'}</p>
                  <p className="mt-1 font-semibold text-[oklch(0.25_0_0)]">
                    {item.report ? `${(item.report.summary.avg_quality_score * 100).toFixed(1)}%` : `${Math.round(item.runtime_progress?.percent ?? 0)}%`}
                  </p>
                </div>
                <div className="rounded-lg bg-[oklch(0.97_0_0)] p-3">
                  <p className="text-[oklch(0.55_0_0)]">{item.report ? '矛盾率' : '预计剩余'}</p>
                  <p className="mt-1 font-semibold text-[oklch(0.25_0_0)]">
                    {item.report ? `${(item.report.summary.avg_contradiction_rate * 100).toFixed(1)}%` : `${item.runtime_progress?.etaMin ?? 0}-${item.runtime_progress?.etaMax ?? 0} 分钟`}
                  </p>
                </div>
                <div className="rounded-lg bg-[oklch(0.97_0_0)] p-3">
                  <p className="text-[oklch(0.55_0_0)]">
                    {item.report
                      ? (typeof item.report.summary.skill_coverage_score === 'number' ? 'Skill 覆盖' : '新增记忆')
                      : '当前轮次'}
                  </p>
                  <p className="mt-1 font-semibold text-[oklch(0.25_0_0)]">
                    {item.report
                      ? (typeof item.report.summary.skill_coverage_score === 'number'
                        ? `${(item.report.summary.skill_coverage_score * 100).toFixed(1)}%`
                        : item.report.summary.total_nodes_written)
                      : `${item.runtime_progress?.currentRound ?? 0}/${item.runtime_progress?.totalRounds ?? 0}`}
                  </p>
                </div>
                <div className="rounded-lg bg-[oklch(0.97_0_0)] p-3">
                  <p className="text-[oklch(0.55_0_0)]">
                    {item.report
                      ? (typeof item.report.summary.origin_skills_added === 'number' ? 'Skill 新增' : '高价值记忆')
                      : '已耗时'}
                  </p>
                  <p className="mt-1 font-semibold text-[oklch(0.25_0_0)]">
                    {item.report
                      ? (typeof item.report.summary.origin_skills_added === 'number'
                        ? `${item.report.summary.origin_skills_added ?? 0}/${item.report.summary.distilled_skills_added ?? 0}`
                        : item.report.summary.total_high_value_memories)
                      : formatDuration(item.runtime_progress?.elapsedSec ?? 0)}
                  </p>
                </div>
              </div>
              {item.report ? (
                <p className="text-[11.5px] text-[oklch(0.62_0_0)] mt-3">
                  最近训练：{new Date(item.report.generated_at).toLocaleString()}
                </p>
              ) : (
                <p className="text-[11.5px] text-[oklch(0.62_0_0)] mt-3">
                  实时更新：{item.runtime_progress?.stageLabel ?? '处理中'}
                </p>
              )}
              {item.report && typeof item.report.summary.gap_focused_questions_ratio === 'number' && (
                <p className="text-[11.5px] text-[oklch(0.52_0.08_240)] mt-1">
                  缺口聚焦题占比：{(item.report.summary.gap_focused_questions_ratio * 100).toFixed(1)}%
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {selectedSlug && !detail && (() => {
        const selected = items.find((item) => item.slug === selectedSlug);
        if (!selected?.runtime_progress) return null;
        const progress = selected.runtime_progress;
        return (
          <div className="mb-10 rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-5">
            <p className="text-[15px] font-semibold text-[oklch(0.2_0_0)]">
              {selected.name} · 实时培养进度
            </p>
            <p className="mt-1 text-[12px] text-[oklch(0.58_0_0)]">当前阶段：{progress.stageLabel}</p>
            <div className="mt-3 h-2.5 rounded-full bg-[oklch(0.93_0_0)] overflow-hidden">
              <div className="h-full bg-[oklch(0.72_0.18_142)] transition-all duration-500" style={{ width: `${Math.max(2, progress.percent)}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px]">
              <div className="rounded-md bg-[oklch(0.97_0_0)] px-3 py-2">
                <p className="text-[oklch(0.55_0_0)]">进度</p>
                <p className="font-medium text-[oklch(0.2_0_0)]">{Math.round(progress.percent)}%</p>
              </div>
              <div className="rounded-md bg-[oklch(0.97_0_0)] px-3 py-2">
                <p className="text-[oklch(0.55_0_0)]">轮次</p>
                <p className="font-medium text-[oklch(0.2_0_0)]">{progress.currentRound}/{progress.totalRounds}</p>
              </div>
              <div className="rounded-md bg-[oklch(0.97_0_0)] px-3 py-2">
                <p className="text-[oklch(0.55_0_0)]">已耗时</p>
                <p className="font-medium text-[oklch(0.2_0_0)]">{formatDuration(progress.elapsedSec)}</p>
              </div>
              <div className="rounded-md bg-[oklch(0.97_0_0)] px-3 py-2">
                <p className="text-[oklch(0.55_0_0)]">预计剩余</p>
                <p className="font-medium text-[oklch(0.2_0_0)]">{progress.etaMin}-{progress.etaMax} 分钟</p>
              </div>
            </div>
          </div>
        );
      })()}

      {detail && detail.report.rounds.length > 0 && (
        <div className="mb-10 rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-5 overflow-x-auto">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[15px] font-semibold text-[oklch(0.2_0_0)]">
              {detail.persona.name} · 轮次回放
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[12px] px-2 py-1 rounded-full bg-[oklch(0.95_0.02_240)] text-[oklch(0.35_0.1_240)]">
                profile: {detail.report.profile}
              </span>
              <button
                onClick={downloadDetailJson}
                className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-[oklch(0.9_0_0)] hover:bg-[oklch(0.97_0_0)]"
              >
                <Download className="w-3.5 h-3.5" /> JSON
              </button>
              <button
                onClick={downloadRoundsCsv}
                className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-[oklch(0.9_0_0)] hover:bg-[oklch(0.97_0_0)]"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-[oklch(0.9_0_0)] bg-[oklch(0.985_0_0)] p-3">
            {detail.report.summary && (
              <div className="mb-3 grid grid-cols-1 md:grid-cols-4 gap-2 text-[12px]">
                <div className="rounded-md bg-white border border-[oklch(0.9_0_0)] px-3 py-2">
                  <p className="text-[oklch(0.55_0_0)]">Skill 覆盖分</p>
                  <p className="font-medium text-[oklch(0.2_0_0)]">
                    {typeof detail.report.summary.skill_coverage_score === 'number'
                      ? `${(detail.report.summary.skill_coverage_score * 100).toFixed(1)}%`
                      : '-'}
                  </p>
                </div>
                <div className="rounded-md bg-white border border-[oklch(0.9_0_0)] px-3 py-2">
                  <p className="text-[oklch(0.55_0_0)]">原点 Skill 新增</p>
                  <p className="font-medium text-[oklch(0.2_0_0)]">{detail.report.summary.origin_skills_added ?? '-'}</p>
                </div>
                <div className="rounded-md bg-white border border-[oklch(0.9_0_0)] px-3 py-2">
                  <p className="text-[oklch(0.55_0_0)]">蒸馏 Skill 新增</p>
                  <p className="font-medium text-[oklch(0.2_0_0)]">{detail.report.summary.distilled_skills_added ?? '-'}</p>
                </div>
                <div className="rounded-md bg-white border border-[oklch(0.9_0_0)] px-3 py-2">
                  <p className="text-[oklch(0.55_0_0)]">缺口聚焦题占比</p>
                  <p className="font-medium text-[oklch(0.2_0_0)]">
                    {typeof detail.report.summary.gap_focused_questions_ratio === 'number'
                      ? `${(detail.report.summary.gap_focused_questions_ratio * 100).toFixed(1)}%`
                      : '-'}
                  </p>
                </div>
              </div>
            )}
            <p className="text-[13px] font-medium text-[oklch(0.28_0_0)] mb-2">继续培养</p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => continueTraining('quick')}
                disabled={continueStatus === 'running'}
                className="text-[12px] px-3 py-1.5 rounded-md border border-[oklch(0.85_0.03_142)] bg-[oklch(0.95_0.03_142)] text-[oklch(0.3_0.12_142)] hover:bg-[oklch(0.93_0.03_142)] disabled:opacity-60"
              >
                快速继续（3 轮）
              </button>
              <button
                onClick={() => continueTraining('full')}
                disabled={continueStatus === 'running'}
                className="text-[12px] px-3 py-1.5 rounded-md border border-[oklch(0.9_0_0)] bg-white hover:bg-[oklch(0.97_0_0)] disabled:opacity-60"
              >
                全量继续（10 轮）
              </button>
              {continueStatus === 'running' && (
                <button
                  onClick={stopContinueTraining}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-[oklch(0.85_0.03_0)] bg-[oklch(0.96_0.03_0)] text-[oklch(0.45_0.14_20)] hover:bg-[oklch(0.94_0.03_0)]"
                >
                  停止
                </button>
              )}
              <span className="text-[12px] text-[oklch(0.58_0_0)]">
                使用默认档位：{defaultTrainingProfile}
              </span>
            </div>
            <div className="mt-3 rounded-md border border-[oklch(0.9_0_0)] bg-white p-3">
              <p className="text-[12.5px] font-medium text-[oklch(0.25_0_0)] mb-2">一键 Resume（选 checkpoint）</p>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={resumeCheckpointId}
                  onChange={(e) => setResumeCheckpointId(e.target.value)}
                  className="text-[12px] px-2.5 py-1.5 rounded-md border border-[oklch(0.9_0_0)] bg-white min-w-[280px]"
                >
                  <option value="latest">latest（自动使用最新 checkpoint）</option>
                  {(detail.checkpoint_index?.checkpoints ?? []).map((cp) => (
                    <option key={cp.id} value={cp.id}>
                      {cp.track} / round {cp.round} / {cp.stage} / {new Date(cp.created_at).toLocaleString()}
                    </option>
                  ))}
                </select>
                <button
                  onClick={resumeTraining}
                  disabled={resumeStatus === 'running'}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-[oklch(0.82_0.06_240)] bg-[oklch(0.95_0.03_240)] text-[oklch(0.35_0.1_240)] hover:bg-[oklch(0.93_0.03_240)] disabled:opacity-60"
                >
                  {resumeStatus === 'running' ? '恢复中...' : '恢复训练'}
                </button>
                {detail.latest_checkpoint && (
                  <span className="text-[11.5px] text-[oklch(0.58_0_0)]">
                    最新 checkpoint：{detail.latest_checkpoint.track} / round {detail.latest_checkpoint.round}
                  </span>
                )}
              </div>
              {resumeMessage && (
                <p className={`mt-2 text-[12px] ${resumeStatus === 'error' ? 'text-[oklch(0.45_0.14_20)]' : 'text-[oklch(0.35_0.12_142)]'}`}>
                  {resumeMessage}
                </p>
              )}
            </div>
            {continueStatus !== 'idle' && (
              <div className="mt-3 rounded-lg border border-[oklch(0.9_0_0)] bg-white p-3">
                <div className="flex items-center justify-between text-[12.5px]">
                  <p className="font-medium text-[oklch(0.25_0_0)]">
                    状态：{continueStatus === 'running' ? `运行中（${continueMode}）` : continueStatus === 'success' ? '完成' : '失败'}
                  </p>
                  <p className="text-[oklch(0.55_0_0)]">{Math.round(continueProgress.percent)}%</p>
                </div>
                <p className="mt-1 text-[12px] text-[oklch(0.55_0_0)]">当前阶段：{continueProgress.stageLabel}</p>
                <div className="mt-2 h-2.5 rounded-full bg-[oklch(0.93_0_0)] overflow-hidden">
                  <div
                    className="h-full bg-[oklch(0.72_0.18_142)] transition-all duration-500"
                    style={{ width: `${Math.max(2, continueProgress.percent)}%` }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-md bg-[oklch(0.97_0_0)] px-2.5 py-2">
                    <p className="text-[oklch(0.55_0_0)]">已耗时</p>
                    <p className="font-medium text-[oklch(0.2_0_0)]">{formatDuration(continueProgress.elapsedSec)}</p>
                  </div>
                  <div className="rounded-md bg-[oklch(0.97_0_0)] px-2.5 py-2">
                    <p className="text-[oklch(0.55_0_0)]">预计剩余</p>
                    <p className="font-medium text-[oklch(0.2_0_0)]">{continueProgress.etaMin} - {continueProgress.etaMax} 分钟</p>
                  </div>
                </div>
                <p className="mt-2 text-[12px] text-[oklch(0.55_0_0)]">
                  当前轮次：{Math.min(continueProgress.currentRound, continueProgress.totalRounds)} / {continueProgress.totalRounds}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TRAIN_STAGE_ORDER.map((key) => {
                    const currentIdx = TRAIN_STAGE_ORDER.indexOf(continueProgress.stage as (typeof TRAIN_STAGE_ORDER)[number]);
                    const idx = TRAIN_STAGE_ORDER.indexOf(key);
                    const done = idx < Math.max(0, currentIdx);
                    const active = key === continueProgress.stage;
                    return (
                      <span
                        key={key}
                        className={
                          done
                            ? 'text-[11px] px-2 py-1 rounded-full border border-[oklch(0.82_0.06_142)] bg-[oklch(0.95_0.04_142)] text-[oklch(0.3_0.12_142)]'
                            : active
                            ? 'text-[11px] px-2 py-1 rounded-full border border-[oklch(0.8_0.05_240)] bg-[oklch(0.95_0.03_240)] text-[oklch(0.32_0.1_240)]'
                            : 'text-[11px] px-2 py-1 rounded-full border border-[oklch(0.9_0_0)] bg-[oklch(0.98_0_0)] text-[oklch(0.6_0_0)]'
                        }
                      >
                        {TRAIN_STAGE_LABEL[key]}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {continueLogs.length > 0 && (
              <div className="mt-2 max-h-36 overflow-y-auto rounded-md bg-[oklch(0.12_0_0)] p-2 font-mono text-[11.5px]">
                {continueLogs.slice(-20).map((line, i) => (
                  <div key={`${line}-${i}`} className="text-[oklch(0.82_0_0)]">{line}</div>
                ))}
              </div>
            )}
          </div>

          <QualityTrendChart rounds={detail.report.rounds} />

          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[oklch(0.55_0_0)] border-b border-[oklch(0.92_0_0)]">
                <th className="py-2 pr-3">Round</th>
                <th className="py-2 pr-3">状态</th>
                <th className="py-2 pr-3">质量</th>
                <th className="py-2 pr-3">矛盾率</th>
                <th className="py-2 pr-3">重复率</th>
                <th className="py-2 pr-3">低置信覆盖</th>
                <th className="py-2 pr-3">新增</th>
                <th className="py-2 pr-3">强化</th>
                <th className="py-2 pr-3">高价值</th>
                <th className="py-2 pr-3">隔离</th>
                <th className="py-2">缺口聚焦</th>
              </tr>
            </thead>
            <tbody>
              {detail.report.rounds.map((r) => (
                <tr key={r.round} className="border-b border-[oklch(0.95_0_0)]">
                  <td className="py-2 pr-3">{r.round}</td>
                  <td className="py-2 pr-3">{r.status}</td>
                  <td className="py-2 pr-3">{(r.avg_quality_score * 100).toFixed(1)}%</td>
                  <td className="py-2 pr-3">{(r.contradiction_rate * 100).toFixed(1)}%</td>
                  <td className="py-2 pr-3">{(r.duplication_rate * 100).toFixed(1)}%</td>
                  <td className="py-2 pr-3">{(r.low_confidence_coverage * 100).toFixed(1)}%</td>
                  <td className="py-2 pr-3">{r.nodes_written}</td>
                  <td className="py-2 pr-3">{r.nodes_reinforced}</td>
                  <td className="py-2 pr-3">{r.new_high_value_memories}</td>
                  <td className="py-2 pr-3">{r.quarantined_memories}</td>
                  <td className="py-2">
                    {typeof r.gap_focused_questions === 'number' && typeof r.total_questions === 'number' && r.total_questions > 0
                      ? `${r.gap_focused_questions}/${r.total_questions} (${((r.gap_focused_questions / r.total_questions) * 100).toFixed(0)}%)`
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedSlug && experimentReports.length > 0 && (
        <div className="mb-10 rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[15px] font-semibold text-[oklch(0.2_0_0)]">
              实验历史（{selectedSlug}）
            </p>
            <span className="text-[12px] px-2 py-1 rounded-full bg-[oklch(0.95_0.02_240)] text-[oklch(0.35_0.1_240)]">
              默认档位: {defaultTrainingProfile}
            </span>
          </div>
          <div className="space-y-3">
            {experimentReports.map((item) => {
              const suiteTier = getExperimentSuiteTier(item.report);
              const officialStatus = getExperimentOfficialStatus(item.report);
              const promotionReadiness = getExperimentPromotionReadiness(item.report);
              const benchmarkPackLabel = getExperimentBenchmarkPackLabel(item.report);
              const significanceStatus = item.report.benchmark_governance?.significance_status;
              const recommendedProfile = getExperimentPrimaryProfile(item.report);
              const displayRows = getExperimentDisplayRows(item.report);
              const canSetDefault = canUseExperimentAsDefault(item.report) && Boolean(recommendedProfile);
              const disabledReason = getExperimentDefaultDisabledReason(item.report);

              return (
                <div
                  key={item.filename}
                  className="rounded-xl border border-[oklch(0.92_0_0)] bg-[oklch(0.985_0_0)] p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-medium text-[oklch(0.28_0_0)]">
                        {new Date(item.report.generated_at).toLocaleString()}
                      </p>
                      <p className="text-[12px] text-[oklch(0.58_0_0)] mt-0.5">
                        rounds/profile: {item.report.rounds_per_profile} · best: {item.report.best_profile ?? '-'} · strict official: {recommendedProfile ?? '-'}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-[oklch(0.96_0.02_240)] text-[oklch(0.36_0.1_240)]">
                          suite: {formatExperimentSuiteTier(suiteTier)}
                        </span>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full ${
                            officialStatus === 'available'
                              ? 'bg-[oklch(0.95_0.03_142)] text-[oklch(0.3_0.12_142)]'
                              : 'bg-[oklch(0.97_0.01_40)] text-[oklch(0.44_0.05_40)]'
                          }`}
                        >
                          {formatExperimentOfficialStatus(item.report)}
                        </span>
                        {benchmarkPackLabel && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[oklch(0.96_0.01_220)] text-[oklch(0.34_0.07_220)]">
                            pack: {benchmarkPackLabel}
                          </span>
                        )}
                        {promotionReadiness && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[oklch(0.97_0.01_80)] text-[oklch(0.42_0.07_80)]">
                            governance: {formatExperimentPromotionReadiness(promotionReadiness)}
                          </span>
                        )}
                        {significanceStatus && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[oklch(0.96_0.01_180)] text-[oklch(0.34_0.07_180)]">
                            significance: {formatExperimentSignificanceStatus(significanceStatus)}
                          </span>
                        )}
                        {item.report.evaluation_v2?.compatible_official_fallback_used && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[oklch(0.97_0.01_40)] text-[oklch(0.44_0.05_40)]">
                            observed fallback kept for compatibility
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setExpandedExperiment((prev) =>
                            prev === item.filename ? '' : item.filename
                          )
                        }
                        className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-[oklch(0.9_0_0)] hover:bg-[oklch(0.97_0_0)]"
                      >
                        {expandedExperiment === item.filename ? '收起' : '展开'}
                      </button>
                      <button
                        onClick={() => recommendedProfile && setAsDefaultTrainingProfile(recommendedProfile)}
                        disabled={!canSetDefault || savingProfile === recommendedProfile}
                        title={canSetDefault ? undefined : disabledReason}
                        className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-[oklch(0.85_0.03_142)] bg-[oklch(0.95_0.03_142)] text-[oklch(0.3_0.12_142)] hover:bg-[oklch(0.93_0.03_142)] disabled:opacity-60"
                      >
                        {recommendedProfile ? `设默认(${recommendedProfile})` : '设默认不可用'}
                      </button>
                      <button
                        onClick={() => downloadExperimentJson(item)}
                        className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-[oklch(0.9_0_0)] hover:bg-[oklch(0.97_0_0)]"
                      >
                        <Download className="w-3.5 h-3.5" /> JSON
                      </button>
                      <button
                        onClick={() => downloadExperimentCsv(item)}
                        className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-[oklch(0.9_0_0)] hover:bg-[oklch(0.97_0_0)]"
                      >
                        <Download className="w-3.5 h-3.5" /> CSV
                      </button>
                    </div>
                  </div>

                  {disabledReason && (
                    <p className="mt-2 text-[11.5px] text-[oklch(0.56_0_0)]">
                      默认推荐限制：{disabledReason}
                    </p>
                  )}

                  {expandedExperiment === item.filename && (
                    <div className="mt-3 overflow-x-auto">
                      <p className="mb-2 text-[11.5px] text-[oklch(0.56_0_0)]">
                        当前表格展示：{officialStatus === 'available' ? 'strict official rows' : 'observed rows'}
                      </p>
                      {item.report.benchmark_governance && (
                        <p className="mb-2 text-[11.5px] text-[oklch(0.56_0_0)]">
                          benchmark governance：judge={item.report.benchmark_governance.judge_mode ?? '-'} ·
                          clean replicas={item.report.benchmark_governance.clean_replica_count ?? '-'} ·
                          disagreement={typeof item.report.benchmark_governance.judge_disagreement_rate === 'number'
                            ? `${(item.report.benchmark_governance.judge_disagreement_rate * 100).toFixed(1)}%`
                            : '-'}
                        </p>
                      )}
                      <table className="w-full text-[12.5px]">
                        <thead>
                          <tr className="text-left text-[oklch(0.55_0_0)] border-b border-[oklch(0.92_0_0)]">
                            <th className="py-2 pr-3">Profile</th>
                            <th className="py-2 pr-3">Rounds</th>
                            <th className="py-2 pr-3">质量</th>
                            <th className="py-2 pr-3">矛盾率</th>
                            <th className="py-2 pr-3">重复率</th>
                            <th className="py-2 pr-3">Coverage</th>
                            <th className="py-2 pr-3">状态</th>
                            <th className="py-2">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayRows.map((r) => {
                            const rowCanSetDefault = canSetDefault && r.profile === recommendedProfile;
                            return (
                              <tr key={`${item.filename}-${r.profile}`} className="border-b border-[oklch(0.95_0_0)]">
                                <td className="py-2 pr-3">{r.profile}</td>
                                <td className="py-2 pr-3">{r.totalRounds}</td>
                                <td className="py-2 pr-3">{(r.avgQuality * 100).toFixed(1)}%</td>
                                <td className="py-2 pr-3">{(r.contradictionRate * 100).toFixed(1)}%</td>
                                <td className="py-2 pr-3">{(r.duplicationRate * 100).toFixed(1)}%</td>
                                <td className="py-2 pr-3">{(r.coverage * 100).toFixed(1)}%</td>
                                <td className="py-2 pr-3">{r.run_quality ?? 'n/a'}</td>
                                <td className="py-2">
                                  <button
                                    onClick={() => setAsDefaultTrainingProfile(r.profile)}
                                    disabled={!rowCanSetDefault || savingProfile === r.profile}
                                    title={rowCanSetDefault ? undefined : disabledReason || '只有 strict official 推荐档位可以直接设为默认'}
                                    className="text-[12px] px-2 py-1 rounded-md border border-[oklch(0.9_0_0)] hover:bg-[oklch(0.97_0_0)] disabled:opacity-60"
                                  >
                                    设为默认
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selectedSlug && abReports.length > 0 && (
        <div className="mb-10 rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[15px] font-semibold text-[oklch(0.2_0_0)]">
              A/B 回归报告（{selectedSlug}）
            </p>
          </div>
          <div className="space-y-3">
            {abReports.map((item) => (
              <div
                key={item.filename}
                className="rounded-xl border border-[oklch(0.92_0_0)] bg-[oklch(0.985_0_0)] p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-medium text-[oklch(0.28_0_0)]">
                      {new Date(item.report.generated_at).toLocaleString()}
                    </p>
                    <p className="text-[12px] text-[oklch(0.58_0_0)] mt-0.5">
                      A={item.report.group_a} · B={item.report.group_b}
                    </p>
                    <p className="text-[11.5px] text-[oklch(0.56_0_0)] mt-0.5">
                      质量标记：{item.report.report_quality ?? 'complete'} · 耗时：{Math.round((item.report.execution?.elapsed_ms ?? 0) / 1000)}s
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.report.gate_result?.enabled && (
                      <span
                        className={`text-[12px] px-2 py-1 rounded-full ${
                          item.report.gate_result.passed
                            ? 'bg-[oklch(0.95_0.03_142)] text-[oklch(0.3_0.12_142)]'
                            : 'bg-[oklch(0.96_0.03_20)] text-[oklch(0.42_0.15_20)]'
                        }`}
                      >
                        Gate: {item.report.gate_result.passed ? 'passed' : 'failed'}
                      </span>
                    )}
                    <button
                      onClick={() =>
                        setExpandedExperiment((prev) =>
                          prev === item.filename ? '' : item.filename
                        )
                      }
                      className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-[oklch(0.9_0_0)] hover:bg-[oklch(0.97_0_0)]"
                    >
                      {expandedExperiment === item.filename ? '收起' : '展开'}
                    </button>
                    <button
                      onClick={() => downloadAbJson(item)}
                      className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-[oklch(0.9_0_0)] hover:bg-[oklch(0.97_0_0)]"
                    >
                      <Download className="w-3.5 h-3.5" /> JSON
                    </button>
                    <button
                      onClick={() => downloadAbCsv(item)}
                      className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-[oklch(0.9_0_0)] hover:bg-[oklch(0.97_0_0)]"
                    >
                      <Download className="w-3.5 h-3.5" /> CSV
                    </button>
                  </div>
                </div>

                {expandedExperiment === item.filename && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="text-left text-[oklch(0.55_0_0)] border-b border-[oklch(0.92_0_0)]">
                          <th className="py-2 pr-3">指标</th>
                          <th className="py-2 pr-3">Delta(B-A)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-[oklch(0.95_0_0)]">
                          <td className="py-2 pr-3">avg_quality</td>
                          <td className="py-2 pr-3">{item.report.deltas.avg_quality.toFixed(4)}</td>
                        </tr>
                        <tr className="border-b border-[oklch(0.95_0_0)]">
                          <td className="py-2 pr-3">contradiction_rate</td>
                          <td className="py-2 pr-3">{item.report.deltas.contradiction_rate.toFixed(4)}</td>
                        </tr>
                        <tr className="border-b border-[oklch(0.95_0_0)]">
                          <td className="py-2 pr-3">duplication_rate</td>
                          <td className="py-2 pr-3">{item.report.deltas.duplication_rate.toFixed(4)}</td>
                        </tr>
                        <tr className="border-b border-[oklch(0.95_0_0)]">
                          <td className="py-2 pr-3">coverage</td>
                          <td className="py-2 pr-3">{item.report.deltas.coverage.toFixed(4)}</td>
                        </tr>
                      </tbody>
                    </table>
                    {item.report.gate_result?.reason && (
                      <p className="mt-2 text-[12px] text-[oklch(0.58_0_0)]">
                        Gate 说明：{item.report.gate_result.reason}
                      </p>
                    )}
                    {(item.report.execution?.fast_failures?.length ?? 0) > 0 && (
                      <p className="mt-1 text-[12px] text-[oklch(0.5_0.12_20)]">
                        fast-fail：{item.report.execution?.fast_failures?.map((f) => `${f.profile}: ${f.error.slice(0, 80)}`).join(' | ')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[oklch(0.94_0.05_142)] flex items-center justify-center mb-5">
            <Dumbbell className="w-8 h-8 text-[oklch(0.4_0.15_142)]" />
          </div>
          <p className="text-[16px] font-semibold text-[oklch(0.25_0_0)]">暂无培养报告</p>
          <p className="text-[13px] text-[oklch(0.6_0_0)] mt-2 max-w-[360px]">
            运行带训练轮次的创建命令后，会自动生成训练报告并在这里展示。
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-[oklch(0.9_0_0)] bg-white p-4">
          <div className="flex items-center gap-2 text-[oklch(0.4_0.12_142)]">
            <TrendingUp className="w-4 h-4" />
            <span className="text-[13px] font-medium">质量优先</span>
          </div>
          <p className="text-[12px] text-[oklch(0.58_0_0)] mt-2">优先提升 consistency / authenticity / depth。</p>
        </div>
        <div className="rounded-xl border border-[oklch(0.9_0_0)] bg-white p-4">
          <div className="flex items-center gap-2 text-[oklch(0.38_0.08_240)]">
            <ShieldAlert className="w-4 h-4" />
            <span className="text-[13px] font-medium">风险控制</span>
          </div>
          <p className="text-[12px] text-[oklch(0.58_0_0)] mt-2">持续跟踪矛盾率与重复率，防止错误记忆累积。</p>
        </div>
        <div className="rounded-xl border border-[oklch(0.9_0_0)] bg-white p-4">
          <div className="flex items-center gap-2 text-[oklch(0.35_0_0)]">
            <Circle className="w-4 h-4" />
            <span className="text-[13px] font-medium">课程化训练</span>
          </div>
          <p className="text-[12px] text-[oklch(0.58_0_0)] mt-2">按低置信维度动态配题，逐步进入高难度挑战。</p>
        </div>
      </div>
    </div>
  );
}

function QualityTrendChart({ rounds }: { rounds: TrainingRoundDetail[] }) {
  const width = 760;
  const height = 180;
  const pad = 28;
  const maxX = Math.max(1, rounds.length - 1);
  const toX = (index: number) => pad + (index / maxX) * (width - pad * 2);
  const toY = (value: number) => pad + (1 - value) * (height - pad * 2);

  const qualityPath = rounds
    .map((r, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(r.avg_quality_score)}`)
    .join(' ');
  const contradictionPath = rounds
    .map((r, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(r.contradiction_rate)}`)
    .join(' ');

  return (
    <div className="mb-5 rounded-xl border border-[oklch(0.92_0_0)] bg-[oklch(0.985_0_0)] p-3">
      <p className="text-[12px] text-[oklch(0.55_0_0)] mb-2">
        趋势图：质量（绿） vs 矛盾率（红）
      </p>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[180px]">
        <rect x="0" y="0" width={width} height={height} fill="transparent" />
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <line
            key={v}
            x1={pad}
            x2={width - pad}
            y1={toY(v)}
            y2={toY(v)}
            stroke="oklch(0.9 0 0)"
            strokeWidth="1"
          />
        ))}
        <path d={qualityPath} stroke="oklch(0.62 0.18 142)" strokeWidth="2.5" fill="none" />
        <path d={contradictionPath} stroke="oklch(0.55 0.2 20)" strokeWidth="2.5" fill="none" />
        {rounds.map((r, i) => (
          <circle
            key={`q-${r.round}`}
            cx={toX(i)}
            cy={toY(r.avg_quality_score)}
            r="3"
            fill="oklch(0.62 0.18 142)"
          />
        ))}
        {rounds.map((r, i) => (
          <circle
            key={`c-${r.round}`}
            cx={toX(i)}
            cy={toY(r.contradiction_rate)}
            r="3"
            fill="oklch(0.55 0.2 20)"
          />
        ))}
      </svg>
    </div>
  );
}
