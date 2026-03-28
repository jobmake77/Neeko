'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

interface SkillEvidence {
  quote: string;
  source: string;
}

interface OriginSkill {
  id: string;
  name: string;
  why: string;
  how: string;
  confidence: number;
  evidence: SkillEvidence[];
}

interface ExpandedSkill {
  id: string;
  origin_id: string;
  name: string;
  similarity: number;
  source_platform: string;
  source_ref: string;
  transferable_summary: string;
  confidence: number;
}

interface SkillCluster {
  origin_id: string;
  expanded_ids: string[];
}

interface SkillLibraryResponse {
  persona_slug: string;
  updated_at: string | null;
  origin_skills: OriginSkill[];
  expanded_skills: ExpandedSkill[];
  clusters: SkillCluster[];
  coverage_by_origin?: Array<{
    origin_id: string;
    origin_name: string;
    expanded_count: number;
    coverage_score: number;
    missing_slots: number;
  }>;
}

interface TrainingSummary {
  total_rounds: number;
  summary: {
    avg_quality_score?: number;
    skill_coverage_score?: number;
    origin_skills_added?: number;
    expanded_skills_added?: number;
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

  const expandedByOrigin = useMemo(() => {
    const map = new Map<string, ExpandedSkill[]>();
    for (const item of data?.expanded_skills ?? []) {
      const list = map.get(item.origin_id) ?? [];
      list.push(item);
      map.set(item.origin_id, list);
    }
    return map;
  }, [data]);

  async function refreshSkills() {
    setRefreshing(true);
    setMessage('');
    try {
      const res = await fetch(`/api/skills/${slug}/refresh`, { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.reason ?? 'refresh_failed');
      setMessage(payload?.status === 'already_running' ? '已有刷新任务在运行' : '已加入刷新队列');
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
          <p className="text-[13px] text-[oklch(0.55_0_0)] mt-1">
            Persona: {slug}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshSkills}
            disabled={refreshing}
            className="px-4 py-2 rounded-xl bg-[oklch(0.72_0.18_142)] text-white text-[13px] font-medium disabled:opacity-70"
          >
            {refreshing ? '刷新中...' : '刷新 Skill 库'}
          </button>
          <Link
            href="/"
            className="px-4 py-2 rounded-xl border border-[oklch(0.88_0_0)] text-[13px] text-[oklch(0.35_0_0)]"
          >
            返回首页
          </Link>
        </div>
      </div>

      {message && <p className="mt-3 text-[12px] text-[oklch(0.45_0.1_240)]">{message}</p>}

      {loading && (
        <div className="mt-8 text-[13px] text-[oklch(0.55_0_0)]">加载中...</div>
      )}

      {!loading && !data && (
        <div className="mt-8 text-[13px] text-red-500">读取 Skill 库失败</div>
      )}

      {!loading && data && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-4 text-[13px] text-[oklch(0.35_0_0)]">
            原点 {data.origin_skills.length} · 扩展 {data.expanded_skills.length} · 最近更新{' '}
            {data.updated_at ? new Date(data.updated_at).toLocaleString('zh-CN', { hour12: false }) : '未生成'}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-[oklch(0.9_0_0)] bg-[oklch(0.985_0_0)] p-4">
              <p className="text-[12px] text-[oklch(0.58_0_0)]">累计训练轮次</p>
              <p className="mt-1 text-[16px] font-semibold text-[oklch(0.2_0_0)]">{training?.total_rounds ?? '-'}</p>
            </div>
            <div className="rounded-2xl border border-[oklch(0.9_0_0)] bg-[oklch(0.985_0_0)] p-4">
              <p className="text-[12px] text-[oklch(0.58_0_0)]">Skill 覆盖分</p>
              <p className="mt-1 text-[16px] font-semibold text-[oklch(0.2_0_0)]">
                {typeof training?.summary?.skill_coverage_score === 'number'
                  ? `${(training.summary.skill_coverage_score * 100).toFixed(1)}%`
                  : '-'}
              </p>
            </div>
            <div className="rounded-2xl border border-[oklch(0.9_0_0)] bg-[oklch(0.985_0_0)] p-4">
              <p className="text-[12px] text-[oklch(0.58_0_0)]">训练平均质量</p>
              <p className="mt-1 text-[16px] font-semibold text-[oklch(0.2_0_0)]">
                {typeof training?.summary?.avg_quality_score === 'number'
                  ? `${(training.summary.avg_quality_score * 100).toFixed(1)}%`
                  : '-'}
              </p>
            </div>
          </div>
          {(data.coverage_by_origin?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-4">
              <p className="text-[13px] font-medium text-[oklch(0.25_0_0)]">原点覆盖缺口（优先补齐）</p>
              <div className="mt-3 space-y-2">
                {data.coverage_by_origin?.slice(0, 5).map((item) => (
                  <div key={item.origin_id} className="rounded-lg border border-[oklch(0.92_0_0)] bg-[oklch(0.985_0_0)] px-3 py-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[12.5px] font-medium text-[oklch(0.25_0_0)]">{item.origin_name}</p>
                      <p className="text-[11px] text-[oklch(0.58_0_0)]">
                        {item.expanded_count}/3 · {(item.coverage_score * 100).toFixed(0)}%
                      </p>
                    </div>
                    <p className="mt-1 text-[11.5px] text-[oklch(0.55_0_0)]">
                      待补扩展位：{item.missing_slots}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.origin_skills.length === 0 && (
            <div className="rounded-2xl border border-[oklch(0.9_0_0)] bg-[oklch(0.985_0_0)] p-4 text-[13px] text-[oklch(0.5_0_0)]">
              暂无原点 skill。可先进行一次培养，或点击“刷新 Skill 库”重建。
            </div>
          )}

          {data.origin_skills.map((origin) => {
            const linked = expandedByOrigin.get(origin.id) ?? [];
            return (
              <div key={origin.id} className="rounded-2xl border border-[oklch(0.9_0_0)] bg-white p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-[15px] font-semibold text-[oklch(0.2_0_0)]">{origin.name}</h2>
                  <span className="text-[11px] text-[oklch(0.55_0_0)]">
                    置信度 {(origin.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-2 text-[13px] text-[oklch(0.35_0_0)]"><span className="font-medium">WHY:</span> {origin.why}</p>
                <p className="mt-1 text-[13px] text-[oklch(0.35_0_0)]"><span className="font-medium">HOW:</span> {origin.how}</p>
                <p className="mt-2 text-[12px] text-[oklch(0.55_0_0)]">证据 {origin.evidence.length} 条</p>

                <div className="mt-3 space-y-2">
                  {linked.slice(0, 3).map((item) => (
                    <div key={item.id} className="rounded-xl border border-[oklch(0.9_0_0)] bg-[oklch(0.985_0_0)] p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[13px] font-medium text-[oklch(0.25_0_0)]">{item.name}</p>
                        <p className="text-[11px] text-[oklch(0.55_0_0)]">
                          sim {(item.similarity * 100).toFixed(0)}% · conf {(item.confidence * 100).toFixed(0)}%
                        </p>
                      </div>
                      <p className="mt-1 text-[12px] text-[oklch(0.4_0_0)]">{item.transferable_summary}</p>
                      <p className="mt-1 text-[11px] text-[oklch(0.58_0_0)]">
                        来源：{item.source_platform} · {item.source_ref}
                      </p>
                    </div>
                  ))}
                  {linked.length === 0 && (
                    <p className="text-[12px] text-[oklch(0.55_0_0)]">暂无扩展 skill</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
