import type {
  AttachmentRef,
  PersonaSummary,
  PersonaMutationResult,
  PersonaDetail,
  PersonaConfig,
  PersonaSource,
  CultivationDetail,
  DiscoveredSourceCandidate,
  PersonaSkillSummary,
  Conversation,
  ConversationBundle,
  ConversationMessage,
  WorkbenchRun,
  HealthStatus,
  RuntimeModelConfig,
  RuntimeSettingsPayload,
  ChatModelOverride,
} from './types';

let _baseUrl = localStorage.getItem('neeko.apiBaseUrl') || 'http://127.0.0.1:4310';

export function getBaseUrl(): string {
  return _baseUrl;
}

export function setBaseUrl(url: string) {
  _baseUrl = url;
  localStorage.setItem('neeko.apiBaseUrl', url);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${_baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Health ──────────────────────────────────────────────────
export async function checkHealth(): Promise<HealthStatus> {
  try {
    return await request<HealthStatus>('/health');
  } catch {
    return { ok: false };
  }
}

// ── Personas ────────────────────────────────────────────────
export async function listPersonas(): Promise<PersonaSummary[]> {
  return request<PersonaSummary[]>('/api/personas');
}

export async function getPersona(slug: string): Promise<PersonaDetail> {
  return request<PersonaDetail>(`/api/personas/${slug}/detail`);
}

/**
 * Create a persona from config (source_type + data source).
 * Server reads `persona_slug` (not `slug`) and returns PersonaMutationResult.
 */
export async function createPersona(config: {
  name: string;
  persona_slug?: string;
  sources: PersonaSource[];
  update_policy?: PersonaConfig['update_policy'];
}): Promise<PersonaMutationResult> {
  return request<PersonaMutationResult>('/api/personas', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function updatePersona(
  slug: string,
  data: Partial<PersonaConfig & { name: string }>,
): Promise<PersonaMutationResult> {
  return request<PersonaMutationResult>(`/api/personas/${slug}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deletePersona(slug: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/personas/${slug}`, { method: 'DELETE' });
}

export async function listCultivatingPersonas(): Promise<PersonaSummary[]> {
  return request<PersonaSummary[]>('/api/cultivating');
}

export async function getCultivationDetail(slug: string): Promise<CultivationDetail> {
  return request<CultivationDetail>(`/api/cultivating/${slug}`);
}

export async function getPersonaSources(slug: string): Promise<PersonaSource[]> {
  return request<PersonaSource[]>(`/api/personas/${slug}/sources`);
}

export async function getDiscoveredSources(slug: string): Promise<DiscoveredSourceCandidate[]> {
  return request<DiscoveredSourceCandidate[]>(`/api/personas/${slug}/discovered-sources`);
}

export async function discoverSources(slug: string): Promise<DiscoveredSourceCandidate[]> {
  return request<DiscoveredSourceCandidate[]>(`/api/personas/${slug}/discover-sources`, {
    method: 'POST',
  });
}

export async function acceptDiscoveredSource(slug: string, candidateId: string): Promise<PersonaMutationResult> {
  return request<PersonaMutationResult>(`/api/personas/${slug}/discovered-sources/${candidateId}/accept`, {
    method: 'POST',
  });
}

export async function rejectDiscoveredSource(slug: string, candidateId: string): Promise<DiscoveredSourceCandidate> {
  return request<DiscoveredSourceCandidate>(`/api/personas/${slug}/discovered-sources/${candidateId}/reject`, {
    method: 'POST',
  });
}

export async function updatePersonaSources(
  slug: string,
  payload: { name?: string; sources: PersonaSource[]; update_policy?: PersonaConfig['update_policy'] }
): Promise<PersonaMutationResult> {
  return request<PersonaMutationResult>(`/api/personas/${slug}/sources`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function checkPersonaUpdates(slug: string): Promise<{ imports: unknown[]; run: WorkbenchRun | null; summary: string }> {
  return request(`/api/personas/${slug}/check-updates`, {
    method: 'POST',
  });
}

export async function continueCultivation(slug: string): Promise<{ imports: unknown[]; run: WorkbenchRun | null; summary: string }> {
  return request(`/api/personas/${slug}/continue-cultivation`, {
    method: 'POST',
  });
}

export async function getPersonaSkills(slug: string): Promise<PersonaSkillSummary> {
  return request<PersonaSkillSummary>(`/api/personas/${slug}/skills`);
}

// ── Conversations ───────────────────────────────────────────
export async function listConversations(personaSlug: string): Promise<Conversation[]> {
  return request<Conversation[]>(`/api/personas/${personaSlug}/conversations`);
}

export async function getConversation(id: string): Promise<ConversationBundle> {
  return request<ConversationBundle>(`/api/conversations/${id}`);
}

export async function createConversation(personaSlug: string, title?: string): Promise<Conversation> {
  return request<Conversation>(`/api/personas/${personaSlug}/conversations`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversation(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' });
}

export async function renameConversation(id: string, title: string): Promise<Conversation> {
  return request<Conversation>(`/api/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

// ── Messages ────────────────────────────────────────────────

/**
 * GET messages for a conversation — the server has no separate /messages GET endpoint,
 * so we fetch the ConversationBundle and return its messages array.
 */
export async function listMessages(conversationId: string): Promise<ConversationMessage[]> {
  const bundle = await getConversation(conversationId);
  return bundle.messages;
}

/**
 * Send a message. Server expects { message: string } and returns ConversationBundle.
 * We extract the last user message and last assistant reply to match the chat store interface.
 */
export async function sendMessage(
  conversationId: string,
  content: string,
  attachments: AttachmentRef[] = [],
  modelOverride?: ChatModelOverride,
): Promise<{ message: ConversationMessage; reply: ConversationMessage }> {
  const bundle = await request<ConversationBundle>(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message: content, attachments, model_override: modelOverride }),
  });
  const msgs = bundle.messages;
  const userMsg = [...msgs].reverse().find((m) => m.role === 'user');
  const aiReply = [...msgs].reverse().find((m) => m.role === 'assistant');
  if (!userMsg || !aiReply) throw new Error('Unexpected response: missing message or reply');
  return { message: userMsg, reply: aiReply };
}

// ── Training ────────────────────────────────────────────────

/**
 * Start a training run. Server reads: { slug, mode, rounds }.
 */
export async function startTraining(slug: string, mode: 'quick' | 'full'): Promise<WorkbenchRun> {
  const rounds = mode === 'quick' ? 3 : 10;
  return request<WorkbenchRun>('/api/runs/train', {
    method: 'POST',
    body: JSON.stringify({ slug, mode, rounds }),
  });
}

export async function getRuntimeModelConfig(): Promise<RuntimeModelConfig> {
  return request<RuntimeModelConfig>('/api/runtime/model-config');
}

export async function updateRuntimeModelConfig(payload: RuntimeModelConfig): Promise<RuntimeModelConfig> {
  return request<RuntimeModelConfig>('/api/runtime/model-config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function getRuntimeSettings(): Promise<RuntimeSettingsPayload> {
  return request<RuntimeSettingsPayload>('/api/runtime/settings');
}

export async function updateRuntimeSettings(payload: RuntimeSettingsPayload): Promise<RuntimeSettingsPayload> {
  return request<RuntimeSettingsPayload>('/api/runtime/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
