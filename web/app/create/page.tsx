'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AtSign, Lightbulb, ArrowRight, ArrowLeft, Check, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Mode = 'single' | 'fusion' | null;
type BuildStatus = 'idle' | 'running' | 'success' | 'error';
type CultivationMode = 'quick' | 'full';
type BuildProgress = {
  stage: string;
  stageLabel: string;
  percent: number;
  currentRound: number;
  totalRounds: number;
  elapsedSec: number;
  etaMin: number;
  etaMax: number;
};

const BUILD_STAGE_ORDER = [
  'init',
  'ingestion',
  'preprocess',
  'soul',
  'skill_origin_extract',
  'skill_expand',
  'skill_merge',
  'training',
  'finalize',
  'done',
] as const;
const BUILD_STAGE_LABEL: Record<string, string> = {
  init: '初始化任务',
  ingestion: '采集数据源',
  preprocess: '清洗与切片',
  soul: '提炼 Soul',
  skill_origin_extract: 'Skill 原点提炼',
  skill_expand: 'Skill 相似扩展',
  skill_merge: 'Skill 融合入库',
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

export default function CreatePage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<Mode>(null);
  const [handle, setHandle] = useState('');
  const [skill, setSkill] = useState('');
  const [cultivationMode, setCultivationMode] = useState<CultivationMode>('quick');

  // Build state
  const [buildStatus, setBuildStatus] = useState<BuildStatus>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<BuildProgress>({
    stage: 'init',
    stageLabel: BUILD_STAGE_LABEL.init,
    percent: 0,
    currentRound: 0,
    totalRounds: cultivationMode === 'quick' ? 3 : 10,
    elapsedSec: 0,
    etaMin: 15,
    etaMax: 30,
  });
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  function handleCreate() {
    setBuildStatus('running');
    setLogs([]);
    setProgress({
      stage: 'init',
      stageLabel: BUILD_STAGE_LABEL.init,
      percent: 0,
      currentRound: 0,
      totalRounds: cultivationMode === 'quick' ? 3 : 10,
      elapsedSec: 0,
      etaMin: cultivationMode === 'quick' ? 15 : 30,
      etaMax: cultivationMode === 'quick' ? 30 : 90,
    });

    const params = new URLSearchParams({ mode: mode! });
    if (mode === 'single') params.set('handle', handle.replace(/^@/, ''));
    else params.set('skill', skill);
    params.set('rounds', cultivationMode === 'quick' ? '3' : '10');
    params.set('trainingProfile', 'full');

    const es = new EventSource(`/api/create?${params}`);

    es.onmessage = (e) => {
      const { line } = JSON.parse(e.data);
      setLogs((prev) => [...prev, line]);
    };
    es.addEventListener('progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as BuildProgress;
      setProgress((prev) => ({ ...prev, ...data }));
    });

    es.addEventListener('done', (e) => {
      const { success } = JSON.parse((e as MessageEvent).data);
      if (success) {
        setProgress((prev) => ({
          ...prev,
          stage: 'done',
          stageLabel: BUILD_STAGE_LABEL.done,
          percent: 100,
          currentRound: prev.totalRounds,
          etaMin: 0,
          etaMax: 0,
        }));
      }
      setBuildStatus(success ? 'success' : 'error');
      es.close();
    });

    es.onerror = () => {
      setLogs((prev) => [...prev, '连接中断，请检查服务是否正常运行。']);
      setBuildStatus('error');
      es.close();
    };
  }

  // ── Building view ─────────────────────────────────────────────────────────
  if (buildStatus !== 'idle') {
    return (
      <div className="p-8 max-w-[700px]">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[oklch(0.15_0_0)]">
            {buildStatus === 'running' && '构建中…'}
            {buildStatus === 'success' && 'Persona 已就绪'}
            {buildStatus === 'error' && '构建失败'}
          </h1>
          <p className="text-[14px] text-[oklch(0.55_0_0)] mt-1">
            {mode === 'single' ? `@${handle}` : skill}
          </p>
        </div>

        {/* Status badge */}
        <div className={cn(
          'flex items-center gap-2 px-4 py-2.5 rounded-xl mb-5 text-[13.5px] font-medium w-fit',
          buildStatus === 'running' && 'bg-[oklch(0.95_0.02_240)] text-[oklch(0.35_0.1_240)]',
          buildStatus === 'success' && 'bg-[oklch(0.94_0.06_142)] text-[oklch(0.3_0.15_142)]',
          buildStatus === 'error'   && 'bg-[oklch(0.96_0.04_0)] text-[oklch(0.45_0.15_0)]',
        )}>
          {buildStatus === 'running' && <><Loader2 className="w-4 h-4 animate-spin" />正在执行流程…</>}
          {buildStatus === 'success' && <><CheckCircle2 className="w-4 h-4" />全部完成</>}
          {buildStatus === 'error'   && <><XCircle className="w-4 h-4" />构建出错</>}
        </div>

        <div className="mb-5 rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-4">
          <div className="flex items-center justify-between text-[12.5px]">
            <p className="font-medium text-[oklch(0.25_0_0)]">当前阶段：{progress.stageLabel}</p>
            <p className="text-[oklch(0.55_0_0)]">{Math.round(progress.percent)}%</p>
          </div>
          <div className="mt-2 h-2.5 rounded-full bg-[oklch(0.93_0_0)] overflow-hidden">
            <div
              className="h-full bg-[oklch(0.72_0.18_142)] transition-all duration-500"
              style={{ width: `${Math.max(2, progress.percent)}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
            <div className="rounded-lg bg-[oklch(0.97_0_0)] px-3 py-2">
              <p className="text-[oklch(0.55_0_0)]">已耗时</p>
              <p className="font-medium text-[oklch(0.2_0_0)]">{formatDuration(progress.elapsedSec)}</p>
            </div>
            <div className="rounded-lg bg-[oklch(0.97_0_0)] px-3 py-2">
              <p className="text-[oklch(0.55_0_0)]">预计剩余</p>
              <p className="font-medium text-[oklch(0.2_0_0)]">{progress.etaMin} - {progress.etaMax} 分钟</p>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-[oklch(0.55_0_0)]">
            当前轮次：{Math.min(progress.currentRound, progress.totalRounds)} / {progress.totalRounds}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {BUILD_STAGE_ORDER.map((key) => {
              const currentIdx = BUILD_STAGE_ORDER.indexOf(progress.stage as (typeof BUILD_STAGE_ORDER)[number]);
              const idx = BUILD_STAGE_ORDER.indexOf(key);
              const done = idx < Math.max(0, currentIdx);
              const active = key === progress.stage;
              return (
                <span
                  key={key}
                  className={cn(
                    'text-[11px] px-2 py-1 rounded-full border',
                    done && 'border-[oklch(0.82_0.06_142)] bg-[oklch(0.95_0.04_142)] text-[oklch(0.3_0.12_142)]',
                    active && 'border-[oklch(0.8_0.05_240)] bg-[oklch(0.95_0.03_240)] text-[oklch(0.32_0.1_240)]',
                    !done && !active && 'border-[oklch(0.9_0_0)] bg-[oklch(0.98_0_0)] text-[oklch(0.6_0_0)]',
                  )}
                >
                  {BUILD_STAGE_LABEL[key]}
                </span>
              );
            })}
          </div>
        </div>

        {/* Log terminal */}
        <div className="bg-[oklch(0.1_0_0)] rounded-2xl p-4 font-mono text-[12.5px] leading-relaxed h-[380px] overflow-y-auto space-y-0.5">
          {logs.length === 0 && (
            <span className="text-[oklch(0.5_0_0)]">等待输出…</span>
          )}
          {logs.map((line, i) => (
            <div key={i} className={cn(
              'text-[oklch(0.82_0_0)]',
              line.startsWith('❌') && 'text-[oklch(0.65_0.15_0)]',
              line.startsWith('✓') && 'text-[oklch(0.72_0.18_142)]',
              line.startsWith('▶') && 'text-[oklch(0.7_0.1_240)]',
            )}>
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-5">
          {buildStatus === 'success' && (
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[oklch(0.72_0.18_142)] text-white text-[13.5px] font-medium hover:bg-[oklch(0.62_0.18_142)] transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" /> 查看 Persona
            </button>
          )}
          {buildStatus === 'error' && (
            <button
              onClick={() => { setBuildStatus('idle'); setLogs([]); setStep(3); }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[oklch(0.88_0_0)] text-[13.5px] text-[oklch(0.4_0_0)] hover:bg-[oklch(0.97_0_0)] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> 返回重试
            </button>
          )}
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[oklch(0.88_0_0)] text-[13.5px] text-[oklch(0.4_0_0)] hover:bg-[oklch(0.97_0_0)] transition-colors"
          >
            回首页
          </button>
        </div>
      </div>
    );
  }

  // ── Wizard view ───────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-[700px]">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[oklch(0.15_0_0)]">新建 Persona</h1>
        <p className="text-[14px] text-[oklch(0.55_0_0)] mt-1">
          将真实人物蒸馏为可工作的 AI 数字孪生
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold transition-colors',
              step > s
                ? 'bg-[oklch(0.72_0.18_142)] text-white'
                : step === s
                ? 'bg-[oklch(0.15_0_0)] text-white'
                : 'bg-[oklch(0.92_0_0)] text-[oklch(0.55_0_0)]'
            )}>
              {step > s ? <Check className="w-3.5 h-3.5" /> : s}
            </div>
            <span className={cn(
              'text-[13px]',
              step === s ? 'text-[oklch(0.2_0_0)] font-medium' : 'text-[oklch(0.6_0_0)]'
            )}>
              {s === 1 ? '选择模式' : s === 2 ? '配置来源' : '开始构建'}
            </span>
            {s < 3 && <div className="w-8 h-px bg-[oklch(0.88_0_0)]" />}
          </div>
        ))}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-[14px] text-[oklch(0.4_0_0)] font-medium mb-4">选择创建方式</p>

          <button
            onClick={() => { setMode('single'); setStep(2); }}
            className={cn(
              'w-full text-left p-5 rounded-2xl border-2 transition-all',
              mode === 'single'
                ? 'border-[oklch(0.72_0.18_142)] bg-[oklch(0.97_0.02_142)]'
                : 'border-[oklch(0.9_0_0)] bg-white hover:border-[oklch(0.8_0.05_142)]'
            )}
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-[oklch(0.94_0.05_142)] flex items-center justify-center flex-shrink-0">
                <AtSign className="w-5 h-5 text-[oklch(0.4_0.15_142)]" />
              </div>
              <div>
                <p className="font-semibold text-[15px] text-[oklch(0.2_0_0)]">单人蒸馏 Path A</p>
                <p className="text-[13px] text-[oklch(0.55_0_0)] mt-1">
                  输入目标人物的 Twitter 账号，通过 <code className="bg-[oklch(0.93_0_0)] px-1 rounded text-[12px]">opencli</code> 复用浏览器登录状态免 API 抓取推文。
                </p>
                <p className="text-[12px] text-[oklch(0.65_0_0)] mt-2">
                  ✦ 无需 Twitter API Key · 复用 Chrome 已登录状态
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => { setMode('fusion'); setStep(2); }}
            className={cn(
              'w-full text-left p-5 rounded-2xl border-2 transition-all',
              mode === 'fusion'
                ? 'border-[oklch(0.72_0.18_142)] bg-[oklch(0.97_0.02_142)]'
                : 'border-[oklch(0.9_0_0)] bg-white hover:border-[oklch(0.8_0.05_142)]'
            )}
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-[oklch(0.94_0.08_60)] flex items-center justify-center flex-shrink-0">
                <Lightbulb className="w-5 h-5 text-[oklch(0.5_0.15_60)]" />
              </div>
              <div>
                <p className="font-semibold text-[15px] text-[oklch(0.2_0_0)]">能力融合 Path B</p>
                <p className="text-[13px] text-[oklch(0.55_0_0)] mt-1">
                  输入目标技能，AI 自动拆解能力维度并推荐多位专家数据源，融合为复合型 Persona。
                </p>
                <p className="text-[12px] text-[oklch(0.65_0_0)] mt-2">
                  适合：无明确标杆、需要组合多方经验的场景
                </p>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div className="space-y-5">
          {mode === 'single' ? (
            <div>
              <label className="block text-[14px] font-medium text-[oklch(0.3_0_0)] mb-2">
                Twitter / X 账号
              </label>
              <div className="flex items-center gap-0 bg-white border border-[oklch(0.88_0_0)] rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-[oklch(0.72_0.18_142)]">
                <span className="px-4 text-[oklch(0.6_0_0)] text-[15px]">@</span>
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="elonmusk"
                  className="flex-1 py-3 pr-4 text-[15px] bg-transparent outline-none"
                />
              </div>
              <p className="text-[12px] text-[oklch(0.65_0_0)] mt-2">
                通过 <code className="bg-[oklch(0.93_0_0)] px-1 rounded">opencli</code> 复用 Chrome 登录状态抓取推文，无需 API Key。请确保 Chrome 已登录 X.com。
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-[14px] font-medium text-[oklch(0.3_0_0)] mb-2">
                目标技能或角色
              </label>
              <input
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
                placeholder="例如：全栈工程师、产品经理、股票分析师..."
                className="w-full px-4 py-3 bg-white border border-[oklch(0.88_0_0)] rounded-xl text-[15px] outline-none focus:ring-2 focus:ring-[oklch(0.72_0.18_142)] transition-all"
              />
              <p className="text-[12px] text-[oklch(0.65_0_0)] mt-2">
                AI 会自动拆解能力维度并推荐数据源供你确认
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[oklch(0.88_0_0)] text-[13.5px] text-[oklch(0.4_0_0)] hover:bg-[oklch(0.97_0_0)] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> 返回
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={mode === 'single' ? !handle.trim() : !skill.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[oklch(0.15_0_0)] text-white text-[13.5px] font-medium hover:bg-[oklch(0.25_0_0)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一步 <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-[oklch(0.91_0_0)] p-5 space-y-3">
            <p className="text-[13px] font-medium text-[oklch(0.4_0_0)]">构建配置</p>
            <div className="space-y-2 text-[14px]">
              <div className="flex justify-between">
                <span className="text-[oklch(0.6_0_0)]">模式</span>
                <span className="font-medium">{mode === 'single' ? '单人蒸馏' : '能力融合'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[oklch(0.6_0_0)]">{mode === 'single' ? '目标账号' : '目标技能'}</span>
                <span className="font-medium">{mode === 'single' ? `@${handle}` : skill}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[oklch(0.6_0_0)]">预计花费</span>
                <span className="font-medium text-[oklch(0.4_0.1_142)]">
                  {cultivationMode === 'quick' ? '~$0.5–1.5' : '~$2–5'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[oklch(0.91_0_0)] p-5">
            <p className="text-[13px] font-medium text-[oklch(0.4_0_0)] mb-3">培养模式</p>
            <div className="flex gap-2">
              <button
                onClick={() => setCultivationMode('quick')}
                className={cn(
                  'px-4 py-2 rounded-lg text-[13px] border transition-colors',
                  cultivationMode === 'quick'
                    ? 'bg-[oklch(0.95_0.03_142)] text-[oklch(0.3_0.12_142)] border-[oklch(0.85_0.03_142)]'
                    : 'bg-white border-[oklch(0.9_0_0)] text-[oklch(0.45_0_0)] hover:bg-[oklch(0.97_0_0)]'
                )}
              >
                快速培养（3 轮）
              </button>
              <button
                onClick={() => setCultivationMode('full')}
                className={cn(
                  'px-4 py-2 rounded-lg text-[13px] border transition-colors',
                  cultivationMode === 'full'
                    ? 'bg-[oklch(0.95_0.03_142)] text-[oklch(0.3_0.12_142)] border-[oklch(0.85_0.03_142)]'
                    : 'bg-white border-[oklch(0.9_0_0)] text-[oklch(0.45_0_0)] hover:bg-[oklch(0.97_0_0)]'
                )}
              >
                全量培养（10 轮）
              </button>
            </div>
            <p className="text-[12px] text-[oklch(0.58_0_0)] mt-2">
              快速培养完成后，可在培养中心继续培养。
            </p>
          </div>

          <div className="bg-[oklch(0.97_0.02_60)] rounded-xl p-4 text-[13px] text-[oklch(0.45_0.08_60)]">
            ⚡ Neeko 会自动完成：数据采集 → Soul 提炼 → Memory 构建 → 培养循环 → 就绪
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[oklch(0.88_0_0)] text-[13.5px] text-[oklch(0.4_0_0)] hover:bg-[oklch(0.97_0_0)] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> 返回
            </button>
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[oklch(0.72_0.18_142)] text-white text-[13.5px] font-medium hover:bg-[oklch(0.62_0.18_142)] transition-colors"
            >
              开始构建 <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
