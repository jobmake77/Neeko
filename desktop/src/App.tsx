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
  WorkbenchRun,
  WorkbenchRunReport,
} from './lib/types';

export default function App() {
  const [activeView, setActiveView] = useState<NavView>('Chat');
  const [activeTab, setActiveTab] = useState<InfoTab>('Soul');
  const [apiBaseUrl, setApiBaseUrlState] = useState(getApiBaseUrl());
  const [serviceHealthy, setServiceHealthy] = useState(false);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [selectedPersonaSlug, setSelectedPersonaSlug] = useState<string | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<PersonaWorkbenchProfile | null>(null);
  const [threads, setThreads] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ConversationBundle | null>(null);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [currentRun, setCurrentRun] = useState<WorkbenchRun | null>(null);
  const [runReport, setRunReport] = useState<WorkbenchRunReport | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshHealth();
    void refreshPersonas();
  }, []);

  useEffect(() => {
    if (!selectedPersonaSlug) return;
    void refreshPersona(selectedPersonaSlug);
    void refreshThreads(selectedPersonaSlug);
  }, [selectedPersonaSlug]);

  useEffect(() => {
    if (!selectedConversationId) {
      setBundle(null);
      setCandidates([]);
      return;
    }
    void refreshConversation(selectedConversationId);
  }, [selectedConversationId]);

  useEffect(() => {
    if (!currentRun || currentRun.status !== 'running') return;
    const timer = window.setInterval(async () => {
      try {
        const run = await api.getRun(currentRun.id);
        setCurrentRun(run);
        if (run.status !== 'running') {
          const report = await api.getRunReport(run.id).catch(() => null);
          setRunReport(report);
          if (activeView === 'Create') {
            await refreshPersonas();
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [currentRun, activeView]);

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
      setBundle(nextBundle);
      setCandidates(nextCandidates);
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

  return (
    <div className="app-shell">
      <NavigationRail activeView={activeView} onChange={setActiveView} />
      <PersonaColumn personas={personas} selectedSlug={selectedPersonaSlug} onSelect={setSelectedPersonaSlug} />
      <ThreadColumn
        threads={threads}
        selectedId={selectedConversationId}
        onSelect={setSelectedConversationId}
        onCreate={handleCreateConversation}
      />
      <main className="workspace-container">
        {activeView === 'Chat' ? (
          <ChatWorkspace bundle={bundle} loading={chatLoading} onSend={handleSendMessage} />
        ) : (
          <WorkbenchForms
            activeView={activeView as Exclude<NavView, 'Chat'>}
            selectedPersona={selectedPersonaSummary}
            currentRun={currentRun}
            onCreatePersona={(payload) => launchRun(api.createPersona(payload))}
            onStartTraining={(payload) => launchRun(api.startTraining(payload))}
            onStartExperiment={(payload) => launchRun(api.startExperiment(payload))}
            onExportPersona={(payload) => launchRun(api.exportPersona(payload))}
            apiBaseUrl={apiBaseUrl}
            onApiBaseUrlChange={handleApiBaseUrlChange}
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
        runReport={runReport}
      />
    </div>
  );
}
