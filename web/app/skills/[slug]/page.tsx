'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface SkillEvidenceRef {
  source: string;
  source_platform: string;
  snippet: string;
  similarity: number;
}

interface DistilledSkill {
  id: string;
  name: string;
  central_thesis: string;
  why: string;
  how_steps: string[];
  boundaries: string[];
  trigger_signals: string[];
  anti_patterns: string[];
  evidence_refs: SkillEvidenceRef[];
  confidence: number;
  contradiction_risk: number;
  method_completeness: number;
  quality_score: number;
  coverage_tags: string[];
}

interface CandidateSkill extends DistilledSkill {
  reject_reasons: string[];
}

interface OriginSkill {
  id: string;
  name: string;
  why: string;
  how: string;
  confidence: number;
  evidence: Array<{ quote: string; source: string }>;
}

interface SkillLibraryResponse {
  persona_slug: string;
  updated_at: string | null;
  origin_skills: OriginSkill[];
  distilled_skills: DistilledSkill[];
  candidate_skill_pool: CandidateSkill[];
  coverage_by_origin?: Array<{
    origin_id: string;
    origin_name: string;
    expanded_count: number;
    coverage_score: number;
    missing_slots: number;
  }>;
  quality_summary?: {
    accepted_rate: number;
    avg_quality_score: number;
  };
}

interface TrainingSummary {
  total_rounds: number;
  summary: {
    avg_quality_score?: number;
    skill_coverage_score?: number;
    origin_skills_added?: number;
    distilled_skills_added?: number;
    skill_trigger_precision?: number;
    skill_method_adherence?: number;
  };
}

