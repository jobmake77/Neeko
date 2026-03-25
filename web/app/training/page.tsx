import { Dumbbell, TrendingUp, Clock, CheckCircle2, Circle } from 'lucide-react';

export default function TrainingPage() {
  return (
    <div className="p-8 max-w-[1200px]">
      {/* Header */}
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-[oklch(0.15_0_0)]">培养中心</h1>
      </div>
      <p className="text-[14px] text-[oklch(0.55_0_0)] mb-8">
        管理 Persona 的训练进度，查看每轮培养的质量变化。
      </p>

      {/* 空状态 */}
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[oklch(0.94_0.05_142)] flex items-center justify-center mb-5">
          <Dumbbell className="w-8 h-8 text-[oklch(0.4_0.15_142)]" />
        </div>
        <p className="text-[16px] font-semibold text-[oklch(0.25_0_0)]">暂无培养任务</p>
        <p className="text-[13px] text-[oklch(0.6_0_0)] mt-2 max-w-[300px]">
          创建 Persona 后，培养进度会在这里实时显示
        </p>

        {/* 流程说明 */}
        <div className="mt-10 text-left space-y-3 w-[320px]">
          {[
            { label: '数据采集', desc: '从公开内容获取原始语料', done: false },
            { label: 'Soul 提炼', desc: '提取 5 个维度的人格特征', done: false },
            { label: 'Memory 构建', desc: '将知识写入向量记忆库', done: false },
            { label: '培养循环', desc: 'Trainer → Persona → Evaluator → Director', done: false },
            { label: '收敛导出', desc: '置信度 > 80% 后就绪', done: false },
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="mt-0.5 text-[oklch(0.75_0_0)]">
                <Circle className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[13.5px] font-medium text-[oklch(0.3_0_0)]">{step.label}</p>
                <p className="text-[12px] text-[oklch(0.6_0_0)]">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
