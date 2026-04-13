import React, { useState } from 'react';
import { useAppStore } from '@/stores/app';
import { useChatStore } from '@/stores/chat';
import { t } from '@/lib/i18n';
import {
  MessageSquare,
  Users,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  Trash2,
  PanelLeft,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import type { ShellView } from '@/lib/types';
import type { Theme } from '@/stores/app';

interface NavItem {
  id: ShellView;
  labelKey: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'chat', labelKey: 'chat', icon: <MessageSquare size={18} /> },
  { id: 'personas', labelKey: 'personas', icon: <Users size={18} /> },
  { id: 'settings', labelKey: 'settings', icon: <Settings size={18} /> },
];

const THEME_CYCLE: Theme[] = ['light', 'dark', 'system'];

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') return <Sun size={15} />;
  if (theme === 'dark') return <Moon size={15} />;
  return <Monitor size={15} />;
}

interface SidebarProps {
  width?: number;
  dragging?: boolean;
}

export function Sidebar({ width: propWidth, dragging }: SidebarProps) {
  const { view, setView, sidebarOpen, toggleSidebar, locale, setLocale, theme, setTheme } = useAppStore();
  const { threads, threadId, selectThread, createThread, deleteThread } = useChatStore();
  const [hoveredThread, setHoveredThread] = useState<string | null>(null);

  const width = sidebarOpen ? (propWidth ?? 232) : 56;

  function cycleTheme() {
    const idx = THEME_CYCLE.indexOf(theme);
    setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  }

  const themeLabel = theme === 'light' ? t('themeLight') : theme === 'dark' ? t('themeDark') : t('themeSystem');

  return (
    <div
      style={{
        width,
        minWidth: width,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgb(var(--bg-sidebar))',
        borderRight: '1px solid rgb(var(--border))',
        transition: dragging ? 'none' : 'width 200ms ease, min-width 200ms ease',
        overflow: 'hidden',
      }}
    >
      {/* Header: toggle button */}
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarOpen ? 'flex-end' : 'center',
          padding: sidebarOpen ? '0 10px' : '0',
          flexShrink: 0,
        }}
      >
        <button
          className="btn btn-icon"
          onClick={toggleSidebar}
          title={sidebarOpen ? t('close') : t('more')}
        >
          {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ padding: '8px 8px 6px', display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`sidebar-item${view === item.id ? ' active' : ''}`}
            onClick={() => setView(item.id)}
            style={{
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
              gap: sidebarOpen ? 10 : 0,
              minHeight: 38,
              padding: sidebarOpen ? '0 12px' : '0',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{item.icon}</span>
            {sidebarOpen && (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 15 }}>
                {t(item.labelKey)}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgb(var(--border-light))', margin: '6px 10px', flexShrink: 0 }} />

      {/* Thread list — only when view === 'chat' and sidebar is open */}
      {view === 'chat' && sidebarOpen && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {/* New thread button */}
          <div style={{ padding: '8px 8px 6px 8px', flexShrink: 0 }}>
            <button
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'flex-start', gap: 8, fontSize: 13.5, minHeight: 36 }}
              onClick={() => createThread()}
            >
              <Plus size={15} />
              {t('newChat')}
            </button>
          </div>

          {/* Section label */}
          <div
            style={{
              padding: '6px 14px 4px',
              fontSize: 12,
              fontWeight: 600,
              color: 'rgb(var(--text-tertiary))',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              flexShrink: 0,
            }}
          >
            {t('recentChats')}
          </div>

          {/* Thread items */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '2px 8px 10px 8px' }}>
            {threads.length === 0 ? (
              <div
                style={{
                  padding: '12px 8px',
                  fontSize: 13,
                  color: 'rgb(var(--text-tertiary))',
                  textAlign: 'center',
                }}
              >
                {t('noChats')}
              </div>
            ) : (
              threads.map((thread) => (
                <div
                  key={thread.id}
                  className={`sidebar-item${threadId === thread.id ? ' active' : ''}`}
                  style={{
                    position: 'relative',
                    justifyContent: 'space-between',
                    minHeight: 36,
                    cursor: 'pointer',
                  }}
                  onClick={() => selectThread(thread.id)}
                  onMouseEnter={() => setHoveredThread(thread.id)}
                  onMouseLeave={() => setHoveredThread(null)}
                >
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 14,
                    }}
                  >
                    {thread.title || t('newChat')}
                  </span>
                  {hoveredThread === thread.id && (
                    <button
                      className="btn btn-icon"
                      style={{
                        width: 24,
                        height: 24,
                        flexShrink: 0,
                        color: 'rgb(var(--text-tertiary))',
                        marginLeft: 4,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteThread(thread.id);
                      }}
                      title={t('deleteThread')}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Collapsed new-thread icon button */}
      {view === 'chat' && !sidebarOpen && (
        <div style={{ padding: '6px 8px', flexShrink: 0 }}>
          <button
            className="btn btn-icon"
            style={{ width: '100%' }}
            onClick={() => createThread()}
            title={t('newChat')}
          >
            <Plus size={16} />
          </button>
        </div>
      )}

      {/* Spacer */}
      <div style={{ flex: 1, minHeight: 12 }} />

      {/* Bottom controls: locale + theme */}
      <div
        style={{
          padding: '10px 8px',
          flexShrink: 0,
          borderTop: '1px solid rgb(var(--border-light))',
          display: 'flex',
          justifyContent: sidebarOpen ? 'flex-start' : 'center',
          gap: 4,
        }}
      >
        <button
          className="btn btn-ghost"
          style={{
            fontSize: 12,
            gap: 6,
            padding: sidebarOpen ? '0 8px' : '0',
            minWidth: 0,
          }}
          onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          title={locale === 'zh' ? 'Switch to English' : '切换中文'}
        >
          <PanelLeft size={14} />
          {sidebarOpen && <span>{locale === 'zh' ? 'EN' : '中'}</span>}
        </button>

        <button
          className="btn btn-icon"
          onClick={cycleTheme}
          title={themeLabel}
          style={{ width: 30, height: 30, color: 'rgb(var(--text-secondary))' }}
        >
          <ThemeIcon theme={theme} />
        </button>
      </div>
    </div>
  );
}