export default function SkillsPage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params?.slug ?? '');
  const [data, setData] = useState<SkillLibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [training, setTraining] = useState<TrainingSummary | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/skills/${slug}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('load_failed');
      setData(await res.json());
      const trainRes = await fetch(`/api/training/${slug}`, { cache: 'no-store' });
      if (trainRes.ok) {
        const trainPayload = await trainRes.json();
        if (trainPayload?.report) {
          setTraining({
            total_rounds: Number(trainPayload.report.total_rounds ?? 0),
            summary: trainPayload.report.summary ?? {},
          });
        } else {
          setTraining(null);
        }
      } else {
        setTraining(null);
      }
    } catch {
      setData(null);
      setTraining(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    void loadData();
  }, [slug, loadData]);

  async function refreshSkills(mode: 'quick' | 'full') {
    setRefreshing(true);
    setMessage('');
    try {
      const res = await fetch(`/api/skills/${slug}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.reason ?? 'refresh_failed');
      setMessage(payload?.status === 'already_running' ? '已有刷新任务在运行' : `已加入 ${mode} 刷新队列`);
      setTimeout(() => void loadData(), 2500);
    } catch {
      setMessage('刷新触发失败，请稍后重试');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="p-8 max-w-[980px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[oklch(0.15_0_0)]">Skill 库</h1>
          <p className="text-[13px] text-[oklch(0.55_0_0)] mt-1">Persona: {slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshSkills('quick')}
            disabled={refreshing}
            className="px-4 py-2 rounded-xl bg-[oklch(0.72_0.18_142)] text-white text-[13px] font-medium disabled:opacity-70"
          >
            {refreshing ? '刷新中...' : '快速刷新'}
          </button>
          <button
            onClick={() => refreshSkills('full')}
            disabled={refreshing}
            className="px-4 py-2 rounded-xl border border-[oklch(0.85_0_0)] text-[13px] text-[oklch(0.35_0_0)] disabled:opacity-70"
          >
            全量刷新
          </button>
          <Link href="/" className="px-4 py-2 rounded-xl border border-[oklch(0.88_0_0)] text-[13px] text-[oklch(0.35_0_0)]">
            返回首页
          </Link>
        </div>
      </div>

      {message && <p className="mt-3 text-[12px] text-[oklch(0.45_0.1_240)]">{message}</p>}
      {loading && <div className="mt-8 text-[13px] text-[oklch(0.55_0_0)]">加载中...</div>}
      {!loading && !data && <div className="mt-8 text-[13px] text-red-500">读取 Skill 库失败</div>}

      {!loading && data && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-4 text-[13px] text-[oklch(0.35_0_0)]">
            原点 {data.origin_skills.length} · 蒸馏 {data.distilled_skills.length} · 候选 {data.candidate_skill_pool.length} · 最近更新{' '}
            {data.updated_at ? new Date(data.updated_at).toLocaleString('zh-CN', { hour12: false }) : '未生成'}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <StatBox label="累计训练轮次" value={String(training?.total_rounds ?? '-')} />
            <StatBox
              label="Skill 覆盖分"
              value={typeof training?.summary?.skill_coverage_score === 'number' ? `${(training.summary.skill_coverage_score * 100).toFixed(1)}%` : '-'}
            />
            <StatBox
              label="Skill 触发精度"
              value={typeof training?.summary?.skill_trigger_precision === 'number' ? `${(training.summary.skill_trigger_precision * 100).toFixed(1)}%` : '-'}
            />
            <StatBox
              label="方法遵循度"
              value={typeof training?.summary?.skill_method_adherence === 'number' ? `${(training.summary.skill_method_adherence * 100).toFixed(1)}%` : '-'}
            />
          </div>

          <div className="rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-4">
            <p className="text-[13px] font-medium text-[oklch(0.25_0_0)]">质量门控总览</p>
            <p className="mt-2 text-[12px] text-[oklch(0.55_0_0)]">
              入库率：{typeof data.quality_summary?.accepted_rate === 'number' ? `${(data.quality_summary.accepted_rate * 100).toFixed(1)}%` : '-'} ·
              平均质量分：{typeof data.quality_summary?.avg_quality_score === 'number' ? `${(data.quality_summary.avg_quality_score * 100).toFixed(1)}%` : '-'}
            </p>
          </div>

          {data.distilled_skills.length === 0 && (
            <div className="rounded-2xl border border-[oklch(0.9_0_0)] bg-[oklch(0.985_0_0)] p-4 text-[13px] text-[oklch(0.5_0_0)]">
              暂无可用蒸馏 Skill。可先进行一次培养，或刷新 Skill 库。
            </div>
          )}

          {data.distilled_skills.map((skill) => (
            <div key={skill.id} className="rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-[oklch(0.2_0_0)]">{skill.name}</h2>
                <span className="text-[11px] text-[oklch(0.55_0_0)]">
                  质 {Math.round(skill.quality_score * 100)} · 置信 {Math.round(skill.confidence * 100)}
                </span>
              </div>
              <p className="mt-2 text-[13px] text-[oklch(0.35_0_0)]"><span className="font-medium">中心思想：</span>{skill.central_thesis}</p>
              <p className="mt-1 text-[13px] text-[oklch(0.35_0_0)]"><span className="font-medium">WHY：</span>{skill.why}</p>
              <p className="mt-2 text-[12px] text-[oklch(0.25_0_0)] font-medium">HOW 步骤</p>
              <ul className="mt-1 list-disc pl-5 text-[12.5px] text-[oklch(0.35_0_0)] space-y-1">
                {skill.how_steps.slice(0, 4).map((step, idx) => <li key={idx}>{step}</li>)}
              </ul>
              <p className="mt-2 text-[12px] text-[oklch(0.25_0_0)] font-medium">触发信号</p>
              <p className="mt-1 text-[12px] text-[oklch(0.55_0_0)]">{skill.trigger_signals.slice(0, 6).join(' · ')}</p>
              <p className="mt-2 text-[12px] text-[oklch(0.25_0_0)] font-medium">边界条件</p>
              <p className="mt-1 text-[12px] text-[oklch(0.55_0_0)]">{skill.boundaries.slice(0, 4).join(' | ')}</p>
              <p className="mt-2 text-[12px] text-[oklch(0.25_0_0)] font-medium">证据片段 {skill.evidence_refs.length}</p>
              <div className="mt-2 space-y-2">
                {skill.evidence_refs.slice(0, 4).map((ev, idx) => (
                  <div key={idx} className="rounded-lg border border-[oklch(0.92_0_0)] bg-[oklch(0.985_0_0)] px-3 py-2">
                    <p className="text-[11.5px] text-[oklch(0.58_0_0)]">{ev.source_platform} · {ev.source}</p>
                    <p className="mt-1 text-[12px] text-[oklch(0.35_0_0)]">{ev.snippet}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {data.candidate_skill_pool.length > 0 && (
            <div className="rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-4">
              <p className="text-[13px] font-medium text-[oklch(0.25_0_0)]">待审候选（未达标）</p>
              <div className="mt-3 space-y-2">
                {data.candidate_skill_pool.slice(0, 6).map((item) => (
                  <div key={item.id} className="rounded-lg border border-[oklch(0.92_0_0)] bg-[oklch(0.985_0_0)] px-3 py-2">
                    <p className="text-[12px] font-medium text-[oklch(0.25_0_0)]">{item.name}</p>
                    <p className="mt-1 text-[11.5px] text-[oklch(0.58_0_0)]">{item.reject_reasons.join(' · ') || '待验证'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[oklch(0.9_0_0)] bg-[oklch(0.985_0_0)] p-4">
      <p className="text-[12px] text-[oklch(0.58_0_0)]">{label}</p>
      <p className="mt-1 text-[16px] font-semibold text-[oklch(0.2_0_0)]">{value}</p>
    </div>
  );
}
