import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChatWorkspace } from './components/ChatWorkspace';
import { ConversationSidebar } from './components/ConversationSidebar';
import { InspectorDrawer } from './components/InspectorDrawer';
import { MiniRail } from './components/MiniRail';
import { SettingsScreen } from './components/SettingsScreen';
import { api, getApiBaseUrl, setApiBaseUrl } from './lib/api';
import { formatCopyLabel, useI18n } from './lib/i18n';
import {
  Conversation,
  ConversationBundle,
  InfoTab,
  MemoryCandidate,
  NavView,
  PersonaSummary,
  PersonaWorkbenchProfile,
  PromotionHandoff,
  SettingsSection,
  ShellView,
  TrainingPrepArtifact,
  WorkbenchEvidenceImport,
  WorkbenchEvidenceImportDetail,
  WorkbenchMemoryNode,
  WorkbenchMemorySourceAsset,
  WorkbenchRun,
  WorkbenchRunReport,
} from './lib/types';

const LEGACY_ACTIVE_VIEW_KEY = 'neeko.workbench.activeView';
const ACTIVE_SHELL_VIEW_KEY = 'neeko.workbench.shellView';
const ACTIVE_SETTINGS_SECTION_KEY = 'neeko.workbench.settingsSection';
const ACTIVE_TAB_KEY = 'neeko.workbench.activeTab';
const PERSONA_KEY = 'neeko.workbench.selectedPersona';
const THREAD_KEY = 'neeko.workbench.selectedConversation';
const FORM_DEFAULTS_KEY = 'neeko.workbench.formDefaults';
const WORKBENCH_REPO_ROOT_KEY = 'neeko.workbench.repoRoot';

const SETTINGS_SECTIONS: SettingsSection[] = ['persona', 'training', 'experiment', 'export', 'runtime'];
const INSPECTOR_TABS: InfoTab[] = ['Soul', 'Memory', 'Citations', 'Evidence', 'Training'];

type WorkbenchFormDefaults = {
  createTarget: string;
  createTargetManifest: string;
  createChatPlatform: string;
  rounds: string;
  trainingProfile: string;
  inputRouting: string;
  trainingSeedMode: string;
  kimiStabilityMode: string;
  trainMode: string;
  trainTrack: string;
  trainRetries: string;
  trainFromCheckpoint: string;
  trainPrepDocumentsPath: string;
  trainPrepEvidencePath: string;
  trainPrepArtifactId: string;
  trainEvidenceImportId: string;
  experimentProfiles: string;
  questionsPerRound: string;
  experimentCompareVariants: string;
  experimentOutputDir: string;
  experimentGate: boolean;
  experimentCompareInputRouting: boolean;
  experimentCompareTrainingSeed: boolean;
  exportFormat: string;
  exportOutputDir: string;
};

type ServiceConnectionState = 'checking' | 'connected' | 'recovering' | 'offline';

type BootstrapWorkbenchServiceResult = {
  status: 'spawned' | 'already_running';
  port: number;
  runtime_root?: string | null;
};

type WorkbenchBootstrapStatus = {
  mode: 'ready' | 'preparing_core' | 'missing_node' | 'needs_repo_root';
  resolved_runtime_root?: string | null;
  node_available: boolean;
  node_source: 'bundled' | 'system' | 'missing';
  dist_ready: boolean;
  service_managed: boolean;
  message: string;
};

function toUserMessage(error: unknown, t: (value: string) => string): string {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();

  if (message.includes('clipboard')) return t('Clipboard access is not available right now. Please try again.');
  if (message.includes('conversation not found') || message.includes('thread not found')) return t('This thread is no longer available.');
  if (message.includes('persona not found') || message.includes('profile not found')) return t('This persona is no longer available.');
  if (message.includes('run not found')) return t('This run is no longer available.');
  if (
    message.includes('candidate not found') ||
    message.includes('handoff not found') ||
    message.includes('training prep not found') ||
    message.includes('not found')
  ) {
    return t('The requested item is no longer available.');
  }
  if (message.includes('required') || message.includes('missing')) return t('Some required information is still missing.');
  if (message.includes('absolute local file path')) return t('Please use an absolute local file path for this import.');
  if (message.includes('choose a file instead of a folder')) return t('Please choose a file instead of a folder for this import.');
  if (message.includes('valid json target manifest')) return t('Please choose a valid JSON target manifest file.');
  if (message.includes('must be different files')) return t('Source and target manifest must be different files.');
  if (message.includes('selected files is not available')) return t('One of the selected files is not available right now.');
  if (message.includes('qdrant') || message.includes('memory service')) return t('The local memory service is still getting ready. Please try again shortly.');
  if (message.includes('timeout') || message.includes('fetch') || message.includes('network') || message.includes('connection')) {
    return t('The workbench is handling a temporary issue. Please try again shortly.');
  }
  return t('The workbench could not finish this action right now.');
}

