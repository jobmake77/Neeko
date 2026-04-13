import React, { lazy, Suspense, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/app';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

const ChatView = lazy(() => import('../chat/ChatView').then(m => ({ default: m.ChatView })));
const PersonaView = lazy(() => import('../persona/PersonaView').then(m => ({ default: m.PersonaView })));
const SettingsView = lazy(() => import('../settings/SettingsView').then(m => ({ default: m.SettingsView })));

const MIN_SIDEBAR_W = 208;
const MAX_SIDEBAR_W = 360;
const DEFAULT_SIDEBAR_W = 232;

function Fallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgb(var(--text-tertiary))' }}>
      加载中…
    </div>
  );
}

export function AppShell() {
  const { view, sidebarOpen } = useAppStore();
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_W);
  const [dragging, setDragging] = useState(false);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    setDragging(true);

    const onMove = (ev: MouseEvent) => {
      const newW = Math.min(MAX_SIDEBAR_W, Math.max(MIN_SIDEBAR_W, startW + ev.clientX - startX));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  return (
    <div
      style={{
        display: 'flex', height: '100vh', width: '100vw',
        overflow: 'hidden', background: 'rgb(var(--bg-app))',
        cursor: dragging ? 'col-resize' : 'auto',
        userSelect: dragging ? 'none' : 'auto',
      }}
    >
      <Sidebar width={sidebarOpen ? sidebarWidth : undefined} dragging={dragging} />

      {/* Drag handle — only visible when sidebar is open */}
      {sidebarOpen && (
        <div
          onMouseDown={startDrag}
          style={{
            width: 4,
            flexShrink: 0,
            cursor: 'col-resize',
            background: dragging ? 'rgb(var(--accent))' : 'transparent',
            transition: 'background 0.15s',
            zIndex: 10,
          }}
          onMouseEnter={(e) => { if (!dragging) e.currentTarget.style.background = 'rgb(var(--border))'; }}
          onMouseLeave={(e) => { if (!dragging) e.currentTarget.style.background = 'transparent'; }}
        />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <TopBar />
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <Suspense fallback={<Fallback />}>
            {view === 'chat' && <ChatView />}
            {view === 'personas' && <PersonaView />}
            {view === 'settings' && <SettingsView />}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
