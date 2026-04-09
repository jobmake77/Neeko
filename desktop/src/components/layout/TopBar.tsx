import React from 'react';
import { useAppStore } from '@/stores/app';
import { t } from '@/lib/i18n';

const VIEW_TITLE_KEYS: Record<string, string> = {
  chat: 'chat',
  personas: 'personas',
  settings: 'settings',
};

export function TopBar() {
  const { view } = useAppStore();
  const titleKey = VIEW_TITLE_KEYS[view] ?? view;

  return (
    <div
      style={{
        height: 44,
        minHeight: 44,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        background: 'rgb(var(--bg-card))',
        borderBottom: '1px solid rgb(var(--border))',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'rgb(var(--text-primary))',
          letterSpacing: '0.01em',
        }}
      >
        {t(titleKey)}
      </span>
    </div>
  );
}
