'use client';

import Link from 'next/link';
import { MessageSquare, MoreHorizontal, TrendingUp, TrendingDown } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

interface PersonaCardProps {
  persona: {
    id: string;
    name: string;
    slug: string;
    mode: 'single' | 'fusion';
    status: string;
    training_rounds: number;
    memory_node_count: number;
    doc_count: number;
    runtime_progress?: {
      stage: string;
      stageLabel: string;
      percent: number;
      currentRound: number;
      totalRounds: number;
      elapsedSec: number;
      etaMin: number;
      etaMax: number;
      updatedAt: string;
    } | null;
    skill_summary?: {
      origin_count: number;
      expanded_count: number;
      updated_at: string | null;
      coverage_score: number | null;
      gap_focused_questions_ratio: number | null;
      gap_focused_trend_delta: number | null;
    } | null;
  };
  onDelete?: (slug: string) => void;
}

// 根据 slug 生成一个稳定的柔和背景色
function getAvatarColor(slug: string): string {
  const colors = [
    'oklch(0.88 0.08 0)',     // 粉红
    'oklch(0.88 0.08 142)',   // 绿色
    'oklch(0.88 0.08 60)',    // 黄色
    'oklch(0.88 0.08 270)',   // 紫色
    'oklch(0.88 0.08 200)',   // 蓝色
    'oklch(0.88 0.08 30)',    // 橙色
  ];
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffff;
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function PersonaCard({ persona, onDelete }: PersonaCardProps) {
  const avatarColor = getAvatarColor(persona.slug);
  const initials = getInitials(persona.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  function handleExportOpenClaw() {
    console.log('导出为 OpenClaw', persona.slug);
    setMenuOpen(false);
  }

  function handleExportLobeChat() {
    console.log('导出为 LobeChat', persona.slug);
    setMenuOpen(false);
  }

  async function handleDelete() {
    if (!window.confirm(`确认删除 ${persona.name}？此操作不可恢复。`)) return;
    setMenuOpen(false);
    await fetch(`/api/personas/${persona.slug}`, { method: 'DELETE' });
    onDelete?.(persona.slug);
  }

  const skillSummary = persona.skill_summary ?? {
    origin_count: 0,
    expanded_count: 0,
    updated_at: null,
    coverage_score: null,
    gap_focused_questions_ratio: null,
    gap_focused_trend_delta: null,
  };
  const updatedText = skillSummary.updated_at
    ? new Date(skillSummary.updated_at).toLocaleString('zh-CN', { hour12: false })
    : '未生成';

  return (
    <div className="bg-white rounded-2xl border border-[oklch(0.91_0.002_90)] p-5 flex flex-col gap-4 hover:shadow-md transition-shadow relative">
      {/* ⋯ menu */}
      <div ref={menuRef} className="absolute top-3 right-3">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-[oklch(0.6_0_0)] hover:bg-[oklch(0.95_0_0)] hover:text-[oklch(0.3_0_0)] transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div className="absolute top-8 right-0 z-10 w-44 bg-white rounded-xl border border-[oklch(0.91_0_0)] shadow-lg py-1 text-[13px]">
            <button
              onClick={handleExportOpenClaw}
              className="w-full text-left px-4 py-2 hover:bg-[oklch(0.97_0_0)] text-[oklch(0.25_0_0)] transition-colors"
            >
              导出为 OpenClaw
            </button>
            <button
              onClick={handleExportLobeChat}
              className="w-full text-left px-4 py-2 hover:bg-[oklch(0.97_0_0)] text-[oklch(0.25_0_0)] transition-colors"
            >
              导出为 LobeChat
            </button>
            <div className="border-t border-[oklch(0.93_0_0)] my-1" />
            <button
              onClick={handleDelete}
              className="w-full text-left px-4 py-2 hover:bg-[oklch(0.98_0.02_0)] text-red-500 transition-colors"
            >
              删除 Persona
            </button>
          </div>
        )}
      </div>

      {/* Avatar */}
      <div className="flex justify-center pt-2">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold text-[oklch(0.35_0_0)]"
          style={{ background: avatarColor }}
        >
          {initials}
        </div>
      </div>

      {/* Info */}
      <div className="text-center">
        <h3 className="font-semibold text-[15px] text-[oklch(0.15_0_0)]">{persona.name}</h3>
        <p className="text-[12px] text-[oklch(0.55_0_0)] mt-1 line-clamp-2">
          {persona.mode === 'single' ? '单人蒸馏' : '多人融合'} · {persona.doc_count} 条内容 · {persona.memory_node_count} 个记忆节点
        </p>
      </div>

      <div className="rounded-xl border border-[oklch(0.9_0_0)] bg-[oklch(0.985_0_0)] p-2.5">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium text-[oklch(0.25_0_0)]">Skills</p>
          <Link
            href={`/skills/${persona.slug}`}
            className="text-[11px] text-[oklch(0.35_0.1_240)] hover:text-[oklch(0.3_0.15_240)]"
          >
            查看详情
          </Link>
        </div>
        <p className="mt-1 text-[11.5px] text-[oklch(0.55_0_0)]">
          原点 {skillSummary.origin_count} · 扩展 {skillSummary.expanded_count}
        </p>
        <p className="mt-0.5 text-[11px] text-[oklch(0.58_0_0)]">
          覆盖分：{typeof skillSummary.coverage_score === 'number' ? `${(skillSummary.coverage_score * 100).toFixed(1)}%` : '未计算'}
        </p>
        <p className="mt-0.5 text-[11px] text-[oklch(0.58_0_0)]">
          缺口聚焦题：{typeof skillSummary.gap_focused_questions_ratio === 'number' ? `${(skillSummary.gap_focused_questions_ratio * 100).toFixed(1)}%` : '未统计'}
        </p>
        {typeof skillSummary.gap_focused_trend_delta === 'number' && (
          <p className="mt-0.5 text-[11px] flex items-center gap-1">
            {skillSummary.gap_focused_trend_delta >= 0 ? (
              <TrendingUp className="w-3 h-3 text-[oklch(0.35_0.12_142)]" />
            ) : (
              <TrendingDown className="w-3 h-3 text-[oklch(0.5_0.12_40)]" />
            )}
            <span className={skillSummary.gap_focused_trend_delta >= 0 ? 'text-[oklch(0.35_0.12_142)]' : 'text-[oklch(0.5_0.12_40)]'}>
              {skillSummary.gap_focused_trend_delta >= 0 ? '+' : ''}
              {(skillSummary.gap_focused_trend_delta * 100).toFixed(1)}%
            </span>
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-[oklch(0.6_0_0)]">
          最近更新：{updatedText}
        </p>
      </div>

      {persona.runtime_progress && persona.status !== 'converged' && (
        <div className="rounded-xl border border-[oklch(0.9_0_0)] bg-[oklch(0.985_0_0)] p-2.5">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-[oklch(0.35_0.1_240)] font-medium">
              {persona.status === 'stalled'
                ? '疑似卡住'
                : persona.status === 'recovering'
                ? '自动恢复中'
                : persona.runtime_progress.stageLabel}
            </span>
            <span className="text-[oklch(0.58_0_0)]">{Math.round(persona.runtime_progress.percent)}%</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-[oklch(0.92_0_0)] overflow-hidden">
            <div
              className="h-full bg-[oklch(0.72_0.18_142)] transition-all duration-500"
              style={{ width: `${Math.max(2, persona.runtime_progress.percent)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-[oklch(0.58_0_0)]">
            {persona.status === 'stalled'
              ? '超过 15 分钟无进展，建议到培养中心继续培养'
              : persona.status === 'recovering'
              ? '检测到中断，系统已自动发起继续培养'
              : `${persona.runtime_progress.currentRound}/${persona.runtime_progress.totalRounds} 轮 · 预计剩余 ${persona.runtime_progress.etaMin}-${persona.runtime_progress.etaMax} 分钟`}
          </p>
          <p className="mt-1 text-[11px] text-[oklch(0.58_0_0)]">
            最近 Skill 覆盖：{typeof skillSummary.coverage_score === 'number' ? `${(skillSummary.coverage_score * 100).toFixed(1)}%` : '未计算'}
          </p>
          <p className="mt-1 text-[11px] text-[oklch(0.58_0_0)]">
            缺口聚焦题占比：{typeof skillSummary.gap_focused_questions_ratio === 'number' ? `${(skillSummary.gap_focused_questions_ratio * 100).toFixed(1)}%` : '未统计'}
          </p>
        </div>
      )}

      {persona.status === 'converged' || persona.status === 'exported' ? (
        <Link
          href={`/chat/${persona.slug}`}
          className="flex items-center justify-center gap-2 py-2 rounded-xl text-[13.5px] font-medium transition-colors"
          style={{
            background: 'oklch(0.94 0.05 142)',
            color: 'oklch(0.3 0.12 142)',
          }}
        >
          <MessageSquare className="w-4 h-4" />
          对话
        </Link>
      ) : (
        <Link
          href={`/training?slug=${persona.slug}`}
          className="flex items-center justify-center gap-2 py-2 rounded-xl text-[13.5px] font-medium transition-colors border border-[oklch(0.85_0.03_142)] bg-[oklch(0.97_0.03_142)] text-[oklch(0.3_0.12_142)] hover:bg-[oklch(0.95_0.03_142)]"
        >
          查看进度
        </Link>
      )}
    </div>
  );
}

// 新建卡片
export function NewPersonaCard() {
  return (
    <Link href="/create">
      <div className="bg-white rounded-2xl border-2 border-dashed border-[oklch(0.85_0.002_90)] p-5 flex flex-col items-center justify-center gap-3 h-full min-h-[220px] hover:border-[oklch(0.72_0.18_142)] hover:bg-[oklch(0.98_0.01_142)] transition-colors cursor-pointer group">
        <div className="w-12 h-12 rounded-full bg-[oklch(0.96_0.002_90)] group-hover:bg-[oklch(0.92_0.05_142)] flex items-center justify-center transition-colors">
          <span className="text-2xl text-[oklch(0.55_0_0)] group-hover:text-[oklch(0.4_0.15_142)]">+</span>
        </div>
        <span className="text-[14px] text-[oklch(0.5_0_0)] group-hover:text-[oklch(0.35_0.12_142)] font-medium transition-colors">
          新建 Persona
        </span>
      </div>
    </Link>
  );
}
