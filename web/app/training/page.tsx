'use client';

import { useEffect, useRef, useState } from 'react';
import { Dumbbell, Circle, TrendingUp, ShieldAlert, ChevronRight, Download } from 'lucide-react';

interface TrainingCardItem {
  slug: string;
  name: string;
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
    };
  };
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
}

interface TrainingDetailResponse {
  persona: { slug: string; name: string };
  report: {
    profile: string;
    rounds: TrainingRoundDetail[];
  };
}

interface ExperimentSummaryRow {
  profile: string;
  totalRounds: number;
  avgQuality: number;
  contradictionRate: number;
  duplicationRate: number;
  coverage: number;
}

interface ExperimentHistoryItem {
  filename: string;
  report: {
    generated_at: string;
    rounds_per_profile: number;
    best_profile: string;
    summary_rows: ExperimentSummaryRow[];
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

const TRAIN_STAGE_ORDER = ['init', 'training', 'finalize', 'done'] as const;
const TRAIN_STAGE_LABEL: Record<string, string> = {
  init: '初始化任务',
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

  useEffect(() => {
    fetch('/api/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg?.defaultTrainingProfile) setDefaultTrainingProfile(String(cfg.defaultTrainingProfile));
      })
      .catch(() => null);

    fetch('/api/training', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TrainingCardItem[]) => {
        setItems(data);
        if (data.length > 0) setSelectedSlug((prev) => prev || data[0].slug);
      })
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    fetch(`/api/training/${selectedSlug}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TrainingDetailResponse | null) => setDetail(data))
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

  function downloadExperimentJson(item: ExperimentHistoryItem) {
    const blob = new Blob([JSON.stringify(item.report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadExperimentCsv(item: ExperimentHistoryItem) {
    const lines = [
      'profile,total_rounds,avg_quality,avg_contradiction_rate,avg_duplication_rate,coverage',
      ...item.report.summary_rows.map((r) =>
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
                  <span className="text-[12px] px-2 py-1 rounded-full bg-[oklch(0.94_0.05_142)] text-[oklch(0.3_0.12_142)]">
                    {item.report.profile}
                  </span>
                  <ChevronRight className="w-4 h-4 text-[oklch(0.7_0_0)]" />
                </div>
              </div>
              <p className="text-[12px] text-[oklch(0.6_0_0)] mt-1">/{item.slug}</p>
              <div className="grid grid-cols-2 gap-3 mt-4 text-[12.5px]">
                <div className="rounded-lg bg-[oklch(0.97_0_0)] p-3">
                  <p className="text-[oklch(0.55_0_0)]">平均质量</p>
                  <p className="mt-1 font-semibold text-[oklch(0.25_0_0)]">
                    {(item.report.summary.avg_quality_score * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-lg bg-[oklch(0.97_0_0)] p-3">
                  <p className="text-[oklch(0.55_0_0)]">矛盾率</p>
                  <p className="mt-1 font-semibold text-[oklch(0.25_0_0)]">
                    {(item.report.summary.avg_contradiction_rate * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-lg bg-[oklch(0.97_0_0)] p-3">
                  <p className="text-[oklch(0.55_0_0)]">新增记忆</p>
                  <p className="mt-1 font-semibold text-[oklch(0.25_0_0)]">
                    {item.report.summary.total_nodes_written}
                  </p>
                </div>
                <div className="rounded-lg bg-[oklch(0.97_0_0)] p-3">
                  <p className="text-[oklch(0.55_0_0)]">高价值记忆</p>
                  <p className="mt-1 font-semibold text-[oklch(0.25_0_0)]">
                    {item.report.summary.total_high_value_memories}
                  </p>
                </div>
              </div>
              <p className="text-[11.5px] text-[oklch(0.62_0_0)] mt-3">
                最近训练：{new Date(item.report.generated_at).toLocaleString()}
              </p>
            </button>
          ))}
        </div>
      )}

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
                <th className="py-2">隔离</th>
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
                  <td className="py-2">{r.quarantined_memories}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedSlug && experiments.length > 0 && (
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
            {experiments.map((item) => (
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
                      rounds/profile: {item.report.rounds_per_profile} · best: {item.report.best_profile}
                    </p>
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
                      onClick={() => setAsDefaultTrainingProfile(item.report.best_profile)}
                      disabled={savingProfile === item.report.best_profile}
                      className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-[oklch(0.85_0.03_142)] bg-[oklch(0.95_0.03_142)] text-[oklch(0.3_0.12_142)] hover:bg-[oklch(0.93_0.03_142)] disabled:opacity-60"
                    >
                      设默认({item.report.best_profile})
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

                {expandedExperiment === item.filename && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="text-left text-[oklch(0.55_0_0)] border-b border-[oklch(0.92_0_0)]">
                          <th className="py-2 pr-3">Profile</th>
                          <th className="py-2 pr-3">Rounds</th>
                          <th className="py-2 pr-3">质量</th>
                          <th className="py-2 pr-3">矛盾率</th>
                          <th className="py-2 pr-3">重复率</th>
                          <th className="py-2 pr-3">Coverage</th>
                          <th className="py-2">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.report.summary_rows.map((r) => (
                          <tr key={`${item.filename}-${r.profile}`} className="border-b border-[oklch(0.95_0_0)]">
                            <td className="py-2 pr-3">{r.profile}</td>
                            <td className="py-2 pr-3">{r.totalRounds}</td>
                            <td className="py-2 pr-3">{(r.avgQuality * 100).toFixed(1)}%</td>
                            <td className="py-2 pr-3">{(r.contradictionRate * 100).toFixed(1)}%</td>
                            <td className="py-2 pr-3">{(r.duplicationRate * 100).toFixed(1)}%</td>
                            <td className="py-2 pr-3">{(r.coverage * 100).toFixed(1)}%</td>
                            <td className="py-2">
                              <button
                                onClick={() => setAsDefaultTrainingProfile(r.profile)}
                                disabled={savingProfile === r.profile}
                                className="text-[12px] px-2 py-1 rounded-md border border-[oklch(0.9_0_0)] hover:bg-[oklch(0.97_0_0)] disabled:opacity-60"
                              >
                                设为默认
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
