import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChatWorkspace } from './components/ChatWorkspace';
import { InfoPanel } from './components/InfoPanel';
import { NavigationRail } from './components/NavigationRail';
import { PersonaColumn } from './components/PersonaColumn';
import { ThreadColumn } from './components/ThreadColumn';
import { WorkbenchForms } from './components/WorkbenchForms';
import { api, getApiBaseUrl, setApiBaseUrl } from './lib/api';
import {
  Conversation,
  ConversationBundle,
  InfoTab,
  MemoryCandidate,
  NavView,
  PersonaSummary,
  PersonaWorkbenchProfile,
  PromotionHandoff,
  TrainingPrepArtifact,
  WorkbenchEvidenceImportDetail,
  WorkbenchEvidenceImport,
  WorkbenchMemoryNode,
  WorkbenchMemorySourceAsset,
  WorkbenchRun,
  WorkbenchRunReport,
} from './lib/types';

const ACTIVE_VIEW_KEY = 'neeko.workbench.activeView';
const ACTIVE_TAB_KEY = 'neeko.workbench.activeTab';
const PERSONA_KEY = 'neeko.workbench.selectedPersona';
const THREAD_KEY = 'neeko.workbench.selectedConversation';
const FORM_DEFAULTS_KEY = 'neeko.workbench.formDefaults';
const WORKBENCH_REPO_ROOT_KEY = 'neeko.workbench.repoRoot';

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

function toUserMessage(error: unknown): string {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();

  if (message.includes('clipboard')) {
    return 'Clipboard access is not available right now. Please try again.';
  }
  if (message.includes('conversation not found') || message.includes('thread not found')) {
    return 'This thread is no longer available.';
  }
  if (message.includes('persona not found') || message.includes('profile not found')) {
    return 'This persona is no longer available.';
  }
  if (message.includes('run not found')) {
    return 'This run is no longer available.';
  }
  if (
    message.includes('candidate not found') ||
    message.includes('handoff not found') ||
    message.includes('training prep not found') ||
    message.includes('not found')
  ) {
    return 'The requested item is no longer available.';
  }
  if (message.includes('required') || message.includes('missing')) {
    return 'Some required information is still missing.';
  }
  if (message.includes('absolute local file path')) {
    return 'Please use an absolute local file path for this import.';
  }
  if (message.includes('choose a file instead of a folder')) {
    return 'Please choose a file instead of a folder for this import.';
  }
  if (message.includes('valid json target manifest')) {
    return 'Please choose a valid JSON target manifest file.';
  }
  if (message.includes('must be different files')) {
    return 'Source and target manifest must be different files.';
  }
  if (message.includes('selected files is not available')) {
    return 'One of the selected files is not available right now.';
  }
  if (message.includes('qdrant') || message.includes('memory service')) {
    return 'The local memory service is still getting ready. Please try again shortly.';
  }
  if (
    message.includes('timeout') ||
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('connection')
  ) {
    return 'The workbench is handling a temporary issue. Please try again shortly.';
  }
  return 'The workbench could not finish this action right now.';
}

