import React from 'react';
import { useAppStore } from '@/stores/app';
import { t } from '@/lib/i18n';
import { MessageSquare, Settings, Users } from 'lucide-react';

const VIEW_TITLE_KEYS: Record<string, string> = {
  chat: 'chat',
  personas: 'personas',
  settings: 'settings',
};

export function TopBar() {
  const { view } = useAppStore();
  const titleKey = VIEW_TITLE_KEYS[view] ?? view;
  const icon = view === 'personas' ? <Users size={18} /> : view === 'settings' ? <Settings size={18} /> : <MessageSquare size={18} />;
  const subtitle = view === 'personas'
      ? '人格资料、来源和后台更新'
      : '本地连接、模型和偏好';

  return (
    <div
      style={{
        height: 66,
        minHeight: 66,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 18,
        padding: '0 26px',
        background: 'rgb(var(--bg-app) / 0.82)',
        borderBottom: '1px solid rgb(var(--border))',
        backdropFilter: 'blur(18px)',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span style={{ color: 'rgb(var(--text-secondary))', display: 'flex', alignItems: 'center' }}>{icon}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'rgb(var(--text-primary))', letterSpacing: 0 }}>
            {t(titleKey)}
          </div>
          {view !== 'chat' ? (
            <div style={{ marginTop: 2, fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
