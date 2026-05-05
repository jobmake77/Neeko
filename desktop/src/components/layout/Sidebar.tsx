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
  Trash2,
  PanelLeft,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import type { ShellView } from '@/lib/types';
import type { Theme } from '@/stores/app';
import neekoBrand from '@/assets/neeko-brand.png';

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
  const [deleteThreadTarget, setDeleteThreadTarget] = useState<{ id: string; title?: string } | null>(null);
  const [deleteThreadPending, setDeleteThreadPending] = useState(false);
  const [deleteThreadError, setDeleteThreadError] = useState('');

  const width = sidebarOpen ? (propWidth ?? 260) : 64;

  function cycleTheme() {
    const idx = THEME_CYCLE.indexOf(theme);
    setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  }

  const themeLabel = theme === 'light' ? t('themeLight') : theme === 'dark' ? t('themeDark') : t('themeSystem');

  async function confirmDeleteThread() {
    if (!deleteThreadTarget || deleteThreadPending) return;
    setDeleteThreadPending(true);
    setDeleteThreadError('');
    try {
      await deleteThread(deleteThreadTarget.id);
      setDeleteThreadTarget(null);
    } catch (e: unknown) {
      setDeleteThreadError((e as Error).message || '删除失败');
    } finally {
      setDeleteThreadPending(false);
    }
  }

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
          height: 74,
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarOpen ? 'space-between' : 'center',
          padding: sidebarOpen ? '0 18px 0 22px' : '0',
          flexShrink: 0,
        }}
      >
        {sidebarOpen && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgb(var(--bg-card))',
                border: '1px solid rgb(var(--border))',
                boxShadow: '0 2px 6px rgb(0 0 0 / 0.08)',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              <img
                src={neekoBrand}
                alt="Neeko"
                style={{ width: 24, height: 24, objectFit: 'contain', objectPosition: 'center' }}
              />
            </div>
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 0,
                color: 'rgb(var(--text-primary))',
                lineHeight: 1,
              }}
            >
              Neeko
            </span>
          </div>
        )}
        <button
          className="btn btn-icon"
          onClick={toggleSidebar}
          title={sidebarOpen ? t('close') : t('more')}
          style={sidebarOpen ? { width: 30, height: 30 } : { width: 36, height: 36, borderRadius: 9, background: 'rgb(var(--bg-card))', border: '1px solid rgb(var(--border))', padding: 5 }}
        >
          {sidebarOpen ? <ChevronLeft size={16} /> : (
            <img src={neekoBrand} alt="Neeko" style={{ width: 24, height: 24, objectFit: 'contain' }} />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ padding: '12px 16px 8px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`sidebar-item${view === item.id ? ' active' : ''}`}
            onClick={() => setView(item.id)}
            style={{
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
              gap: sidebarOpen ? 10 : 0,
              minHeight: 42,
              padding: sidebarOpen ? '0 14px' : '0',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{item.icon}</span>
            {sidebarOpen && (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 14, fontWeight: view === item.id ? 650 : 500 }}>
                {t(item.labelKey)}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgb(var(--border-light))', margin: '8px 18px', flexShrink: 0 }} />

      {/* Thread list — only when view === 'chat' and sidebar is open */}
      {view === 'chat' && sidebarOpen && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {/* New thread button */}
          <div style={{ padding: '10px 16px 6px', flexShrink: 0 }}>
            <button
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'center', gap: 8, fontSize: 13, minHeight: 36, border: '1px solid rgb(var(--border))', background: 'rgb(var(--bg-card))', borderRadius: 11 }}
              onClick={() => createThread()}
            >
              <Plus size={15} />
              {t('newChat')}
            </button>
          </div>

          {/* Section label */}
          <div
            style={{
              padding: '16px 14px 7px',
              fontSize: 13,
              fontWeight: 500,
              color: 'rgb(var(--text-tertiary))',
              textTransform: 'none',
              letterSpacing: 0,
              flexShrink: 0,
            }}
          >
            {t('recentChats')}
          </div>

          {/* Thread items */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '2px 16px 10px' }}>
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
                    minHeight: 38,
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
                      fontSize: 13,
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
                        setDeleteThreadTarget({ id: thread.id, title: thread.title || thread.last_message || t('newChat') });
                        setDeleteThreadError('');
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
          padding: '12px 16px',
          flexShrink: 0,
          borderTop: '1px solid rgb(var(--border-light))',
          display: 'flex',
          justifyContent: sidebarOpen ? 'space-between' : 'center',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
      {deleteThreadTarget ? (
        <>
          <div
            onClick={() => {
              if (deleteThreadPending) return;
              setDeleteThreadTarget(null);
              setDeleteThreadError('');
            }}
            style={{ position: 'fixed', inset: 0, background: 'rgb(0 0 0 / 0.28)', zIndex: 290 }}
          />
          <div
            style={{
              position: 'fixed',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 340,
              borderRadius: 8,
              border: '1px solid rgb(var(--border))',
              background: 'rgb(var(--bg-card))',
              boxShadow: '0 20px 48px rgb(0 0 0 / 0.18)',
              padding: 20,
              zIndex: 291,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 750, color: 'rgb(var(--text-primary))', marginBottom: 8 }}>删除对话</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'rgb(var(--text-secondary))', marginBottom: 14 }}>
              将删除「{deleteThreadTarget.title || t('newChat')}」和其中的消息记录。
            </div>
            {deleteThreadError ? (
              <div style={{ fontSize: 12, color: '#ef4444', padding: '7px 10px', background: 'rgb(239 68 68 / 0.08)', borderRadius: 6, marginBottom: 12 }}>
                {deleteThreadError}
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" disabled={deleteThreadPending} onClick={() => { setDeleteThreadTarget(null); setDeleteThreadError(''); }}>
                {t('cancel')}
              </button>
              <button className="btn btn-primary" disabled={deleteThreadPending} onClick={() => void confirmDeleteThread()} style={{ background: '#ef4444' }}>
                {deleteThreadPending ? '删除中…' : t('delete')}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
