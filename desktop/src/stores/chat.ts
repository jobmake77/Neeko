import { create } from 'zustand';
import type { AttachmentRef, ChatModelOverride, Conversation, ConversationMessage, RuntimeModelConfig } from '@/lib/types';
import * as api from '@/lib/api';

export const CHAT_MODEL_OPTIONS: Record<RuntimeModelConfig['provider'], string[]> = {
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3'],
  kimi: ['kimi-for-coding', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
};

function isChatReady(status?: string, isReady?: boolean): boolean {
  if (isReady) return true;
  return ['ready', 'available', 'converged', 'exported'].includes(String(status ?? '').toLowerCase());
}

interface ChatState {
  personaSlug: string | null;
  threads: Conversation[];
  threadId: string | null;
  messages: ConversationMessage[];
  draft: string;
  composerAttachments: AttachmentRef[];
  availableProviders: RuntimeModelConfig['provider'][];
  chatModel: ChatModelOverride | null;
  composerReady: boolean;
  sending: boolean;
  replyPhase: 'idle' | 'preparing' | 'processing_attachments' | 'generating' | 'finalizing';
  loadingThreads: boolean;
  loadingMessages: boolean;
  error: string | null;

  setPersona: (slug: string) => Promise<void>;
  selectThread: (id: string) => Promise<void>;
  createThread: (title?: string) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  renameThread: (id: string, title: string) => Promise<void>;
  hydrateComposer: () => Promise<void>;
  setDraft: (draft: string) => void;
  clearDraft: () => void;
  addAttachmentsFromPaths: (paths: string[]) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setChatProvider: (provider: RuntimeModelConfig['provider']) => void;
  setChatModel: (model: string) => void;
  submitComposer: () => Promise<void>;
  sendMessage: (content: string, attachments?: AttachmentRef[], modelOverride?: ChatModelOverride) => Promise<void>;
  appendOptimistic: (msg: ConversationMessage) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  personaSlug: localStorage.getItem('neeko.personaSlug'),
  threads: [],
  threadId: localStorage.getItem('neeko.threadId'),
  messages: [],
  draft: '',
  composerAttachments: [],
  availableProviders: [],
  chatModel: null,
  composerReady: false,
  sending: false,
  replyPhase: 'idle',
  loadingThreads: false,
  loadingMessages: false,
  error: null,

  setPersona: async (slug) => {
    try {
      const personas = await api.listPersonas();
      const target = personas.find((item) => item.slug === slug);
      if (!target || !isChatReady(target.status, target.is_ready)) {
        set({ personaSlug: null, threads: [], threadId: null, messages: [], error: '当前人格仍在培养中，完成后才能开始对话。' });
        localStorage.removeItem('neeko.personaSlug');
        localStorage.removeItem('neeko.threadId');
        return;
      }
    } catch {
      // ignore readiness preflight failures and continue with the existing selection flow
    }
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

  hydrateComposer: async () => {
    try {
      const config = await api.getRuntimeModelConfig();
      const providers = (Object.entries(config.api_keys) as Array<[RuntimeModelConfig['provider'], string | undefined]>)
        .filter(([, key]) => Boolean(String(key ?? '').trim()))
        .map(([provider]) => provider);
      const fallbackProvider = config.chat_default?.provider ?? config.provider;
      const fallbackModel = config.chat_default?.model ?? config.model;
      const savedProvider = localStorage.getItem('neeko.chat.provider') as RuntimeModelConfig['provider'] | null;
      const savedModel = localStorage.getItem('neeko.chat.model');
      const provider = savedProvider && providers.includes(savedProvider) ? savedProvider : (providers[0] ?? fallbackProvider);
      const modelOptions = CHAT_MODEL_OPTIONS[provider] ?? [];
      const model = savedModel && modelOptions.includes(savedModel)
        ? savedModel
        : (provider === fallbackProvider ? fallbackModel : modelOptions[0]);

      if (provider && model) {
        localStorage.setItem('neeko.chat.provider', provider);
        localStorage.setItem('neeko.chat.model', model);
        set({
          availableProviders: providers,
          chatModel: { provider, model },
          composerReady: true,
        });
        return;
      }
      set({ availableProviders: providers, composerReady: true });
    } catch {
      set({ composerReady: true });
    }
  },

  setDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: '' }),

  addAttachmentsFromPaths: (paths) => {
    const additions = paths.map((path) => {
      const type = inferAttachmentType(path);
      return {
        id: crypto.randomUUID(),
        type,
        name: path.split(/[\\/]/).pop() || path,
        path,
        mime: inferAttachmentMime(path, type),
      } satisfies AttachmentRef;
    });
    set((s) => ({ composerAttachments: [...s.composerAttachments, ...additions] }));
  },

  removeAttachment: (id) => set((s) => ({
    composerAttachments: s.composerAttachments.filter((item) => item.id !== id),
  })),

  clearAttachments: () => set({ composerAttachments: [] }),

  setChatProvider: (provider) => {
    const model = CHAT_MODEL_OPTIONS[provider]?.[0];
    if (!model) return;
    localStorage.setItem('neeko.chat.provider', provider);
    localStorage.setItem('neeko.chat.model', model);
    set({ chatModel: { provider, model } });
  },

  setChatModel: (model) => set((state) => {
    if (!state.chatModel) return state;
    localStorage.setItem('neeko.chat.provider', state.chatModel.provider);
    localStorage.setItem('neeko.chat.model', model);
    return {
      chatModel: {
        ...state.chatModel,
        model,
      },
    };
  }),

  submitComposer: async () => {
    const { draft, composerAttachments, chatModel, sending } = get();
    const content = draft.trim();
    if (!content || sending) return;
    set({ draft: '', composerAttachments: [] });
    await get().sendMessage(content, composerAttachments, chatModel ?? undefined);
  },

  sendMessage: async (content, attachments = [], modelOverride) => {
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
    set((s) => ({
      messages: [...s.messages, optimisticUser],
      sending: true,
      replyPhase: attachments.length > 0 ? 'processing_attachments' : 'preparing',
      error: null,
    }));

    try {
      set({ replyPhase: 'generating' });
      const { message, reply } = await api.sendMessage(tid, content, attachments, modelOverride);
      set((s) => ({
        messages: [
          ...s.messages.filter((m) => m.id !== optimisticUser.id),
          message,
          reply,
        ],
        sending: false,
        replyPhase: 'finalizing',
      }));
      // 更新线程最后消息
      set((s) => ({
        threads: s.threads.map((t) =>
          t.id === tid ? { ...t, last_message: content, updated_at: new Date().toISOString() } : t,
        ),
      }));
      set({ replyPhase: 'idle' });
    } catch (e: unknown) {
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== optimisticUser.id),
        sending: false,
        replyPhase: 'idle',
        error: (e as Error).message,
      }));
    }
  },

  appendOptimistic: (msg) => {
    set((s) => ({ messages: [...s.messages, msg] }));
  },
}));

function inferAttachmentType(path: string): AttachmentRef['type'] {
  const lower = path.toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|heic)$/.test(lower)) return 'image';
  if (/\.(mp4|mov|mkv|webm)$/.test(lower)) return 'video';
  if (/\.(mp3|wav|m4a|ogg|flac)$/.test(lower)) return 'audio';
  if (/\.(txt|md|json|csv|html|yaml|yml)$/.test(lower)) return 'text';
  return 'file';
}

function inferAttachmentMime(path: string, type: AttachmentRef['type']): string | undefined {
  const lower = path.toLowerCase();
  if (type === 'image') {
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }
  if (type === 'video') {
    if (lower.endsWith('.mov')) return 'video/quicktime';
    if (lower.endsWith('.webm')) return 'video/webm';
    return 'video/mp4';
  }
  if (type === 'audio') {
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.ogg')) return 'audio/ogg';
    if (lower.endsWith('.m4a')) return 'audio/mp4';
    return 'audio/mpeg';
  }
  if (type === 'text') {
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.csv')) return 'text/csv';
    return 'text/plain';
  }
  return undefined;
}
