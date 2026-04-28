import { create } from 'zustand';
import type { PersonaSummary, CultivationDetail } from '@/lib/types';
import * as api from '@/lib/api';

interface CultivationState {
  cultivating: PersonaSummary[];
  details: Record<string, CultivationDetail>;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  loadDetail: (slug: string) => Promise<void>;
  upsert: (persona: PersonaSummary) => void;
  remove: (slug: string) => void;
  reload: () => Promise<void>;
}

export const useCultivationStore = create<CultivationState>((set, get) => ({
  cultivating: [],
  details: {},
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const cultivating = await api.listCultivatingPersonas();
      const liveSlugs = new Set(cultivating.map((item) => item.slug));
      set((state) => ({
        cultivating,
        loading: false,
        details: Object.fromEntries(
          Object.entries(state.details).filter(([slug]) => liveSlugs.has(slug))
        ),
      }));
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  loadDetail: async (slug) => {
    try {
      const detail = await api.getCultivationDetail(slug);
      set((s) => ({ details: { ...s.details, [slug]: detail } }));
    } catch (e: unknown) {
      console.error('Failed to load cultivation detail:', e);
    }
  },

  upsert: (persona) => {
    set((state) => {
      const ready = ['converged', 'available', 'ready', 'exported'].includes(String(persona.status ?? '').toLowerCase());
      const filtered = state.cultivating.filter((item) => item.slug !== persona.slug);
      if (ready) {
        return {
          cultivating: filtered,
          details: Object.fromEntries(Object.entries(state.details).filter(([slug]) => slug !== persona.slug)),
        };
      }
      const next = [persona, ...filtered].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return { cultivating: next };
    });
  },

  remove: (slug) => {
    set((s) => ({
      cultivating: s.cultivating.filter((p) => p.slug !== slug),
      details: Object.fromEntries(
        Object.entries(s.details).filter(([k]) => k !== slug)
      ),
    }));
  },

  reload: async () => {
    await get().load();
  },
}));
