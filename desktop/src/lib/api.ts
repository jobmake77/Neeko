import {
  Conversation,
  ConversationBundle,
  MemoryCandidate,
  PersonaSummary,
  PersonaWorkbenchProfile,
  WorkbenchRun,
  WorkbenchRunReport,
} from './types';

const DEFAULT_BASE_URL = import.meta.env.VITE_NEEKO_WORKBENCH_URL ?? 'http://127.0.0.1:4310';

export function getApiBaseUrl(): string {
  return window.localStorage.getItem('neeko.workbench.apiBaseUrl') ?? DEFAULT_BASE_URL;
}

export function setApiBaseUrl(value: string): void {
  window.localStorage.setItem('neeko.workbench.apiBaseUrl', value);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Request failed');
  }
  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; port: number }>('/health'),
  listPersonas: () => request<PersonaSummary[]>('/api/personas'),
  getPersona: (slug: string) => request<PersonaWorkbenchProfile>(`/api/personas/${encodeURIComponent(slug)}`),
  listConversations: (slug: string) => request<Conversation[]>(`/api/personas/${encodeURIComponent(slug)}/conversations`),
  createConversation: (slug: string, title?: string) =>
    request<Conversation>(`/api/personas/${encodeURIComponent(slug)}/conversations`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  getConversation: (id: string) => request<ConversationBundle>(`/api/conversations/${encodeURIComponent(id)}`),
  sendMessage: (id: string, message: string) =>
    request<ConversationBundle>(`/api/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  listMemoryCandidates: (id: string) =>
    request<MemoryCandidate[]>(`/api/conversations/${encodeURIComponent(id)}/writeback-candidates`),
  createPersona: (payload: Record<string, unknown>) =>
    request<WorkbenchRun>('/api/personas', { method: 'POST', body: JSON.stringify(payload) }),
  startTraining: (payload: Record<string, unknown>) =>
    request<WorkbenchRun>('/api/runs/train', { method: 'POST', body: JSON.stringify(payload) }),
  startExperiment: (payload: Record<string, unknown>) =>
    request<WorkbenchRun>('/api/runs/experiment', { method: 'POST', body: JSON.stringify(payload) }),
  exportPersona: (payload: Record<string, unknown>) =>
    request<WorkbenchRun>('/api/runs/export', { method: 'POST', body: JSON.stringify(payload) }),
  getRun: (id: string) => request<WorkbenchRun>(`/api/runs/${encodeURIComponent(id)}`),
  getRunReport: (id: string) => request<WorkbenchRunReport>(`/api/runs/${encodeURIComponent(id)}/report`),
};
