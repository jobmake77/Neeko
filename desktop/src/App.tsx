import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChatWorkspace } from './components/ChatWorkspace';
import { MiniRail } from './components/MiniRail';
import { PersonaLibraryScreen, type CreatePayload } from './components/PersonaLibraryScreen';
import { PersonaLibrarySidebar } from './components/PersonaLibrarySidebar';
import { SettingsScreen } from './components/SettingsScreen';
import { ThreadSidebar } from './components/ThreadSidebar';
import { api, getApiBaseUrl, setApiBaseUrl } from './lib/api';
import { useI18n } from './lib/i18n';
import { Conversation, ConversationBundle, PersonaDetail, PersonaSummary, ShellView, WorkbenchRun } from './lib/types';

const ACTIVE_VIEW_KEY = 'neeko.desktop.activeView';
const PERSONA_KEY = 'neeko.desktop.selectedPersona';
const THREAD_KEY = 'neeko.desktop.selectedThread';
const REPO_ROOT_KEY = 'neeko.desktop.repoRoot';
const DATA_DIR_KEY = 'neeko.desktop.dataDir';

type BootstrapWorkbenchServiceResult = {
  status: 'spawned' | 'already_running';
  port: number;
  runtime_root?: string | null;
};

export default function App() {
  const { locale } = useI18n();
  const isZh = locale === 'zh-CN';
  const [activeView, setActiveView] = useState<ShellView>(() => {
    const stored = window.localStorage.getItem(ACTIVE_VIEW_KEY) as ShellView | null;
    return stored === 'personas' || stored === 'settings' ? stored : 'chat';
  });
  const [apiBaseUrl, setApiBaseUrlState] = useState(getApiBaseUrl());
  const [repoRoot, setRepoRoot] = useState(window.localStorage.getItem(REPO_ROOT_KEY) ?? '');
  const [dataDir, setDataDir] = useState(window.localStorage.getItem(DATA_DIR_KEY) ?? '');
  const [serviceHealthy, setServiceHealthy] = useState(false);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [selectedPersonaSlug, setSelectedPersonaSlug] = useState<string | null>(() => window.localStorage.getItem(PERSONA_KEY));
  const [selectedPersonaDetail, setSelectedPersonaDetail] = useState<PersonaDetail | null>(null);
  const [personaScreenMode, setPersonaScreenMode] = useState<'view' | 'create'>('view');
  const [threads, setThreads] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(() => window.localStorage.getItem(THREAD_KEY));
  const [bundle, setBundle] = useState<ConversationBundle | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentRun, setCurrentRun] = useState<WorkbenchRun | null>(null);

  const selectedPersonaSummary = useMemo(
    () => personas.find((item) => item.slug === selectedPersonaSlug) ?? null,
    [personas, selectedPersonaSlug]
  );

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_VIEW_KEY, activeView);
  }, [activeView]);

  useEffect(() => {
    if (selectedPersonaSlug) window.localStorage.setItem(PERSONA_KEY, selectedPersonaSlug);
    else window.localStorage.removeItem(PERSONA_KEY);
  }, [selectedPersonaSlug]);

  useEffect(() => {
    if (selectedConversationId) window.localStorage.setItem(THREAD_KEY, selectedConversationId);
    else window.localStorage.removeItem(THREAD_KEY);
  }, [selectedConversationId]);

  useEffect(() => {
    if (repoRoot.trim()) window.localStorage.setItem(REPO_ROOT_KEY, repoRoot.trim());
    else window.localStorage.removeItem(REPO_ROOT_KEY);
  }, [repoRoot]);

  useEffect(() => {
    if (dataDir.trim()) window.localStorage.setItem(DATA_DIR_KEY, dataDir.trim());
    else window.localStorage.removeItem(DATA_DIR_KEY);
  }, [dataDir]);

  useEffect(() => {
    if (!selectedPersonaSlug) {
      setSelectedPersonaDetail(null);
      setThreads([]);
      setSelectedConversationId(null);
      setBundle(null);
      return;
    }
    void refreshPersonaDetail(selectedPersonaSlug);
    void refreshThreads(selectedPersonaSlug);
  }, [selectedPersonaSlug]);

  useEffect(() => {
    if (!selectedConversationId) {
      setBundle(null);
      return;
    }
    void refreshConversation(selectedConversationId);
  }, [selectedConversationId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!currentRun || currentRun.status !== 'running') return;
    const timer = window.setInterval(async () => {
      try {
        const nextRun = await api.getRun(currentRun.id);
        setCurrentRun(nextRun);
        if (nextRun.status !== 'running') {
          await refreshPersonas();
          if (selectedPersonaSlug) {
            await refreshPersonaDetail(selectedPersonaSlug);
            await refreshThreads(selectedPersonaSlug);
          }
          if (nextRun.status === 'completed') {
            setNotice(isZh ? '后台处理已完成。' : 'Background update completed.');
          } else if (nextRun.status === 'failed') {
            setNotice(isZh ? '后台处理暂时中断，请稍后重试。' : 'Background update paused. Please try again later.');
          }
        }
      } catch {
        // Keep polling quiet for user-facing UI.
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [currentRun, selectedPersonaSlug, isZh]);

  async function initialize() {
    const connected = await refreshHealth({ allowRecover: true, silent: true });
    if (!connected) return;
    await refreshPersonas();
  }

  async function refreshHealth(options: { allowRecover?: boolean; silent?: boolean; baseUrl?: string } = {}): Promise<boolean> {
    const { allowRecover = true, silent = false, baseUrl } = options;
    const targetBaseUrl = baseUrl ?? apiBaseUrl;
    try {
      await api.health();
      setServiceHealthy(true);
      setError(null);
      return true;
    } catch (nextError) {
      setServiceHealthy(false);
      if (allowRecover && canBootstrapLocalService(targetBaseUrl)) {
        const recovered = await attemptServiceRecovery(targetBaseUrl);
        if (recovered) return true;
      }
      if (!silent) setError(toUserMessage(nextError, isZh));
      return false;
    }
  }

  async function refreshPersonas() {
    try {
      const nextPersonas = await api.listPersonas();
      setPersonas(nextPersonas);
      if (!selectedPersonaSlug && nextPersonas[0]) {
        setSelectedPersonaSlug(nextPersonas[0].slug);
      } else if (selectedPersonaSlug && !nextPersonas.some((item) => item.slug === selectedPersonaSlug)) {
        setSelectedPersonaSlug(nextPersonas[0]?.slug ?? null);
      }
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    }
  }

  async function refreshPersonaDetail(slug: string) {
    try {
      const detail = await api.getPersonaDetail(slug);
      setSelectedPersonaDetail(detail);
      setError(null);
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    }
  }

  async function refreshThreads(slug: string) {
    try {
      const nextThreads = await api.listConversations(slug);
      setThreads(nextThreads);
      if (nextThreads.length === 0) {
        setSelectedConversationId(null);
        return;
      }
      if (!selectedConversationId || !nextThreads.some((item) => item.id === selectedConversationId)) {
        setSelectedConversationId(nextThreads[0].id);
      }
      setError(null);
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    }
  }

  async function refreshConversation(conversationId: string) {
    try {
      const nextBundle = await api.getConversation(conversationId);
      setBundle(nextBundle);
      setError(null);
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    }
  }

  async function handleCreateConversation() {
    if (!selectedPersonaSlug) {
      setActiveView('personas');
      setNotice(isZh ? '请先创建或选择一个人格。' : 'Select or create a persona first.');
      return;
    }
    try {
      const conversation = await api.createConversation(selectedPersonaSlug);
      await refreshThreads(selectedPersonaSlug);
      setSelectedConversationId(conversation.id);
      setActiveView('chat');
      setError(null);
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    }
  }

  async function handleRenameConversation() {
    if (!selectedConversationId) return;
    const current = threads.find((item) => item.id === selectedConversationId);
    const nextTitle = window.prompt(isZh ? '请输入新的线程名称' : 'Enter a new thread title', current?.title ?? '');
    if (!nextTitle?.trim()) return;
    try {
      await api.renameConversation(selectedConversationId, nextTitle.trim());
      if (selectedPersonaSlug) await refreshThreads(selectedPersonaSlug);
      await refreshConversation(selectedConversationId);
      setNotice(isZh ? '线程已重命名。' : 'Thread renamed.');
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    }
  }

  async function handleDeleteConversation() {
    if (!selectedConversationId || !selectedPersonaSlug) return;
    const confirmed = window.confirm(isZh ? '确认删除这个线程吗？' : 'Delete this thread?');
    if (!confirmed) return;
    try {
      await api.deleteConversation(selectedConversationId);
      await refreshThreads(selectedPersonaSlug);
      setBundle(null);
      setNotice(isZh ? '线程已删除。' : 'Thread deleted.');
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    }
  }

  async function handleSendMessage(message: string) {
    if (!selectedPersonaSlug) return;
    setChatLoading(true);
    try {
      let conversationId = selectedConversationId;
      if (!conversationId) {
        const conversation = await api.createConversation(selectedPersonaSlug);
        conversationId = conversation.id;
        setSelectedConversationId(conversation.id);
      }
      const nextBundle = await api.sendMessage(conversationId, message);
      setBundle(nextBundle);
      await refreshThreads(selectedPersonaSlug);
      setNotice(isZh ? '消息已发送。' : 'Message sent.');
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    } finally {
      setChatLoading(false);
    }
  }

  async function handleCopyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setNotice(isZh ? '已复制到剪贴板。' : 'Copied to clipboard.');
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    }
  }

  async function handleCreatePersona(payload: CreatePayload) {
    try {
      const result = await api.createPersona(payload as unknown as Record<string, unknown>);
      setCurrentRun(result.run);
      setSelectedPersonaSlug(result.persona.slug);
      setPersonaScreenMode('view');
      setActiveView('personas');
      await refreshPersonas();
      await refreshPersonaDetail(result.persona.slug);
      setNotice(isZh ? '人格已开始创建，系统正在后台处理。' : 'Persona creation started in the background.');
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    }
  }

  async function handleSavePersona(slug: string, payload: CreatePayload) {
    try {
      const result = await api.updatePersona(slug, payload as unknown as Record<string, unknown>);
      setCurrentRun(result.run);
      await refreshPersonas();
      await refreshPersonaDetail(slug);
      setNotice(isZh ? '修改已保存，系统正在后台重建。' : 'Changes saved. Background rebuild started.');
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    }
  }

  async function handleDeletePersona(slug: string) {
    const confirmed = window.confirm(isZh ? '确认彻底删除这个人格及其本地资产吗？' : 'Delete this persona and all local assets?');
    if (!confirmed) return;
    try {
      await api.deletePersona(slug);
      const remaining = personas.filter((item) => item.slug !== slug);
      setSelectedPersonaSlug(remaining[0]?.slug ?? null);
      setSelectedConversationId(null);
      setBundle(null);
      setPersonaScreenMode('view');
      await refreshPersonas();
      setNotice(isZh ? '人格已删除。' : 'Persona deleted.');
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    }
  }

  async function handleStartChat(slug: string) {
    setSelectedPersonaSlug(slug);
    setActiveView('chat');
    setPersonaScreenMode('view');
    try {
      const nextThreads = await api.listConversations(slug);
      if (nextThreads.length === 0) {
        const conversation = await api.createConversation(slug);
        setSelectedConversationId(conversation.id);
      } else {
        setSelectedConversationId(nextThreads[0].id);
      }
      await refreshThreads(slug);
    } catch (nextError) {
      setError(toUserMessage(nextError, isZh));
    }
  }

  async function handleRefreshConnection() {
    const connected = await refreshHealth({ allowRecover: true, silent: false });
    if (!connected) return;
    await refreshPersonas();
    if (selectedPersonaSlug) {
      await refreshPersonaDetail(selectedPersonaSlug);
      await refreshThreads(selectedPersonaSlug);
    }
    setNotice(isZh ? '连接已刷新。' : 'Connection refreshed.');
  }

  async function attemptServiceRecovery(baseUrl: string): Promise<boolean> {
    if (!canBootstrapLocalService(baseUrl)) return false;
    try {
      const result = await bootstrapWorkbenchService(getLocalWorkbenchPort(baseUrl), repoRoot);
      const recovered = await waitForServiceHealth();
      if (!recovered) return false;
      setServiceHealthy(true);
      if (result.runtime_root) setRepoRoot(result.runtime_root);
      setNotice(isZh ? '本地服务已自动恢复。' : 'Local service recovered.');
      return true;
    } catch {
      return false;
    }
  }

  function handleApiBaseUrlChange(value: string) {
    setApiBaseUrlState(value);
    setApiBaseUrl(value);
  }

  const sidebar = activeView === 'chat' ? (
    <ThreadSidebar
      personas={personas}
      selectedPersonaSlug={selectedPersonaSlug}
      selectedConversationId={selectedConversationId}
      threads={threads}
      onSelectPersona={(slug) => {
        setSelectedPersonaSlug(slug);
        setPersonaScreenMode('view');
      }}
      onSelectConversation={setSelectedConversationId}
      onCreateConversation={() => void handleCreateConversation()}
      onRenameConversation={() => void handleRenameConversation()}
      onDeleteConversation={() => void handleDeleteConversation()}
    />
  ) : activeView === 'personas' ? (
    <PersonaLibrarySidebar
      personas={personas}
      selectedPersonaSlug={selectedPersonaSlug}
      onSelectPersona={(slug) => {
        setSelectedPersonaSlug(slug);
        setPersonaScreenMode('view');
      }}
      onCreatePersona={() => {
        setPersonaScreenMode('create');
        setActiveView('personas');
      }}
    />
  ) : (
    <aside className="sidebar-panel settings-side-panel">
      <p className="sidebar-eyebrow">{isZh ? '设置' : 'Settings'}</p>
      <h2>{isZh ? '基础连接与语言' : 'Connection and Language'}</h2>
      <p className="empty-note">{isZh ? '这里不再展示任何训练或内部控制项。' : 'Internal controls stay hidden from this surface.'}</p>
    </aside>
  );

  return (
    <div className="app-shell">
      <MiniRail activeView={activeView} onChangeView={setActiveView} />
      {sidebar}
      <main className="main-stage">
        {error ? <div className="error-banner">{error}</div> : null}
        {notice ? <div className="notice-banner">{notice}</div> : null}
        {activeView === 'chat' ? (
          <ChatWorkspace
            persona={selectedPersonaSummary}
            bundle={bundle}
            loading={chatLoading}
            onSend={handleSendMessage}
            onCopyMessage={handleCopyMessage}
          />
        ) : null}
        {activeView === 'personas' ? (
          <PersonaLibraryScreen
            detail={personaScreenMode === 'create' ? null : selectedPersonaDetail}
            run={currentRun}
            mode={personaScreenMode}
            onCreate={handleCreatePersona}
            onSave={handleSavePersona}
            onDelete={handleDeletePersona}
            onStartChat={handleStartChat}
            onCancelCreate={() => setPersonaScreenMode('view')}
          />
        ) : null}
        {activeView === 'settings' ? (
          <SettingsScreen
            apiBaseUrl={apiBaseUrl}
            repoRoot={repoRoot}
            dataDir={dataDir}
            serviceHealthy={serviceHealthy}
            onApiBaseUrlChange={handleApiBaseUrlChange}
            onRepoRootChange={setRepoRoot}
            onDataDirChange={setDataDir}
            onRefreshConnection={handleRefreshConnection}
          />
        ) : null}
      </main>
    </div>
  );
}

