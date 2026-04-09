import { create } from 'zustand';
import type { ShellView } from '@/lib/types';
import { getLocale, setLocale, type Locale } from '@/lib/i18n';

export type Theme = 'light' | 'dark' | 'system';

interface AppState {
  view: ShellView;
  sidebarOpen: boolean;
  theme: Theme;
  locale: Locale;
  commandOpen: boolean;

  setView: (v: ShellView) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (t: Theme) => void;
  setLocale: (l: Locale) => void;
  setCommandOpen: (open: boolean) => void;
}

function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return t;
}

function applyTheme(t: Theme) {
  const resolved = resolveTheme(t);
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  localStorage.setItem('neeko.theme', t);
}

export const useAppStore = create<AppState>((set) => ({
  view: (localStorage.getItem('neeko.view') as ShellView) || 'chat',
  sidebarOpen: localStorage.getItem('neeko.sidebarOpen') !== 'false',
  theme: (localStorage.getItem('neeko.theme') as Theme) || 'system',
  locale: getLocale(),
  commandOpen: false,

  setView: (v) => {
    set({ view: v });
    localStorage.setItem('neeko.view', v);
  },
  setSidebarOpen: (open) => {
    set({ sidebarOpen: open });
    localStorage.setItem('neeko.sidebarOpen', String(open));
  },
  toggleSidebar: () => {
    set((s) => {
      const next = !s.sidebarOpen;
      localStorage.setItem('neeko.sidebarOpen', String(next));
      return { sidebarOpen: next };
    });
  },
  setTheme: (t) => {
    applyTheme(t);
    set({ theme: t });
  },
  setLocale: (l) => {
    setLocale(l);
    set({ locale: l });
  },
  setCommandOpen: (open) => set({ commandOpen: open }),
}));

// 初始化主题
const savedTheme = (localStorage.getItem('neeko.theme') as Theme) || 'system';
applyTheme(savedTheme);
