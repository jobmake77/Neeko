'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AtSign, Lightbulb, ArrowRight, ArrowLeft, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type Mode = 'single' | 'fusion' | null;

export default function CreatePage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<Mode>(null);
  const [handle, setHandle] = useState('');
  const [skill, setSkill] = useState('');
  const [loading, setLoading] = useState(false);

  function handleCreate() {
    setLoading(true);
    // 实际会调用后端 API；这里先 mock 跳回首页
    setTimeout(() => {
      setLoading(false);
      router.push('/');
    }, 2000);
  }

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
            <div
              className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold transition-colors',
                step > s
                  ? 'bg-[oklch(0.72_0.18_142)] text-white'
                  : step === s
                  ? 'bg-[oklch(0.15_0_0)] text-white'
                  : 'bg-[oklch(0.92_0_0)] text-[oklch(0.55_0_0)]'
              )}
            >
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

      {/* Step 1: 选择模式 */}
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

      {/* Step 2: 配置来源 */}
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
                通过 <code className="bg-[oklch(0.93_0_0)] px-1 rounded">opencli</code> 复用 Chrome 登录状态抓取推文，无需 API Key。
                请确保 Chrome 已登录 X.com。
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

      {/* Step 3: 确认并开始 */}
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
                <span className="font-medium text-[oklch(0.4_0.1_142)]">~$2–5</span>
              </div>
            </div>
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
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[oklch(0.72_0.18_142)] text-white text-[13.5px] font-medium hover:bg-[oklch(0.62_0.18_142)] transition-colors disabled:opacity-70"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 构建中...</>
              ) : (
                <>开始构建 <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