function toUserMessage(error: unknown, isZh: boolean): string {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (message.includes('persona') && message.includes('not')) return isZh ? '这个人格当前不可用。' : 'This persona is not available right now.';
  if (message.includes('conversation') || message.includes('thread')) return isZh ? '这个线程当前不可用。' : 'This thread is not available right now.';
  if (message.includes('required') || message.includes('missing')) return isZh ? '还有必填信息未补充完整。' : 'Some required information is still missing.';
  if (message.includes('absolute') || message.includes('path')) return isZh ? '请使用有效的本地绝对路径。' : 'Please use a valid absolute local path.';
  if (message.includes('timeout') || message.includes('network') || message.includes('fetch') || message.includes('connection')) {
    return isZh ? '本地服务正在处理临时问题，请稍后再试。' : 'The local service is handling a temporary issue. Please try again shortly.';
  }
  return isZh ? '当前操作暂时无法完成，请稍后再试。' : 'This action could not be completed right now.';
}

function canBootstrapLocalService(baseUrl: string): boolean {
  if (!isTauriRuntime()) return false;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:') return false;
    return ['127.0.0.1', 'localhost'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function getLocalWorkbenchPort(baseUrl: string): number {
  try {
    const parsed = new URL(baseUrl);
    return parsed.port ? Number(parsed.port) : 4310;
  } catch {
    return 4310;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function bootstrapWorkbenchService(port: number, repoRoot?: string): Promise<BootstrapWorkbenchServiceResult> {
  return invoke<BootstrapWorkbenchServiceResult>('bootstrap_workbench_service', {
    port,
    repoRoot: repoRoot?.trim() || undefined,
  });
}

async function waitForServiceHealth(attempts = 12, delayMs = 700): Promise<boolean> {
  for (let index = 0; index < attempts; index += 1) {
    try {
      await api.health();
      return true;
    } catch {
      await sleep(delayMs);
    }
  }
  return false;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}
