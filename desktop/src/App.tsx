import { useEffect, useMemo, useState } from 'react';
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
  WorkbenchEvidenceImport,
  WorkbenchRun,
  WorkbenchRunReport,
} from './lib/types';

const ACTIVE_VIEW_KEY = 'neeko.workbench.activeView';
const ACTIVE_TAB_KEY = 'neeko.workbench.activeTab';
const PERSONA_KEY = 'neeko.workbench.selectedPersona';
const THREAD_KEY = 'neeko.workbench.selectedConversation';
const FORM_DEFAULTS_KEY = 'neeko.workbench.formDefaults';

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
  const [trainingPreps, setTrainingPreps] = useState<TrainingPrepArtifact[]>([]);
  const [recentRuns, setRecentRuns] = useState<WorkbenchRun[]>([]);
  const [currentRun, setCurrentRun] = useState<WorkbenchRun | null>(null);
  const [runReport, setRunReport] = useState<WorkbenchRunReport | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formDefaults, setFormDefaults] = useState(initialDefaults);

  useEffect(() => {
    void refreshHealth();
    void refreshPersonas();
  }, []);

  useEffect(() => {
    if (!selectedPersonaSlug) return;
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
      setTrainingPreps([]);
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
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [currentRun, activeView, selectedPersonaSlug]);

  const selectedPersonaSummary = useMemo(
    () => personas.find((item) => item.slug === selectedPersonaSlug) ?? null,
    [personas, selectedPersonaSlug]
  );

  async function refreshHealth() {
    try {
      await api.health();
      setServiceHealthy(true);
      setError(null);
    } catch (err) {
      setServiceHealthy(false);
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshPersona(slug: string) {
    try {
      const profile = await api.getPersona(slug);
      setSelectedPersona(profile);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setTrainingPreps(nextTrainingPreps);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshRuns(personaSlug?: string) {
    try {
      const runs = await api.listRuns(personaSlug);
      setRecentRuns(runs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setTrainingPreps([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      await refreshThreads(selectedPersonaSlug);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleExportPromotionHandoff(handoffId: string, format: 'markdown' | 'json') {
    try {
      const exported = await api.exportPromotionHandoff(handoffId, format);
      await navigator.clipboard.writeText(exported.content);
      setNotice(`${exported.filename} copied to clipboard.`);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCopyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setNotice('Message copied to clipboard.');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCopyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied to clipboard.`);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      await api.importEvidence(selectedPersonaSlug, {
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
      setNotice(`${payload.sourceKind} evidence imported into workbench.`);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportLoading(false);
    }
  }

  async function handleExportTrainingPrep(prepId: string, format: 'markdown' | 'json') {
    try {
      const exported = await api.exportTrainingPrep(prepId, format);
      await navigator.clipboard.writeText(exported.content);
      setNotice(`${exported.filename} copied to clipboard.`);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleApiBaseUrlChange(value: string) {
    setApiBaseUrlState(value);
    setApiBaseUrl(value);
    void refreshHealth();
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
        {activeView === 'Chat' ? (
          <ChatWorkspace
            bundle={bundle}
            loading={chatLoading}
            personaSlug={selectedPersonaSlug}
            evidenceImports={evidenceImports}
            importLoading={importLoading}
            notice={notice}
            onSend={handleSendMessage}
            onCopyMessage={handleCopyMessage}
            onImportEvidence={handleImportEvidence}
          />
        ) : (
          <WorkbenchForms
            activeView={activeView as Exclude<NavView, 'Chat'>}
            selectedPersona={selectedPersonaSummary}
            currentRun={currentRun}
            recentRuns={recentRuns}
            onCreatePersona={(payload) => launchRun(api.createPersona(payload))}
            onStartTraining={(payload) => launchRun(api.startTraining(payload))}
            onStartExperiment={(payload) => launchRun(api.startExperiment(payload))}
            onExportPersona={(payload) => launchRun(api.exportPersona(payload))}
            onSelectRun={handleSelectRun}
            apiBaseUrl={apiBaseUrl}
            onApiBaseUrlChange={handleApiBaseUrlChange}
            onRefreshHealth={refreshHealth}
            defaultValues={formDefaults}
            onDefaultValuesChange={handleFormDefaultsChange}
            serviceHealthy={serviceHealthy}
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
        promotionHandoffs={promotionHandoffs}
        trainingPreps={trainingPreps}
        recentRuns={recentRuns}
        currentRunId={currentRun?.id ?? null}
        onSelectRun={handleSelectRun}
        onReviewCandidate={handleReviewCandidate}
        onSetCandidatePromotionState={handleCandidatePromotionState}
        onCreatePromotionHandoff={handleCreatePromotionHandoff}
        onUpdatePromotionHandoff={handleUpdatePromotionHandoff}
        onExportPromotionHandoff={handleExportPromotionHandoff}
        onCreateTrainingPrep={handleCreateTrainingPrep}
        onExportTrainingPrep={handleExportTrainingPrep}
        onCopyValue={handleCopyValue}
        runReport={runReport}
      />
    </div>
  );
}
