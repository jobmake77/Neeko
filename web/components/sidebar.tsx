'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Users,
  Plus,
  Dumbbell,
  Settings,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/create', icon: Plus, label: '新建 Persona' },
  { href: '/', icon: Users, label: '我的 Persona' },
  { href: '/training', icon: Dumbbell, label: '培养中心' },
];

const bottomItems = [
  { href: '/settings', icon: Settings, label: '设置' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [recentChats, setRecentChats] = useState<Array<{
    slug: string;
    name: string;
    last_message: string;
    last_at: string;
    total_messages: number;
  }>>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/chats', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          if (!cancelled) setRecentChats(Array.isArray(data) ? data : []);
        })
        .catch(() => {
          if (!cancelled) setRecentChats([]);
        });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <aside className="w-[220px] flex-shrink-0 bg-white border-r border-[oklch(0.91_0.002_90)] flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-[oklch(0.72_0.18_142)] flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <span className="font-semibold text-[15px] tracking-tight">Neeko</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] transition-colors',
                active
                  ? 'bg-[oklch(0.94_0.01_142)] text-[oklch(0.3_0.12_142)] font-medium'
                  : 'text-[oklch(0.4_0_0)] hover:bg-[oklch(0.97_0_0)]'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}

        <div className="pt-4 pb-1 px-3">
          <span className="text-[11px] text-[oklch(0.65_0_0)] uppercase tracking-wider">
            Messages
          </span>
        </div>

        {recentChats.length === 0 ? (
          <div className="text-[13px] text-[oklch(0.7_0_0)] px-3 py-2">
            暂无对话记录
          </div>
        ) : (
          <div className="space-y-1">
            {recentChats.slice(0, 8).map((item) => (
              <Link
                key={item.slug}
                href={`/chat/${item.slug}`}
                className={cn(
                  'block px-3 py-2 rounded-lg transition-colors',
                  pathname === `/chat/${item.slug}`
                    ? 'bg-[oklch(0.94_0.01_142)]'
                    : 'hover:bg-[oklch(0.97_0_0)]'
                )}
              >
                <p className="text-[12.5px] font-medium text-[oklch(0.25_0_0)] truncate">
                  {item.name}
                </p>
                <p className="text-[11.5px] text-[oklch(0.62_0_0)] truncate">
                  {item.last_message || '...'}
                </p>
              </Link>
            ))}
          </div>
        )}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-3 border-t border-[oklch(0.93_0_0)]">
        {bottomItems.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] text-[oklch(0.4_0_0)] hover:bg-[oklch(0.97_0_0)] transition-colors"
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        ))}

      </div>
    </aside>
  );
}
