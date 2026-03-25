'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, Loader2, Brain, Layers } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// 示例 persona（实际会从 API 获取）
const MOCK_PERSONA = {
  name: 'Elon Musk',
  slug: 'elonmusk',
  overall_confidence: 0.82,
  training_rounds_completed: 8,
  knowledge_domains: { expert: ['航天', '电动汽车', 'AI', '能源'] },
};

export default function ChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [slug, setSlug] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    params.then((p) => setSlug(p.slug));
  }, [params]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    // Mock response — 实际接 /api/chat/[slug]
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `（${MOCK_PERSONA.name} 的 AI 模拟）这是一个示例回复。配置好 API Key 后，Persona 将基于真实的 Soul + Memory 进行回答。`,
        },
      ]);
      setLoading(false);
    }, 1200);
  }

  return (
    <div className="flex h-full">
      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-[oklch(0.91_0_0)]">
          <Link href="/" className="text-[oklch(0.55_0_0)] hover:text-[oklch(0.2_0_0)] transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="w-8 h-8 rounded-full bg-[oklch(0.88_0.08_0)] flex items-center justify-center text-[13px] font-semibold text-[oklch(0.35_0_0)]">
            {MOCK_PERSONA.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-[14px]">{MOCK_PERSONA.name}</p>
            <p className="text-[12px] text-[oklch(0.6_0_0)]">
              Soul v{MOCK_PERSONA.training_rounds_completed} · 置信度 {Math.round(MOCK_PERSONA.overall_confidence * 100)}%
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <div className="w-16 h-16 rounded-full bg-[oklch(0.88_0.08_0)] flex items-center justify-center text-2xl font-semibold text-[oklch(0.35_0_0)] mb-4">
                {MOCK_PERSONA.name.slice(0, 2).toUpperCase()}
              </div>
              <p className="text-[16px] font-semibold text-[oklch(0.25_0_0)]">
                开始与 {MOCK_PERSONA.name} 对话
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
                <div className="w-7 h-7 rounded-full bg-[oklch(0.88_0.08_0)] flex items-center justify-center text-[11px] font-semibold text-[oklch(0.35_0_0)] flex-shrink-0 mt-0.5">
                  {MOCK_PERSONA.name.slice(0, 2).toUpperCase()}
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
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-[oklch(0.88_0.08_0)] flex items-center justify-center text-[11px] font-semibold text-[oklch(0.35_0_0)] flex-shrink-0 mt-0.5">
                {MOCK_PERSONA.name.slice(0, 2).toUpperCase()}
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
              placeholder={`向 ${MOCK_PERSONA.name} 提问...`}
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
                <span className="font-medium">{Math.round(MOCK_PERSONA.overall_confidence * 100)}%</span>
              </div>
              <div className="h-1.5 bg-[oklch(0.93_0_0)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[oklch(0.72_0.18_142)] rounded-full transition-all"
                  style={{ width: `${MOCK_PERSONA.overall_confidence * 100}%` }}
                />
              </div>
            </div>
            <div className="flex justify-between text-[12.5px]">
              <span className="text-[oklch(0.55_0_0)]">训练轮次</span>
              <span className="font-medium">{MOCK_PERSONA.training_rounds_completed} 轮</span>
            </div>
          </div>
        </div>

        <div className="border-t border-[oklch(0.93_0_0)] pt-4">
          <p className="text-[12px] font-semibold text-[oklch(0.5_0_0)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" /> 知识域
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MOCK_PERSONA.knowledge_domains.expert.map((domain) => (
              <span
                key={domain}
                className="px-2 py-0.5 bg-[oklch(0.94_0.05_142)] text-[oklch(0.3_0.12_142)] rounded-full text-[11.5px] font-medium"
              >
                {domain}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
