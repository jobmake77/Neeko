'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AtSign, FileArchive, FileText, Video, ArrowRight, ArrowLeft, Check, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type BuildStatus = 'idle' | 'running' | 'success' | 'error';
type CultivationMode = 'quick' | 'full';
type InputType = 'account' | 'text' | 'media' | 'archive';
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
  skill_expand: 'Skill 证据融合',
  skill_merge: 'Skill 蒸馏入库',
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
  const [step, setStep] = useState<1 | 2>(1);
  const mode = 'single';
  const [inputType, setInputType] = useState<InputType>('account');
  const [handle, setHandle] = useState('');
  const [sourceLink, setSourceLink] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [sourceFileName, setSourceFileName] = useState('');
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

    const params = new URLSearchParams({ mode });
    params.set('inputType', inputType);
    if (inputType === 'account') {
      params.set('handle', handle.replace(/^@/, ''));
    } else {
      if (sourceLink.trim()) params.set('source', sourceLink.trim());
      if (sourceNote.trim()) params.set('sourceNote', sourceNote.trim());
      if (sourceFileName.trim()) params.set('sourceFileName', sourceFileName.trim());
    }
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

  function currentSourceLabel(): string {
    if (inputType === 'account') return `@${handle}`;
    if (sourceFileName.trim()) return sourceFileName.trim();
    if (sourceLink.trim()) return sourceLink.trim();
    return sourceNote.trim() || '未命名素材';
  }

  function canProceed(): boolean {
    if (inputType === 'account') return handle.trim().length > 0;
    return sourceLink.trim().length > 0 || sourceNote.trim().length > 0 || sourceFileName.trim().length > 0;
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
            {currentSourceLabel()}
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
              onClick={() => { setBuildStatus('idle'); setLogs([]); setStep(2); }}
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
        {[1, 2].map((s) => (
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
              {s === 1 ? '配置来源' : '开始构建'}
            </span>
            {s < 2 && <div className="w-8 h-px bg-[oklch(0.88_0_0)]" />}
          </div>
        ))}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <div className="space-y-5">
          <p className="text-[14px] text-[oklch(0.4_0_0)] font-medium">单人蒸馏（Path A）</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setInputType('account')}
              className={cn(
                'w-full text-left p-4 rounded-xl border transition-all',
                inputType === 'account'
                  ? 'border-[oklch(0.72_0.18_142)] bg-[oklch(0.97_0.02_142)]'
                  : 'border-[oklch(0.9_0_0)] bg-white hover:border-[oklch(0.8_0.05_142)]'
              )}
            >
              <p className="text-[13px] font-medium flex items-center gap-2"><AtSign className="w-4 h-4" />账号</p>
              <p className="text-[12px] text-[oklch(0.58_0_0)] mt-1">X/Twitter 账号</p>
            </button>
            <button
              onClick={() => setInputType('text')}
              className={cn(
                'w-full text-left p-4 rounded-xl border transition-all',
                inputType === 'text'
                  ? 'border-[oklch(0.72_0.18_142)] bg-[oklch(0.97_0.02_142)]'
                  : 'border-[oklch(0.9_0_0)] bg-white hover:border-[oklch(0.8_0.05_142)]'
              )}
            >
              <p className="text-[13px] font-medium flex items-center gap-2"><FileText className="w-4 h-4" />文本</p>
              <p className="text-[12px] text-[oklch(0.58_0_0)] mt-1">文章/长文链接</p>
            </button>
            <button
              onClick={() => setInputType('media')}
              className={cn(
                'w-full text-left p-4 rounded-xl border transition-all',
                inputType === 'media'
                  ? 'border-[oklch(0.72_0.18_142)] bg-[oklch(0.97_0.02_142)]'
                  : 'border-[oklch(0.9_0_0)] bg-white hover:border-[oklch(0.8_0.05_142)]'
              )}
            >
              <p className="text-[13px] font-medium flex items-center gap-2"><Video className="w-4 h-4" />影音</p>
              <p className="text-[12px] text-[oklch(0.58_0_0)] mt-1">视频/播客链接</p>
            </button>
            <button
              onClick={() => setInputType('archive')}
              className={cn(
                'w-full text-left p-4 rounded-xl border transition-all',
                inputType === 'archive'
                  ? 'border-[oklch(0.72_0.18_142)] bg-[oklch(0.97_0.02_142)]'
                  : 'border-[oklch(0.9_0_0)] bg-white hover:border-[oklch(0.8_0.05_142)]'
              )}
            >
              <p className="text-[13px] font-medium flex items-center gap-2"><FileArchive className="w-4 h-4" />压缩包</p>
              <p className="text-[12px] text-[oklch(0.58_0_0)] mt-1">素材包链接/标识</p>
            </button>
          </div>

          {inputType === 'account' && (
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
                通过 <code className="bg-[oklch(0.93_0_0)] px-1 rounded">opencli</code> 抓取公开内容。
              </p>
            </div>
          )}
          {inputType !== 'account' && (
            <>
              <div>
                <label className="block text-[14px] font-medium text-[oklch(0.3_0_0)] mb-2">
                  素材链接
                </label>
                <input
                  value={sourceLink}
                  onChange={(e) => setSourceLink(e.target.value)}
                  placeholder={inputType === 'archive' ? 'https://.../material.zip' : 'https://...'}
                  className="w-full px-4 py-3 bg-white border border-[oklch(0.88_0_0)] rounded-xl text-[15px] outline-none focus:ring-2 focus:ring-[oklch(0.72_0.18_142)] transition-all"
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-[oklch(0.3_0_0)] mb-2">
                  素材说明（可选）
                </label>
                <textarea
                  value={sourceNote}
                  onChange={(e) => setSourceNote(e.target.value)}
                  placeholder="例如：访谈合集、公开视频转写、推文导出包..."
                  rows={3}
                  className="w-full px-4 py-3 bg-white border border-[oklch(0.88_0_0)] rounded-xl text-[14px] outline-none focus:ring-2 focus:ring-[oklch(0.72_0.18_142)] transition-all resize-none"
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-[oklch(0.3_0_0)] mb-2">
                  压缩包文件名（可选）
                </label>
                <input
                  value={sourceFileName}
                  onChange={(e) => setSourceFileName(e.target.value)}
                  placeholder="materials.zip"
                  className="w-full px-4 py-3 bg-white border border-[oklch(0.88_0_0)] rounded-xl text-[15px] outline-none focus:ring-2 focus:ring-[oklch(0.72_0.18_142)] transition-all"
                />
              </div>
            </>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setStep(2)}
              disabled={!canProceed()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[oklch(0.15_0_0)] text-white text-[13.5px] font-medium hover:bg-[oklch(0.25_0_0)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一步 <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3 */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-[oklch(0.91_0_0)] p-5 space-y-3">
            <p className="text-[13px] font-medium text-[oklch(0.4_0_0)]">构建配置</p>
            <div className="space-y-2 text-[14px]">
              <div className="flex justify-between">
                <span className="text-[oklch(0.6_0_0)]">模式</span>
                <span className="font-medium">单人蒸馏</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[oklch(0.6_0_0)]">输入类型</span>
                <span className="font-medium">
                  {inputType === 'account' ? '账号' : inputType === 'text' ? '文本' : inputType === 'media' ? '影音' : '压缩包'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[oklch(0.6_0_0)]">素材</span>
                <span className="font-medium text-right break-all">{currentSourceLabel()}</span>
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
              onClick={() => setStep(1)}
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
