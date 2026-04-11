import { create } from 'zustand';
import type { PersonaSummary, PersonaDetail } from '@/lib/types';
import * as api from '@/lib/api';

interface PersonaState {
  personas: PersonaSummary[];
  selected: PersonaDetail | null;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  select: (slug: string) => Promise<void>;
  clearSelected: () => void;
  remove: (slug: string) => Promise<void>;
  reload: () => Promise<void>;
}

export const usePersonaStore = create<PersonaState>((set, get) => ({
  personas: [],
  selected: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const personas = await api.listPersonas();
      set({ personas, loading: false });
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  select: async (slug) => {
    try {
      const detail = await api.getPersona(slug);
      set({ selected: detail });
    } catch (e: unknown) {
      console.error('Failed to load persona detail:', e);
    }
  },

  clearSelected: () => set({ selected: null }),

  remove: async (slug) => {
    await api.deletePersona(slug);
    set((s) => ({
      personas: s.personas.filter((p) => p.slug !== slug),
      selected: s.selected?.persona.slug === slug ? null : s.selected,
    }));
  },

  reload: async () => {
    await get().load();
  },
}));
