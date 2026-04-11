import { useEffect } from 'react';
import { bootstrapWorkbench } from './lib/tauri';
import * as api from './lib/api';
import { AppShell } from './components/layout/AppShell';

export default function App() {
  useEffect(() => {
    bootstrapWorkbench().catch(console.error);
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
    return () => window.clearInterval(timer);
  }, []);

  return <AppShell />;
}