export default function App() {
  const { locale, t } = useI18n();
  const initialDefaults = (() => {
    try {
      const raw = window.localStorage.getItem(FORM_DEFAULTS_KEY);
      const parsed = raw ? JSON.parse(raw) as Partial<WorkbenchFormDefaults> : {};
      return {
        createTarget: parsed.createTarget ?? '',
        createTargetManifest: parsed.createTargetManifest ?? '',
        createChatPlatform: parsed.createChatPlatform ?? 'wechat',
        rounds: parsed.rounds ?? '1',
        trainingProfile: parsed.trainingProfile ?? 'full',
        inputRouting: parsed.inputRouting ?? 'legacy',
        trainingSeedMode: parsed.trainingSeedMode ?? 'off',
        kimiStabilityMode: parsed.kimiStabilityMode ?? 'standard',
        trainMode: parsed.trainMode ?? 'quick',
        trainTrack: parsed.trainTrack ?? 'full_serial',
        trainRetries: parsed.trainRetries ?? '2',
        trainFromCheckpoint: parsed.trainFromCheckpoint ?? '',
        trainPrepDocumentsPath: parsed.trainPrepDocumentsPath ?? '',
        trainPrepEvidencePath: parsed.trainPrepEvidencePath ?? '',
        trainPrepArtifactId: parsed.trainPrepArtifactId ?? '',
        trainEvidenceImportId: parsed.trainEvidenceImportId ?? '',
        experimentProfiles: parsed.experimentProfiles ?? '',
        questionsPerRound: parsed.questionsPerRound ?? '5',
        experimentCompareVariants: parsed.experimentCompareVariants ?? '',
        experimentOutputDir: parsed.experimentOutputDir ?? '',
        experimentGate: parsed.experimentGate ?? false,
        experimentCompareInputRouting: parsed.experimentCompareInputRouting ?? true,
        experimentCompareTrainingSeed: parsed.experimentCompareTrainingSeed ?? false,
        exportFormat: parsed.exportFormat ?? 'openclaw',
        exportOutputDir: parsed.exportOutputDir ?? '',
      };
    } catch {
      return {
        createTarget: '',
        createTargetManifest: '',
        createChatPlatform: 'wechat',
        rounds: '1',
        trainingProfile: 'full',
        inputRouting: 'legacy',
        trainingSeedMode: 'off',
        kimiStabilityMode: 'standard',
        trainMode: 'quick',
        trainTrack: 'full_serial',
        trainRetries: '2',
        trainFromCheckpoint: '',
        trainPrepDocumentsPath: '',
        trainPrepEvidencePath: '',
        trainPrepArtifactId: '',
        trainEvidenceImportId: '',
        experimentProfiles: '',
        questionsPerRound: '5',
        experimentCompareVariants: '',
        experimentOutputDir: '',
        experimentGate: false,
        experimentCompareInputRouting: true,
        experimentCompareTrainingSeed: false,
        exportFormat: 'openclaw',
        exportOutputDir: '',
      };
    }
  })();

  const [activeShellView, setActiveShellView] = useState<ShellView>(() => deriveInitialShellView());
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>(() => deriveInitialSettingsSection());
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<InfoTab>(() => deriveInitialInspectorTab());
  const [apiBaseUrl, setApiBaseUrlState] = useState(getApiBaseUrl());
  const [serviceHealthy, setServiceHealthy] = useState(false);
  const [serviceConnectionState, setServiceConnectionState] = useState<ServiceConnectionState>('checking');
  const [workbenchRepoRoot, setWorkbenchRepoRoot] = useState(() => window.localStorage.getItem(WORKBENCH_REPO_ROOT_KEY) ?? '');
  const [bootstrapStatus, setBootstrapStatus] = useState<WorkbenchBootstrapStatus | null>(null);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [selectedPersonaSlug, setSelectedPersonaSlug] = useState<string | null>(() => window.localStorage.getItem(PERSONA_KEY));
  const [selectedPersona, setSelectedPersona] = useState<PersonaWorkbenchProfile | null>(null);
  const [threads, setThreads] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(() => window.localStorage.getItem(THREAD_KEY));
  const [bundle, setBundle] = useState<ConversationBundle | null>(null);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [promotionHandoffs, setPromotionHandoffs] = useState<PromotionHandoff[]>([]);
  const [evidenceImports, setEvidenceImports] = useState<WorkbenchEvidenceImport[]>([]);
  const [selectedEvidenceImportId, setSelectedEvidenceImportId] = useState<string | null>(null);
  const [selectedEvidenceImportDetail, setSelectedEvidenceImportDetail] = useState<WorkbenchEvidenceImportDetail | null>(null);
  const [trainingPreps, setTrainingPreps] = useState<TrainingPrepArtifact[]>([]);
  const [selectedMemoryNode, setSelectedMemoryNode] = useState<WorkbenchMemoryNode | null>(null);
  const [selectedMemorySourceAssets, setSelectedMemorySourceAssets] = useState<WorkbenchMemorySourceAsset[]>([]);
  const [recentRuns, setRecentRuns] = useState<WorkbenchRun[]>([]);
  const [currentRun, setCurrentRun] = useState<WorkbenchRun | null>(null);
  const [runReport, setRunReport] = useState<WorkbenchRunReport | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formDefaults, setFormDefaults] = useState(initialDefaults);

  function reportError(nextError: unknown) {
    setError(toUserMessage(nextError, t));
  }

  useEffect(() => {
    void initializeWorkbench();
  }, []);

  useEffect(() => {
    if (!selectedPersonaSlug) return;
    setSelectedMemoryNode(null);
    setSelectedMemorySourceAssets([]);
    void refreshPersona(selectedPersonaSlug);
    void refreshThreads(selectedPersonaSlug);
    void refreshRuns(selectedPersonaSlug);
  }, [selectedPersonaSlug]);

  useEffect(() => {
    if (!selectedConversationId) {
      setBundle(null);
      setCandidates([]);
      setPromotionHandoffs([]);
      setEvidenceImports([]);
      setSelectedEvidenceImportId(null);
      setSelectedEvidenceImportDetail(null);
      setTrainingPreps([]);
      setSelectedMemoryNode(null);
      setSelectedMemorySourceAssets([]);
      return;
    }
    void refreshConversation(selectedConversationId);
  }, [selectedConversationId]);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_SHELL_VIEW_KEY, activeShellView);
  }, [activeShellView]);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_SETTINGS_SECTION_KEY, activeSettingsSection);
  }, [activeSettingsSection]);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (selectedPersonaSlug) window.localStorage.setItem(PERSONA_KEY, selectedPersonaSlug);
    else window.localStorage.removeItem(PERSONA_KEY);
  }, [selectedPersonaSlug]);

  useEffect(() => {
    if (selectedConversationId) window.localStorage.setItem(THREAD_KEY, selectedConversationId);
    else window.localStorage.removeItem(THREAD_KEY);
  }, [selectedConversationId]);

  useEffect(() => {
    window.localStorage.setItem(FORM_DEFAULTS_KEY, JSON.stringify(formDefaults));
  }, [formDefaults]);

  useEffect(() => {
    if (workbenchRepoRoot.trim()) window.localStorage.setItem(WORKBENCH_REPO_ROOT_KEY, workbenchRepoRoot.trim());
    else window.localStorage.removeItem(WORKBENCH_REPO_ROOT_KEY);
  }, [workbenchRepoRoot]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const timer = window.setTimeout(() => {
      void refreshBootstrapStatus(workbenchRepoRoot);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [workbenchRepoRoot]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!currentRun || currentRun.status !== 'running') return;
    const timer = window.setInterval(async () => {
      try {
        const report = await api.getRunReport(currentRun.id).catch(() => null);
        if (report) {
          setCurrentRun(report.run);
          setRunReport(report);
        } else {
          const run = await api.getRun(currentRun.id);
          setCurrentRun(run);
        }
        if ((report?.run.status ?? currentRun.status) !== 'running') {
          await refreshPersonas();
          await refreshRuns(selectedPersonaSlug ?? undefined);
        }
      } catch (err) {
        reportError(err);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [currentRun, selectedPersonaSlug]);

  const selectedPersonaSummary = useMemo(
    () => personas.find((item) => item.slug === selectedPersonaSlug) ?? null,
    [personas, selectedPersonaSlug]
  );

  async function initializeWorkbench() {
    await refreshBootstrapStatus(workbenchRepoRoot);
    const connected = await refreshHealth({ allowRecover: true, silent: true });
    if (connected) await refreshPersonas();
  }

  async function refreshHealth(options: { allowRecover?: boolean; silent?: boolean; baseUrl?: string } = {}): Promise<boolean> {
    const { allowRecover = true, silent = false, baseUrl } = options;
    const targetBaseUrl = baseUrl ?? apiBaseUrl;
    setServiceConnectionState('checking');
    try {
      await api.health();
      setServiceHealthy(true);
      setServiceConnectionState('connected');
      setError(null);
      return true;
    } catch (err) {
      setServiceHealthy(false);
      if (allowRecover && canBootstrapLocalService(targetBaseUrl)) {
        const recovered = await attemptServiceRecovery(targetBaseUrl);
        if (recovered) return true;
      }
      setServiceConnectionState('offline');
      if (!silent) reportError(err);
      return false;
    }
  }

  async function refreshPersonas() {
    try {
      const data = await api.listPersonas();
      setPersonas(data);
      if (!selectedPersonaSlug && data[0]) setSelectedPersonaSlug(data[0].slug);
    } catch (err) {
      reportError(err);
    }
  }

  async function refreshPersona(slug: string) {
    try {
      const profile = await api.getPersona(slug);
      setSelectedPersona(profile);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function refreshThreads(slug: string) {
    try {
      const data = await api.listConversations(slug);
      setThreads(data);
      if (data.length > 0 && (!selectedConversationId || !data.some((item) => item.id === selectedConversationId))) {
        setSelectedConversationId(data[0].id);
      }
      if (data.length === 0) setSelectedConversationId(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function refreshConversation(id: string) {
    try {
      const nextBundle = await api.getConversation(id);
      const nextCandidates = await api.listMemoryCandidates(id);
      const nextHandoffs = selectedPersonaSlug ? await api.listPromotionHandoffs(selectedPersonaSlug, id) : [];
      const nextImports = selectedPersonaSlug ? await api.listEvidenceImports(selectedPersonaSlug, id) : [];
      const nextTrainingPreps = selectedPersonaSlug ? await api.listTrainingPreps(selectedPersonaSlug, id) : [];
      setBundle(nextBundle);
      setCandidates(nextCandidates);
      setPromotionHandoffs(nextHandoffs);
      setEvidenceImports(nextImports);
      setSelectedEvidenceImportId((current) => {
        if (current && nextImports.some((item) => item.id === current)) return current;
        return nextImports[0]?.id ?? null;
      });
      if (selectedEvidenceImportDetail && !nextImports.some((item) => item.id === selectedEvidenceImportDetail.import.id)) {
        setSelectedEvidenceImportDetail(null);
      }
      setTrainingPreps(nextTrainingPreps);
      setSelectedMemoryNode(null);
      setSelectedMemorySourceAssets([]);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function refreshRuns(personaSlug?: string) {
    try {
      const runs = await api.listRuns(personaSlug);
      setRecentRuns(runs);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleCreateConversation() {
    if (!selectedPersonaSlug) return;
    try {
      const conversation = await api.createConversation(selectedPersonaSlug);
      await refreshThreads(selectedPersonaSlug);
      setSelectedConversationId(conversation.id);
      setActiveShellView('chat');
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleRenameConversation() {
    if (!selectedConversationId) return;
    const current = threads.find((item) => item.id === selectedConversationId);
    const nextTitle = window.prompt(t('Rename thread'), current?.title ?? '');
    if (!nextTitle || !nextTitle.trim()) return;
    try {
      await api.renameConversation(selectedConversationId, nextTitle.trim());
      if (selectedPersonaSlug) await refreshThreads(selectedPersonaSlug);
      await refreshConversation(selectedConversationId);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleDeleteConversation() {
    if (!selectedConversationId || !selectedPersonaSlug) return;
    const confirmed = window.confirm(t('Delete this thread and its local conversation assets?'));
    if (!confirmed) return;
    try {
      await api.deleteConversation(selectedConversationId);
      await refreshThreads(selectedPersonaSlug);
      setBundle(null);
      setCandidates([]);
      setPromotionHandoffs([]);
      setEvidenceImports([]);
      setSelectedEvidenceImportId(null);
      setSelectedEvidenceImportDetail(null);
      setTrainingPreps([]);
      setSelectedMemoryNode(null);
      setSelectedMemorySourceAssets([]);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleRefreshSummary() {
    if (!selectedConversationId || !selectedPersonaSlug) return;
    try {
      const nextBundle = await api.refreshConversationSummary(selectedConversationId);
      const nextCandidates = await api.listMemoryCandidates(selectedConversationId);
      const nextHandoffs = await api.listPromotionHandoffs(selectedPersonaSlug, selectedConversationId);
      const nextImports = await api.listEvidenceImports(selectedPersonaSlug, selectedConversationId);
      const nextTrainingPreps = await api.listTrainingPreps(selectedPersonaSlug, selectedConversationId);
      setBundle(nextBundle);
      setCandidates(nextCandidates);
      setPromotionHandoffs(nextHandoffs);
      setEvidenceImports(nextImports);
      setSelectedEvidenceImportId((current) => current && nextImports.some((item) => item.id === current) ? current : nextImports[0]?.id ?? null);
      setTrainingPreps(nextTrainingPreps);
      setSelectedMemoryNode(null);
      setSelectedMemorySourceAssets([]);
      await refreshThreads(selectedPersonaSlug);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleSendMessage(message: string) {
    if (!selectedPersonaSlug) return;
    setChatLoading(true);
    try {
      let conversationId = selectedConversationId;
      if (!conversationId) {
        const created = await api.createConversation(selectedPersonaSlug);
        conversationId = created.id;
        setSelectedConversationId(created.id);
        await refreshThreads(selectedPersonaSlug);
      }
      const nextBundle = await api.sendMessage(conversationId, message);
      const nextCandidates = await api.listMemoryCandidates(conversationId);
      setBundle(nextBundle);
      setCandidates(nextCandidates);
      await refreshThreads(selectedPersonaSlug);
      setActiveTab('Citations');
      setNotice(t('Message sent.'));
      setError(null);
    } catch (err) {
      reportError(err);
    } finally {
      setChatLoading(false);
    }
  }

  async function launchRun(request: Promise<WorkbenchRun>, type: WorkbenchRun['type']) {
    try {
      const run = await request;
      setCurrentRun(run);
      setRunReport(null);
      setActiveShellView('settings');
      setActiveSettingsSection(mapRunTypeToSettingsSection(type));
      setActiveTab('Training');
      setInspectorOpen(true);
      await refreshRuns(selectedPersonaSlug ?? undefined);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleSelectRun(run: WorkbenchRun) {
    try {
      setCurrentRun(run);
      const report = await api.getRunReport(run.id).catch(() => null);
      setRunReport(report);
      setActiveTab('Training');
      setInspectorOpen(true);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleReviewCandidate(candidateId: string, status: MemoryCandidate['status']) {
    if (!selectedConversationId) return;
    try {
      const result = await api.reviewMemoryCandidate(selectedConversationId, candidateId, status);
      setCandidates(result.candidates);
      setNotice(t(`Candidate marked ${status}.`));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleCandidatePromotionState(candidateId: string, promotionState: MemoryCandidate['promotion_state']) {
    if (!selectedConversationId) return;
    try {
      const result = await api.setCandidatePromotionState(selectedConversationId, candidateId, promotionState);
      setCandidates(result.candidates);
      setNotice(t(promotionState === 'ready' ? 'Candidate added to promotion-ready queue.' : 'Candidate removed from promotion-ready queue.'));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleCreatePromotionHandoff() {
    if (!selectedConversationId || !selectedPersonaSlug) return;
    try {
      const handoff = await api.createPromotionHandoff(selectedConversationId);
      const nextHandoffs = await api.listPromotionHandoffs(selectedPersonaSlug, selectedConversationId);
      setPromotionHandoffs(nextHandoffs);
      setActiveTab('Memory');
      setInspectorOpen(true);
      setNotice(t('Promotion handoff created.'));
      setError(null);
      if (!nextHandoffs.some((item) => item.id === handoff.id)) setPromotionHandoffs((current) => [handoff, ...current]);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleUpdatePromotionHandoff(handoffId: string, status: PromotionHandoff['status']) {
    if (!selectedConversationId || !selectedPersonaSlug) return;
    try {
      await api.updatePromotionHandoff(handoffId, status);
      const nextHandoffs = await api.listPromotionHandoffs(selectedPersonaSlug, selectedConversationId);
      setPromotionHandoffs(nextHandoffs);
      setNotice(`${t('Handoff')} ${t(status)}`);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleExportPromotionHandoff(handoffId: string, format: 'markdown' | 'json') {
    try {
      const exported = await api.exportPromotionHandoff(handoffId, format);
      await navigator.clipboard.writeText(exported.content);
      setNotice(`${exported.filename} copied to clipboard.`);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleCreateTrainingPrep(handoffId: string) {
    if (!selectedPersonaSlug || !selectedConversationId) return;
    try {
      await api.createTrainingPrep(handoffId);
      const nextTrainingPreps = await api.listTrainingPreps(selectedPersonaSlug, selectedConversationId);
      setTrainingPreps(nextTrainingPreps);
      setNotice(t('Training prep artifact created.'));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleCopyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setNotice(t('Message copied to clipboard.'));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleCopyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${formatCopyLabel(label, locale)} ${t('copied to clipboard')}`);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleInspectMemory(memoryId: string) {
    if (!selectedPersonaSlug) return;
    try {
      const [node, assets] = await Promise.all([
        api.getMemoryNode(selectedPersonaSlug, memoryId),
        api.getMemoryNodeSourceAssets(selectedPersonaSlug, memoryId),
      ]);
      setSelectedMemoryNode(node);
      setSelectedMemorySourceAssets(assets);
      setActiveTab('Memory');
      setInspectorOpen(true);
      setNotice(t('Memory detail loaded.'));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleImportEvidence(payload: {
    sourceKind: 'chat' | 'video';
    sourcePath: string;
    targetManifestPath: string;
    chatPlatform?: 'wechat' | 'feishu';
  }) {
    if (!selectedPersonaSlug) return;
    setImportLoading(true);
    try {
      let conversationId = selectedConversationId;
      if (!conversationId) {
        const created = await api.createConversation(selectedPersonaSlug, 'Evidence Intake');
        conversationId = created.id;
        setSelectedConversationId(created.id);
      }
      const imported = await api.importEvidence(selectedPersonaSlug, {
        conversationId,
        sourceKind: payload.sourceKind,
        sourcePath: payload.sourcePath,
        targetManifestPath: payload.targetManifestPath,
        chatPlatform: payload.chatPlatform,
      });
      if (selectedPersonaSlug) await refreshThreads(selectedPersonaSlug);
      if (conversationId) await refreshConversation(conversationId);
      const detail = await api.getEvidenceImportDetail(imported.id).catch(() => null);
      setSelectedEvidenceImportId(imported.id);
      if (detail) setSelectedEvidenceImportDetail(detail);
      setNotice(payload.sourceKind === 'chat' ? t('聊天证据已导入工作台。') : t('视频证据已导入工作台。'));
      setError(null);
    } catch (err) {
      reportError(err);
    } finally {
      setImportLoading(false);
    }
  }

  function handleUseEvidenceImport(item: WorkbenchEvidenceImport) {
    setFormDefaults((current) => ({
      ...current,
      trainPrepDocumentsPath: item.artifacts.documents_path,
      trainPrepEvidencePath: item.artifacts.evidence_index_path,
      trainPrepArtifactId: '',
      trainEvidenceImportId: item.id,
    }));
    setActiveShellView('settings');
    setActiveSettingsSection('training');
    setActiveTab('Training');
      setNotice(t('Evidence intake has been attached to the train form.'));
    setError(null);
  }

  async function handleInspectEvidenceImport(importId: string) {
    try {
      const detail = await api.getEvidenceImportDetail(importId);
      setSelectedEvidenceImportId(importId);
      setSelectedEvidenceImportDetail(detail);
      setActiveTab('Evidence');
      setInspectorOpen(true);
      setNotice(t('Evidence detail loaded.'));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  function handleUseTrainingPrep(prep: TrainingPrepArtifact) {
    setFormDefaults((current) => ({
      ...current,
      trainPrepDocumentsPath: prep.documents_path,
      trainPrepEvidencePath: prep.evidence_index_path,
      trainPrepArtifactId: prep.id,
      trainEvidenceImportId: '',
    }));
    setActiveShellView('settings');
    setActiveSettingsSection('training');
    setActiveTab('Training');
      setNotice(t('Training prep has been attached to the train form.'));
    setError(null);
  }

  async function handleExportTrainingPrep(prepId: string, format: 'markdown' | 'json') {
    try {
      const exported = await api.exportTrainingPrep(prepId, format);
      await navigator.clipboard.writeText(exported.content);
      setNotice(`${exported.filename} copied to clipboard.`);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  function handleApiBaseUrlChange(value: string) {
    setApiBaseUrlState(value);
    setApiBaseUrl(value);
    void refreshHealth({ allowRecover: true, silent: false, baseUrl: value });
  }

  async function handleRefreshConnection() {
    await refreshBootstrapStatus(workbenchRepoRoot);
    const connected = await refreshHealth({ allowRecover: true, silent: false });
    if (connected) {
      await refreshPersonas();
      if (selectedPersonaSlug) {
        await refreshPersona(selectedPersonaSlug);
        await refreshThreads(selectedPersonaSlug);
        await refreshRuns(selectedPersonaSlug);
      }
    }
  }

  async function attemptServiceRecovery(baseUrl: string): Promise<boolean> {
    if (!canBootstrapLocalService(baseUrl)) return false;
    setServiceConnectionState('recovering');
    try {
      const result = await bootstrapWorkbenchService(getLocalWorkbenchPort(baseUrl), workbenchRepoRoot);
      const recovered = await waitForServiceHealth();
      if (!recovered) {
        await refreshBootstrapStatus(workbenchRepoRoot);
        return false;
      }
      setServiceHealthy(true);
      setServiceConnectionState('connected');
      setError(null);
      await refreshBootstrapStatus(result.runtime_root ?? workbenchRepoRoot);
      if (result.runtime_root) setWorkbenchRepoRoot(result.runtime_root);
      setNotice(t(result.status === 'spawned' ? 'Local workbench service recovered.' : 'Local workbench service is ready.'));
      return true;
    } catch {
      return false;
    }
  }

  async function refreshBootstrapStatus(repoRoot = workbenchRepoRoot) {
    if (!isTauriRuntime()) {
      setBootstrapStatus(null);
      return;
    }
    try {
      const status = await getWorkbenchBootstrapStatus(repoRoot);
      setBootstrapStatus(status);
    } catch {
      setBootstrapStatus(null);
    }
  }

  function handleWorkbenchRepoRootChange(value: string) {
    setWorkbenchRepoRoot(value);
  }

  function handleFormDefaultsChange(patch: Partial<WorkbenchFormDefaults>) {
    setFormDefaults((current) => ({ ...current, ...patch }));
  }

  function handleOpenInspector(tab: InfoTab) {
    setActiveTab(tab);
    setInspectorOpen(true);
  }

  function handleSelectEvidenceImport(importId: string) {
    setSelectedEvidenceImportId(importId);
  }

  return (
    <div className={inspectorOpen ? 'app-shell drawer-open' : 'app-shell'}>
      <MiniRail
        activeView={activeShellView}
        personaName={selectedPersonaSummary?.name ?? null}
        onChangeView={setActiveShellView}
        onCreateThread={() => void handleCreateConversation()}
      />
      <ConversationSidebar
        personas={personas}
        selectedPersonaSlug={selectedPersonaSlug}
        selectedConversationId={selectedConversationId}
        threads={threads}
        onSelectPersona={setSelectedPersonaSlug}
        onSelectConversation={setSelectedConversationId}
        onCreateConversation={() => void handleCreateConversation()}
        onRenameConversation={() => void handleRenameConversation()}
        onDeleteConversation={() => void handleDeleteConversation()}
        onRefreshSummary={() => void handleRefreshSummary()}
      />

      <main className="main-stage">
        {error ? <div className="error-banner stage-error">{error}</div> : null}
        {activeShellView === 'chat' ? (
          <ChatWorkspace
            bundle={bundle}
            loading={chatLoading}
            personaSlug={selectedPersonaSlug}
            evidenceImports={evidenceImports}
            selectedEvidenceImportId={selectedEvidenceImportId}
            importLoading={importLoading}
            notice={notice}
            onSend={handleSendMessage}
            onCopyMessage={handleCopyMessage}
            onCopyValue={handleCopyValue}
            onUseEvidenceImport={handleUseEvidenceImport}
            onInspectEvidenceImport={handleInspectEvidenceImport}
            onSelectEvidenceImport={handleSelectEvidenceImport}
            onImportEvidence={handleImportEvidence}
            onOpenInspector={handleOpenInspector}
          />
        ) : (
          <SettingsScreen
            activeSection={activeSettingsSection}
            onSectionChange={setActiveSettingsSection}
            selectedPersona={selectedPersonaSummary}
            currentRun={currentRun}
            recentRuns={recentRuns}
            trainingPreps={trainingPreps}
            evidenceImports={evidenceImports}
            onCreatePersona={(payload) => launchRun(api.createPersona(payload), 'create')}
            onStartTraining={(payload) => launchRun(api.startTraining(payload), 'train')}
            onStartExperiment={(payload) => launchRun(api.startExperiment(payload), 'experiment')}
            onExportPersona={(payload) => launchRun(api.exportPersona(payload), 'export')}
            onSelectRun={handleSelectRun}
            onCopyValue={handleCopyValue}
            apiBaseUrl={apiBaseUrl}
            onApiBaseUrlChange={handleApiBaseUrlChange}
            onRefreshHealth={handleRefreshConnection}
            defaultValues={formDefaults}
            onDefaultValuesChange={handleFormDefaultsChange}
            serviceHealthy={serviceHealthy}
            serviceConnectionState={serviceConnectionState}
            workbenchRepoRoot={workbenchRepoRoot}
            onWorkbenchRepoRootChange={handleWorkbenchRepoRootChange}
            bootstrapStatus={bootstrapStatus}
          />
        )}
      </main>

      <InspectorDrawer
        open={inspectorOpen}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onClose={() => setInspectorOpen(false)}
        profile={selectedPersona}
        bundle={bundle}
        candidates={candidates}
        evidenceImports={evidenceImports}
        selectedEvidenceImportId={selectedEvidenceImportId}
        selectedEvidenceImportDetail={selectedEvidenceImportDetail}
        selectedMemoryNode={selectedMemoryNode}
        selectedMemorySourceAssets={selectedMemorySourceAssets}
        promotionHandoffs={promotionHandoffs}
        trainingPreps={trainingPreps}
        recentRuns={recentRuns}
        currentRunId={currentRun?.id ?? null}
        onSelectRun={handleSelectRun}
        onInspectMemory={handleInspectMemory}
        onInspectEvidenceImport={handleInspectEvidenceImport}
        onSelectEvidenceImport={handleSelectEvidenceImport}
        onReviewCandidate={handleReviewCandidate}
        onSetCandidatePromotionState={handleCandidatePromotionState}
        onCreatePromotionHandoff={handleCreatePromotionHandoff}
        onUpdatePromotionHandoff={handleUpdatePromotionHandoff}
        onExportPromotionHandoff={handleExportPromotionHandoff}
        onCreateTrainingPrep={handleCreateTrainingPrep}
        onExportTrainingPrep={handleExportTrainingPrep}
        onCopyValue={handleCopyValue}
        onUseTrainingPrep={handleUseTrainingPrep}
        onUseEvidenceImport={handleUseEvidenceImport}
        runReport={runReport}
      />
    </div>
  );
}

function deriveInitialShellView(): ShellView {
  const next = window.localStorage.getItem(ACTIVE_SHELL_VIEW_KEY) as ShellView | null;
  if (next === 'chat' || next === 'settings') return next;
  const legacy = window.localStorage.getItem(LEGACY_ACTIVE_VIEW_KEY) as NavView | null;
  return legacy === 'Chat' || !legacy ? 'chat' : 'settings';
}

function deriveInitialSettingsSection(): SettingsSection {
  const next = window.localStorage.getItem(ACTIVE_SETTINGS_SECTION_KEY) as SettingsSection | null;
  if (next && SETTINGS_SECTIONS.includes(next)) return next;
  const legacy = window.localStorage.getItem(LEGACY_ACTIVE_VIEW_KEY) as NavView | null;
  if (legacy === 'Create') return 'persona';
  if (legacy === 'Train') return 'training';
  if (legacy === 'Experiment') return 'experiment';
  if (legacy === 'Export') return 'export';
  return 'runtime';
}

function deriveInitialInspectorTab(): InfoTab {
  const next = window.localStorage.getItem(ACTIVE_TAB_KEY) as InfoTab | null;
  if (next && INSPECTOR_TABS.includes(next)) return next;
  return 'Soul';
}

function mapRunTypeToSettingsSection(type: WorkbenchRun['type']): SettingsSection {
  if (type === 'create') return 'persona';
  if (type === 'train') return 'training';
  if (type === 'experiment') return 'experiment';
  return 'export';
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

async function getWorkbenchBootstrapStatus(repoRoot: string): Promise<WorkbenchBootstrapStatus> {
  return invoke<WorkbenchBootstrapStatus>('get_workbench_bootstrap_status', {
    repoRoot: repoRoot.trim() || undefined,
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
