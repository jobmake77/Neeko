'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, Loader2, Brain, Layers } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  triggered_skills?: Array<{ id: string; name: string; reason: 'manual' | 'automatic'; trigger_score: number }>;
}

interface PersonaInfo {
  name: string;
  slug: string;
  overall_confidence: number;
  training_rounds_completed: number;
  knowledge_domains: { expert: string[] };
}

function getAvatarColor(slug: string): string {
  const colors = [
    'oklch(0.88 0.08 0)',
    'oklch(0.88 0.08 142)',
    'oklch(0.88 0.08 60)',
    'oklch(0.88 0.08 270)',
    'oklch(0.88 0.08 200)',
    'oklch(0.88 0.08 30)',
  ];
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffff;
  return colors[Math.abs(hash) % colors.length];
}

export default function ChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [slug, setSlug] = useState('');
  const [persona, setPersona] = useState<PersonaInfo | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    params.then((p) => {
      setSlug(p.slug);
      // Load persona info
      fetch(`/api/personas/${p.slug}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data?.persona) {
            const pa = data.persona;
            const soul = data.soul;
            setPersona({
              name: pa.name,
              slug: pa.slug,
              overall_confidence: soul?.overall_confidence ?? 0,
              training_rounds_completed: soul?.training_rounds_completed ?? pa.training_rounds ?? 0,
              knowledge_domains: { expert: soul?.knowledge_domains?.expert ?? [] },
            });
          }
        })
        .catch(() => null);
      // Load recent chat history
      fetch(`/api/chat/${p.slug}?limit=80`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (Array.isArray(data?.messages)) {
            setMessages(
              data.messages
                .filter((m: { role?: string; content?: string }) => m?.role === 'user' || m?.role === 'assistant')
                .map((m: {
                  role: 'user' | 'assistant';
                  content: string;
                  triggered_skills?: Array<{ id: string; name: string; reason: 'manual' | 'automatic'; trigger_score: number }>;
                }) => ({ role: m.role, content: m.content, triggered_skills: m.triggered_skills }))
            );
          }
        })
        .catch(() => null);
    });
  }, [params]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || loading || !slug) return;
    const userMsg = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch(`/api/chat/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, history: messages }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: data.reply ?? '[无回复]',
        triggered_skills: Array.isArray(data.triggered_skills) ? data.triggered_skills : [],
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `[错误] ${String(err)}` }]);
    } finally {
      setLoading(false);
    }
  }

  const displayName = persona?.name ?? slug;
  const initials = displayName.slice(0, 2).toUpperCase();
  const avatarColor = getAvatarColor(slug);

  return (
    <div className="flex h-full">
      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-[oklch(0.91_0_0)]">
          <Link href="/" className="text-[oklch(0.55_0_0)] hover:text-[oklch(0.2_0_0)] transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold text-[oklch(0.35_0_0)]"
            style={{ background: avatarColor }}
          >
            {initials}
          </div>
          <div>
            <p className="font-semibold text-[14px]">{displayName}</p>
            <p className="text-[12px] text-[oklch(0.6_0_0)]">
              {persona
                ? `Soul v${persona.training_rounds_completed} · 置信度 ${Math.round(persona.overall_confidence * 100)}%`
                : '加载中...'}
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-semibold text-[oklch(0.35_0_0)] mb-4"
                style={{ background: avatarColor }}
              >
                {initials}
              </div>
              <p className="text-[16px] font-semibold text-[oklch(0.25_0_0)]">
                开始与 {displayName} 对话
              </p>
              <p className="text-[13px] text-[oklch(0.6_0_0)] mt-2 max-w-[320px]">
                这是基于公开数据构建的 AI 模拟，非真实人物。提问任何你想了解的话题。
              </p>
              <div className="flex flex-wrap gap-2 mt-6 justify-center">
                {['你如何看待 AI 的未来？', '分享你最重要的商业原则', '如果重来，你会做什么不同的事？'].map((q) => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="px-3 py-1.5 rounded-full bg-white border border-[oklch(0.88_0_0)] text-[12.5px] text-[oklch(0.4_0_0)] hover:bg-[oklch(0.97_0_0)] transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              {msg.role === 'assistant' && (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-[oklch(0.35_0_0)] flex-shrink-0 mt-0.5"
                  style={{ background: avatarColor }}
                >
                  {initials}
                </div>
              )}
              <div
                className={cn(
                  'max-w-[70%] px-4 py-3 rounded-2xl text-[14px] leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-[oklch(0.15_0_0)] text-white rounded-br-sm'
                    : 'bg-white border border-[oklch(0.91_0_0)] text-[oklch(0.2_0_0)] rounded-bl-sm'
                )}
              >
                {msg.content}
                {msg.role === 'assistant' && Array.isArray(msg.triggered_skills) && msg.triggered_skills.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {msg.triggered_skills.slice(0, 2).map((item) => (
                      <span
                        key={`${i}-${item.id}`}
                        className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.94_0.06_142)] px-2 py-0.5 text-[10.5px] text-[oklch(0.28_0.12_142)]"
                        title={`${item.reason} trigger · score ${(item.trigger_score * 100).toFixed(0)}%`}
                      >
                        {item.reason === 'manual' ? '手动' : '自动'} · {item.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-[oklch(0.35_0_0)] flex-shrink-0 mt-0.5"
                style={{ background: avatarColor }}
              >
                {initials}
              </div>
              <div className="bg-white border border-[oklch(0.91_0_0)] px-4 py-3 rounded-2xl rounded-bl-sm">
                <Loader2 className="w-4 h-4 animate-spin text-[oklch(0.6_0_0)]" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 bg-white border-t border-[oklch(0.91_0_0)]">
          <div className="flex items-end gap-3 bg-[oklch(0.97_0_0)] rounded-2xl px-4 py-3 border border-[oklch(0.88_0_0)] focus-within:border-[oklch(0.72_0.18_142)] focus-within:ring-2 focus-within:ring-[oklch(0.72_0.18_142)]/20 transition-all">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
              placeholder={`向 ${displayName} 提问...`}
              rows={1}
              className="flex-1 bg-transparent outline-none resize-none text-[14px] placeholder:text-[oklch(0.65_0_0)] leading-relaxed"
              style={{ maxHeight: '120px' }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-xl bg-[oklch(0.15_0_0)] text-white flex items-center justify-center hover:bg-[oklch(0.25_0_0)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-[oklch(0.7_0_0)] mt-2 text-center">
            AI 模拟 · 非真实人物 · Enter 发送 / Shift+Enter 换行
          </p>
        </div>
      </div>

      {/* Soul sidebar */}
      <div className="w-[260px] flex-shrink-0 bg-white border-l border-[oklch(0.91_0_0)] p-5 space-y-5 overflow-y-auto">
        <div>
          <p className="text-[12px] font-semibold text-[oklch(0.5_0_0)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Brain className="w-3.5 h-3.5" /> Soul 状态
          </p>
          <div className="space-y-2.5">
            <div>
              <div className="flex justify-between text-[12px] mb-1">
                <span className="text-[oklch(0.5_0_0)]">整体置信度</span>
                <span className="font-medium">{persona ? `${Math.round(persona.overall_confidence * 100)}%` : '—'}</span>
              </div>
              <div className="h-1.5 bg-[oklch(0.93_0_0)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[oklch(0.72_0.18_142)] rounded-full transition-all"
                  style={{ width: persona ? `${persona.overall_confidence * 100}%` : '0%' }}
                />
              </div>
            </div>
            <div className="flex justify-between text-[12.5px]">
              <span className="text-[oklch(0.55_0_0)]">训练轮次</span>
              <span className="font-medium">{persona ? `${persona.training_rounds_completed} 轮` : '—'}</span>
            </div>
          </div>
        </div>

        {persona && persona.knowledge_domains.expert.length > 0 && (
          <div className="border-t border-[oklch(0.93_0_0)] pt-4">
            <p className="text-[12px] font-semibold text-[oklch(0.5_0_0)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" /> 知识域
            </p>
            <div className="flex flex-wrap gap-1.5">
              {persona.knowledge_domains.expert.map((domain) => (
                <span
                  key={domain}
                  className="px-2 py-0.5 bg-[oklch(0.94_0.05_142)] text-[oklch(0.3_0.12_142)] rounded-full text-[11.5px] font-medium"
                >
                  {domain}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