export default function App() {
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
  const [activeView, setActiveView] = useState<NavView>(
    () => (window.localStorage.getItem(ACTIVE_VIEW_KEY) as NavView | null) ?? 'Chat'
  );
  const [activeTab, setActiveTab] = useState<InfoTab>(
    () => (window.localStorage.getItem(ACTIVE_TAB_KEY) as InfoTab | null) ?? 'Soul'
  );
  const [apiBaseUrl, setApiBaseUrlState] = useState(getApiBaseUrl());
  const [serviceHealthy, setServiceHealthy] = useState(false);
  const [serviceConnectionState, setServiceConnectionState] = useState<ServiceConnectionState>('checking');
  const [workbenchRepoRoot, setWorkbenchRepoRoot] = useState(
    () => window.localStorage.getItem(WORKBENCH_REPO_ROOT_KEY) ?? ''
  );
  const [bootstrapStatus, setBootstrapStatus] = useState<WorkbenchBootstrapStatus | null>(null);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [selectedPersonaSlug, setSelectedPersonaSlug] = useState<string | null>(
    () => window.localStorage.getItem(PERSONA_KEY)
  );
  const [selectedPersona, setSelectedPersona] = useState<PersonaWorkbenchProfile | null>(null);
  const [threads, setThreads] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    () => window.localStorage.getItem(THREAD_KEY)
  );
  const [bundle, setBundle] = useState<ConversationBundle | null>(null);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [promotionHandoffs, setPromotionHandoffs] = useState<PromotionHandoff[]>([]);
  const [evidenceImports, setEvidenceImports] = useState<WorkbenchEvidenceImport[]>([]);
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
  const [runCenterOpen, setRunCenterOpen] = useState(false);
  const [runQuery, setRunQuery] = useState('');
  const [runStatusFilter, setRunStatusFilter] = useState<'all' | WorkbenchRun['status'] | 'recovering'>('all');
  const [runTypeFilter, setRunTypeFilter] = useState<'all' | WorkbenchRun['type']>('all');

  function reportError(error: unknown) {
    setError(toUserMessage(error));
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
      setSelectedEvidenceImportDetail(null);
      setTrainingPreps([]);
      setSelectedMemoryNode(null);
      setSelectedMemorySourceAssets([]);
      return;
    }
    void refreshConversation(selectedConversationId);
  }, [selectedConversationId]);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_VIEW_KEY, activeView);
  }, [activeView]);

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
    if (workbenchRepoRoot.trim()) {
      window.localStorage.setItem(WORKBENCH_REPO_ROOT_KEY, workbenchRepoRoot.trim());
    } else {
      window.localStorage.removeItem(WORKBENCH_REPO_ROOT_KEY);
    }
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
  }, [currentRun, activeView, selectedPersonaSlug]);

  const selectedPersonaSummary = useMemo(
    () => personas.find((item) => item.slug === selectedPersonaSlug) ?? null,
    [personas, selectedPersonaSlug]
  );
  const activeRunBanner = useMemo(() => deriveActiveRunBanner(currentRun), [currentRun]);
  const filteredRuns = useMemo(() => {
    const normalizedQuery = runQuery.trim().toLowerCase();
    return recentRuns.filter((run) => {
      const matchesStatus =
        runStatusFilter === 'all'
          ? true
          : runStatusFilter === 'recovering'
            ? run.recovery_state === 'recovering'
            : run.status === runStatusFilter;
      const matchesType = runTypeFilter === 'all' ? true : run.type === runTypeFilter;
      const matchesQuery = !normalizedQuery
        ? true
        : `${run.type} ${run.summary ?? ''} ${run.persona_slug ?? ''}`.toLowerCase().includes(normalizedQuery);
      return matchesStatus && matchesType && matchesQuery;
    });
  }, [recentRuns, runQuery, runStatusFilter, runTypeFilter]);
  const runCenterSummary = useMemo(() => {
    const running = recentRuns.filter((run) => run.status === 'running').length;
    const recovering = recentRuns.filter((run) => run.recovery_state === 'recovering').length;
    const paused = recentRuns.filter((run) => run.status === 'failed').length;
    const completed = recentRuns.filter((run) => run.status === 'completed').length;
    return { running, recovering, paused, completed };
  }, [recentRuns]);

  async function initializeWorkbench() {
    await refreshBootstrapStatus(workbenchRepoRoot);
    const connected = await refreshHealth({ allowRecover: true, silent: true });
    if (connected) {
      await refreshPersonas();
    }
  }

  async function refreshHealth(
    options: { allowRecover?: boolean; silent?: boolean; baseUrl?: string } = {}
  ): Promise<boolean> {
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
        if (recovered) {
          return true;
        }
      }
      setServiceConnectionState('offline');
      if (!silent) {
        reportError(err);
      }
      return false;
    }
  }

  async function refreshPersonas() {
    try {
      const data = await api.listPersonas();
      setPersonas(data);
      if (!selectedPersonaSlug && data[0]) {
        setSelectedPersonaSlug(data[0].slug);
      }
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
      if (data.length === 0) {
        setSelectedConversationId(null);
      }
    } catch (err) {
      reportError(err);
    }
  }

  async function refreshConversation(id: string) {
    try {
      const nextBundle = await api.getConversation(id);
      const nextCandidates = await api.listMemoryCandidates(id);
      const nextHandoffs = selectedPersonaSlug
        ? await api.listPromotionHandoffs(selectedPersonaSlug, id)
        : [];
      const nextImports = selectedPersonaSlug
        ? await api.listEvidenceImports(selectedPersonaSlug, id)
        : [];
      const nextTrainingPreps = selectedPersonaSlug
        ? await api.listTrainingPreps(selectedPersonaSlug, id)
        : [];
      setBundle(nextBundle);
      setCandidates(nextCandidates);
      setPromotionHandoffs(nextHandoffs);
      setEvidenceImports(nextImports);
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
      setActiveView('Chat');
    } catch (err) {
      reportError(err);
    }
  }

  async function handleRenameConversation() {
    if (!selectedConversationId) return;
    const current = threads.find((item) => item.id === selectedConversationId);
    const nextTitle = window.prompt('Rename thread', current?.title ?? '');
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
    const confirmed = window.confirm('Delete this thread and its local conversation assets?');
    if (!confirmed) return;
    try {
      await api.deleteConversation(selectedConversationId);
      await refreshThreads(selectedPersonaSlug);
      setBundle(null);
      setCandidates([]);
      setPromotionHandoffs([]);
      setEvidenceImports([]);
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
      const nextHandoffs = selectedPersonaSlug
        ? await api.listPromotionHandoffs(selectedPersonaSlug, selectedConversationId)
        : [];
      const nextImports = selectedPersonaSlug
        ? await api.listEvidenceImports(selectedPersonaSlug, selectedConversationId)
        : [];
      const nextTrainingPreps = selectedPersonaSlug
        ? await api.listTrainingPreps(selectedPersonaSlug, selectedConversationId)
        : [];
      setBundle(nextBundle);
      setCandidates(nextCandidates);
      setPromotionHandoffs(nextHandoffs);
      setEvidenceImports(nextImports);
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
      setNotice('Message sent.');
      setError(null);
    } catch (err) {
      reportError(err);
    } finally {
      setChatLoading(false);
    }
  }

  async function launchRun(request: Promise<WorkbenchRun>) {
    try {
      const run = await request;
      setCurrentRun(run);
      setRunReport(null);
      setActiveTab('Training');
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
      setNotice(`Candidate marked ${status}.`);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleCandidatePromotionState(
    candidateId: string,
    promotionState: MemoryCandidate['promotion_state']
  ) {
    if (!selectedConversationId) return;
    try {
      const result = await api.setCandidatePromotionState(selectedConversationId, candidateId, promotionState);
      setCandidates(result.candidates);
      setNotice(promotionState === 'ready' ? 'Candidate added to promotion-ready queue.' : 'Candidate removed from promotion-ready queue.');
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
      setActiveTab('Writeback');
      setNotice('Promotion handoff created.');
      setError(null);
      if (!nextHandoffs.some((item) => item.id === handoff.id)) {
        setPromotionHandoffs((current) => [handoff, ...current]);
      }
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
      setNotice(`Handoff marked ${status}.`);
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
      setNotice('Training prep artifact created.');
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleCopyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setNotice('Message copied to clipboard.');
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleCopyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied to clipboard.`);
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
      setActiveTab('Citations');
      setNotice('Memory detail loaded.');
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
      if (selectedPersonaSlug) {
        await refreshThreads(selectedPersonaSlug);
      }
      if (conversationId) {
        await refreshConversation(conversationId);
      }
      const detail = await api.getEvidenceImportDetail(imported.id).catch(() => null);
      if (detail) {
        setSelectedEvidenceImportDetail(detail);
      }
      setNotice(`${payload.sourceKind} evidence imported into workbench.`);
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
    setActiveView('Train');
    setActiveTab('Training');
    setNotice('Evidence intake has been attached to the train form.');
    setError(null);
  }

  async function handleInspectEvidenceImport(importId: string) {
    try {
      const detail = await api.getEvidenceImportDetail(importId);
      setSelectedEvidenceImportDetail(detail);
      setNotice('Evidence detail loaded.');
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
    setActiveView('Train');
    setActiveTab('Training');
    setNotice('Training prep has been attached to the train form.');
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
    if (!canBootstrapLocalService(baseUrl)) {
      return false;
    }
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
      if (result.runtime_root) {
        setWorkbenchRepoRoot(result.runtime_root);
      }
      setNotice(
        result.status === 'spawned'
          ? 'Local workbench service recovered.'
          : 'Local workbench service is ready.'
      );
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

  return (
    <div className="app-shell">
      <NavigationRail activeView={activeView} onChange={setActiveView} />
      <PersonaColumn personas={personas} selectedSlug={selectedPersonaSlug} onSelect={setSelectedPersonaSlug} />
      <ThreadColumn
        threads={threads}
        selectedId={selectedConversationId}
        onSelect={setSelectedConversationId}
        onCreate={handleCreateConversation}
        onRename={handleRenameConversation}
        onDelete={handleDeleteConversation}
        onRefreshSummary={handleRefreshSummary}
      />
      <main className="workspace-container">
        {activeRunBanner ? (
          <button
            type="button"
            className={`run-status-banner ${activeRunBanner.tone}`}
            onClick={() => setRunCenterOpen((current) => !current)}
          >
            <div>
              <strong>{activeRunBanner.title}</strong>
              <p>{activeRunBanner.summary}</p>
            </div>
            <div className="writeback-summary">
              <span className={activeRunBanner.tone === 'good' ? 'badge success' : activeRunBanner.tone === 'warning' ? 'badge warning' : 'badge'}>
                {activeRunBanner.statusLabel}
              </span>
              <span className="badge">{currentRun?.type ?? 'run'}</span>
              {typeof currentRun?.attempt_count === 'number' && currentRun.attempt_count > 1 ? (
                <span className="badge">attempt {currentRun.attempt_count}</span>
              ) : null}
              <span className="badge">{runCenterOpen ? 'hide runs' : 'open runs'}</span>
            </div>
          </button>
        ) : null}
        {runCenterOpen && recentRuns.length > 0 ? (
          <section className="panel run-center-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Run Center</p>
                <h2>Recent Activity</h2>
              </div>
            </div>
            <div className="run-center-toolbar">
              <label className="field compact-field">
                <span>Search</span>
                <input
                  value={runQuery}
                  onChange={(event) => setRunQuery(event.target.value)}
                  placeholder="Find a run"
                />
              </label>
              <label className="field compact-field">
                <span>Status</span>
                <select
                  value={runStatusFilter}
                  onChange={(event) => setRunStatusFilter(event.target.value as 'all' | WorkbenchRun['status'] | 'recovering')}
                >
                  <option value="all">all</option>
                  <option value="running">running</option>
                  <option value="recovering">recovering</option>
                  <option value="completed">completed</option>
                  <option value="failed">paused</option>
                </select>
              </label>
              <label className="field compact-field">
                <span>Type</span>
                <select
                  value={runTypeFilter}
                  onChange={(event) => setRunTypeFilter(event.target.value as 'all' | WorkbenchRun['type'])}
                >
                  <option value="all">all</option>
                  <option value="create">create</option>
                  <option value="train">train</option>
                  <option value="experiment">experiment</option>
                  <option value="export">export</option>
                </select>
              </label>
            </div>
            <div className="run-center-summary">
              <span className="badge">{runCenterSummary.running} running</span>
              <span className="badge success">{runCenterSummary.completed} completed</span>
              <span className="badge success">{runCenterSummary.recovering} recovering</span>
              <span className="badge warning">{runCenterSummary.paused} paused</span>
            </div>
            <div className="run-center-list">
              {filteredRuns.slice(0, 12).map((run) => {
                const banner = deriveActiveRunBanner(run);
                return (
                  <button
                    key={run.id}
                    type="button"
                    className={run.id === currentRun?.id ? 'mini-card active-card' : 'mini-card'}
                    onClick={() => void handleSelectRun(run)}
                  >
                    <div className="list-card-top">
                      <strong>{run.type}</strong>
                      <span className={banner?.tone === 'good' ? 'badge success' : banner?.tone === 'warning' ? 'badge warning' : 'badge'}>
                        {banner?.statusLabel ?? run.status}
                      </span>
                    </div>
                    <p>{banner?.summary ?? run.summary ?? run.status}</p>
                    <div className="writeback-summary">
                      <span className="badge">{new Date(run.started_at).toLocaleString()}</span>
                      {typeof run.attempt_count === 'number' && run.attempt_count > 1 ? <span className="badge">attempt {run.attempt_count}</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
            {filteredRuns.length === 0 ? (
              <div className="empty-state run-center-empty">No runs match the current run center filters.</div>
            ) : null}
          </section>
        ) : null}
        {activeView === 'Chat' ? (
          <ChatWorkspace
            bundle={bundle}
            loading={chatLoading}
            personaSlug={selectedPersonaSlug}
            evidenceImports={evidenceImports}
            selectedEvidenceImportDetail={selectedEvidenceImportDetail}
            importLoading={importLoading}
            notice={notice}
            onSend={handleSendMessage}
            onCopyMessage={handleCopyMessage}
            onCopyValue={handleCopyValue}
            onUseEvidenceImport={handleUseEvidenceImport}
            onInspectEvidenceImport={handleInspectEvidenceImport}
            onImportEvidence={handleImportEvidence}
          />
        ) : (
          <WorkbenchForms
            activeView={activeView as Exclude<NavView, 'Chat'>}
            selectedPersona={selectedPersonaSummary}
            currentRun={currentRun}
            recentRuns={recentRuns}
            trainingPreps={trainingPreps}
            evidenceImports={evidenceImports}
            onCreatePersona={(payload) => launchRun(api.createPersona(payload))}
            onStartTraining={(payload) => launchRun(api.startTraining(payload))}
            onStartExperiment={(payload) => launchRun(api.startExperiment(payload))}
            onExportPersona={(payload) => launchRun(api.exportPersona(payload))}
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
        {error ? <div className="error-banner">{error}</div> : null}
      </main>
      <InfoPanel
        activeTab={activeTab}
        onTabChange={setActiveTab}
        profile={selectedPersona}
        bundle={bundle}
        candidates={candidates}
        evidenceImports={evidenceImports}
        selectedMemoryNode={selectedMemoryNode}
        selectedMemorySourceAssets={selectedMemorySourceAssets}
        promotionHandoffs={promotionHandoffs}
        trainingPreps={trainingPreps}
        recentRuns={recentRuns}
        currentRunId={currentRun?.id ?? null}
        onSelectRun={handleSelectRun}
        onInspectMemory={handleInspectMemory}
        onReviewCandidate={handleReviewCandidate}
        onSetCandidatePromotionState={handleCandidatePromotionState}
        onCreatePromotionHandoff={handleCreatePromotionHandoff}
        onUpdatePromotionHandoff={handleUpdatePromotionHandoff}
        onExportPromotionHandoff={handleExportPromotionHandoff}
        onCreateTrainingPrep={handleCreateTrainingPrep}
        onExportTrainingPrep={handleExportTrainingPrep}
        onCopyValue={handleCopyValue}
        onUseTrainingPrep={handleUseTrainingPrep}
        runReport={runReport}
      />
    </div>
  );
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

async function bootstrapWorkbenchService(
  port: number,
  repoRoot?: string
): Promise<BootstrapWorkbenchServiceResult> {
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

function deriveActiveRunBanner(run: WorkbenchRun | null): {
  tone: 'good' | 'warning' | 'neutral';
  title: string;
  statusLabel: string;
  summary: string;
} | null {
  if (!run) return null;

  if (run.recovery_state === 'recovering') {
    return {
      tone: 'good',
      title: 'Automatic recovery in progress',
      statusLabel: 'recovering',
      summary: 'The system is reusing saved progress and retrying this run automatically.',
    };
  }

  if (run.status === 'running') {
    return {
      tone: 'neutral',
      title: 'Run in progress',
      statusLabel: 'running',
      summary: run.summary ?? 'The current workbench run is still in progress.',
    };
  }

  if (run.status === 'failed') {
    return {
      tone: 'warning',
      title: 'Run paused',
      statusLabel: 'progress saved',
      summary: 'This run paused before finishing, but progress was kept safe for a later retry.',
    };
  }

  if (run.status === 'completed') {
    return {
      tone: 'good',
      title: 'Latest run completed',
      statusLabel: 'completed',
      summary: run.summary ?? 'The latest workbench run completed successfully.',
    };
  }

  return null;
}
