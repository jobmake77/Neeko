import { useEffect } from 'react';
import { bootstrapWorkbench } from './lib/tauri';
import { AppShell } from './components/layout/AppShell';

export default function App() {
  useEffect(() => {
    bootstrapWorkbench().catch(console.error);
  }, []);

  return <AppShell />;
}
