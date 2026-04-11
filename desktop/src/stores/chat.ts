import { create } from 'zustand';
import type { AttachmentRef, Conversation, ConversationMessage } from '@/lib/types';
import * as api from '@/lib/api';

interface ChatState {
  personaSlug: string | null;
  threads: Conversation[];
  threadId: string | null;
  messages: ConversationMessage[];
  sending: boolean;
  loadingThreads: boolean;
  loadingMessages: boolean;
  error: string | null;

  setPersona: (slug: string) => Promise<void>;
  selectThread: (id: string) => Promise<void>;
  createThread: (title?: string) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  renameThread: (id: string, title: string) => Promise<void>;
  sendMessage: (content: string, attachments?: AttachmentRef[]) => Promise<void>;
  appendOptimistic: (msg: ConversationMessage) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  personaSlug: localStorage.getItem('neeko.personaSlug'),
  threads: [],
  threadId: localStorage.getItem('neeko.threadId'),
  messages: [],
  sending: false,
  loadingThreads: false,
  loadingMessages: false,
  error: null,

  setPersona: async (slug) => {
    set({ personaSlug: slug, threads: [], threadId: null, messages: [] });
    localStorage.setItem('neeko.personaSlug', slug);
    localStorage.removeItem('neeko.threadId');
    set({ loadingThreads: true });
    try {
      const threads = await api.listConversations(slug);
      set({ threads, loadingThreads: false });
      // 自动选中最近的线程
      if (threads.length > 0) {
        await get().selectThread(threads[0].id);
      }
    } catch {
      set({ loadingThreads: false });
    }
  },

  selectThread: async (id) => {
    set({ threadId: id, loadingMessages: true });
    localStorage.setItem('neeko.threadId', id);
    try {
      const msgs = await api.listMessages(id);
      set({ messages: msgs, loadingMessages: false });
    } catch {
      set({ loadingMessages: false });
    }
  },

  createThread: async (title) => {
    const { personaSlug } = get();
    if (!personaSlug) return;
    const conv = await api.createConversation(personaSlug, title);
    set((s) => ({ threads: [conv, ...s.threads] }));
    await get().selectThread(conv.id);
  },

  deleteThread: async (id) => {
    await api.deleteConversation(id);
    const state = get();
    const threads = state.threads.filter((t) => t.id !== id);
    set({ threads });
    if (state.threadId === id) {
      if (threads.length > 0) {
        await get().selectThread(threads[0].id);
      } else {
        set({ threadId: null, messages: [] });
        localStorage.removeItem('neeko.threadId');
      }
    }
  },

  renameThread: async (id, title) => {
    const updated = await api.renameConversation(id, title);
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? { ...t, ...updated } : t)),
    }));
  },

  sendMessage: async (content, attachments = []) => {
    const { threadId, personaSlug } = get();
    if (!personaSlug) return;

    // 若无线程则创建
    let tid = threadId;
    if (!tid) {
      const conv = await api.createConversation(personaSlug);
      tid = conv.id;
      set((s) => ({ threads: [conv, ...s.threads], threadId: tid! }));
      localStorage.setItem('neeko.threadId', tid);
    }

    const optimisticUser: ConversationMessage = {
      id: `tmp-${Date.now()}`,
      conversation_id: tid,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
      attachments,
    };
    set((s) => ({ messages: [...s.messages, optimisticUser], sending: true }));

    try {
      const { message, reply } = await api.sendMessage(tid, content, attachments);
      set((s) => ({
        messages: [
          ...s.messages.filter((m) => m.id !== optimisticUser.id),
          message,
          reply,
        ],
        sending: false,
      }));
      // 更新线程最后消息
      set((s) => ({
        threads: s.threads.map((t) =>
          t.id === tid ? { ...t, last_message: content, updated_at: new Date().toISOString() } : t,
        ),
      }));
    } catch (e: unknown) {
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== optimisticUser.id),
        sending: false,
        error: (e as Error).message,
      }));
    }
  },

  appendOptimistic: (msg) => {
    set((s) => ({ messages: [...s.messages, msg] }));
  },
}));
