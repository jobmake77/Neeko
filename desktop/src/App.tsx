import { useEffect } from 'react';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import * as api from './lib/api';
import { AppShell } from './components/layout/AppShell';

async function ensureWorkbenchReady() {
  const health = await api.checkHealth();
  if (!health.ok || !health.build_id || !health.server_version) {
    await api.ensureWorkbenchReachable(true);
  }
}

export default function App() {
  useEffect(() => {
    let cancelled = false;

    const focusWindow = async () => {
      try {
        const appWindow = getCurrentWindow();
        const retryDelays = [0, 180, 480, 1200];
        for (const delay of retryDelays) {
          if (cancelled) return;
          if (delay > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delay));
          }
          await appWindow.show();
          await appWindow.setFocus();
        }
        await appWindow.requestUserAttention(UserAttentionType.Informational);
      } catch {
        // keep startup quiet outside Tauri or when focus APIs are unavailable
      }
    };

    void focusWindow();
    void ensureWorkbenchReady();
    const runAutoCheck = async () => {
      try {
        const personas = await api.listPersonas();
        await Promise.all(personas.map((persona) => api.checkPersonaUpdates(persona.slug).catch(() => undefined)));
      } catch {
        // keep startup quiet
      }
    };
    void runAutoCheck();
    const timer = window.setInterval(() => {
      void runAutoCheck();
    }, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return <AppShell />;
}
