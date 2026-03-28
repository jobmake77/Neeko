'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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

        {/* Recent chat placeholder */}
        <div className="text-[13px] text-[oklch(0.7_0_0)] px-3 py-2">
          暂无对话记录
        </div>
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
