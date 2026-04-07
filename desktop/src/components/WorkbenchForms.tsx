import { FormEvent, useEffect, useMemo, useState } from 'react';
import { NavView, PersonaSummary, TrainingPrepArtifact, WorkbenchEvidenceImport, WorkbenchRun } from '../lib/types';

export interface WorkbenchFormsProps {
  activeView: Exclude<NavView, 'Chat'>;
  selectedPersona: PersonaSummary | null;
  currentRun: WorkbenchRun | null;
  recentRuns: WorkbenchRun[];
  trainingPreps: TrainingPrepArtifact[];
  evidenceImports: WorkbenchEvidenceImport[];
  onCreatePersona: (payload: Record<string, unknown>) => Promise<void>;
  onStartTraining: (payload: Record<string, unknown>) => Promise<void>;
  onStartExperiment: (payload: Record<string, unknown>) => Promise<void>;
  onExportPersona: (payload: Record<string, unknown>) => Promise<void>;
  onSelectRun: (run: WorkbenchRun) => Promise<void>;
  onCopyValue: (value: string, label: string) => Promise<void>;
  apiBaseUrl: string;
  onApiBaseUrlChange: (value: string) => void;
  onRefreshHealth: () => Promise<void>;
  defaultValues: {
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
  onDefaultValuesChange: (patch: Partial<WorkbenchFormsProps['defaultValues']>) => void;
  serviceHealthy: boolean;
  serviceConnectionState: 'checking' | 'connected' | 'recovering' | 'offline';
  workbenchRepoRoot: string;
  onWorkbenchRepoRootChange: (value: string) => void;
  bootstrapStatus: {
    mode: 'ready' | 'preparing_core' | 'missing_node' | 'needs_repo_root';
    resolved_runtime_root?: string | null;
    node_available: boolean;
    node_source: 'bundled' | 'system' | 'missing';
    dist_ready: boolean;
    service_managed: boolean;
    message: string;
  } | null;
  embedded?: boolean;
}

export function WorkbenchForms(props: WorkbenchFormsProps) {
  const {
    activeView,
    selectedPersona,
    currentRun,
    recentRuns,
    trainingPreps,
    evidenceImports,
    onCreatePersona,
    onStartTraining,
    onStartExperiment,
    onExportPersona,
    onSelectRun,
    onCopyValue,
    apiBaseUrl,
    onApiBaseUrlChange,
    onRefreshHealth,
    defaultValues,
    onDefaultValuesChange,
    serviceHealthy,
    serviceConnectionState,
    workbenchRepoRoot,
    onWorkbenchRepoRootChange,
    bootstrapStatus,
    embedded = false,
  } = props;
  const [target, setTarget] = useState(defaultValues.createTarget);
  const [targetManifest, setTargetManifest] = useState(defaultValues.createTargetManifest);
  const [chatPlatform, setChatPlatform] = useState(defaultValues.createChatPlatform);
  const [rounds, setRounds] = useState(defaultValues.rounds);
  const [trainingProfile, setTrainingProfile] = useState(defaultValues.trainingProfile);
  const [inputRouting, setInputRouting] = useState(defaultValues.inputRouting);
  const [trainingSeedMode, setTrainingSeedMode] = useState(defaultValues.trainingSeedMode);
  const [kimiStabilityMode, setKimiStabilityMode] = useState(defaultValues.kimiStabilityMode);
  const [trainMode, setTrainMode] = useState(defaultValues.trainMode);
  const [trainTrack, setTrainTrack] = useState(defaultValues.trainTrack);
  const [trainRetries, setTrainRetries] = useState(defaultValues.trainRetries);
  const [trainFromCheckpoint, setTrainFromCheckpoint] = useState(defaultValues.trainFromCheckpoint);
  const [trainPrepDocumentsPath, setTrainPrepDocumentsPath] = useState(defaultValues.trainPrepDocumentsPath);
  const [trainPrepEvidencePath, setTrainPrepEvidencePath] = useState(defaultValues.trainPrepEvidencePath);
  const [trainPrepArtifactId, setTrainPrepArtifactId] = useState(defaultValues.trainPrepArtifactId);
  const [trainEvidenceImportId, setTrainEvidenceImportId] = useState(defaultValues.trainEvidenceImportId);
  const [experimentProfiles, setExperimentProfiles] = useState(defaultValues.experimentProfiles);
  const [questionsPerRound, setQuestionsPerRound] = useState(defaultValues.questionsPerRound);
  const [experimentCompareVariants, setExperimentCompareVariants] = useState(defaultValues.experimentCompareVariants);
  const [experimentOutputDir, setExperimentOutputDir] = useState(defaultValues.experimentOutputDir);
  const [experimentGate, setExperimentGate] = useState(defaultValues.experimentGate);
  const [experimentCompareInputRouting, setExperimentCompareInputRouting] = useState(defaultValues.experimentCompareInputRouting);
  const [experimentCompareTrainingSeed, setExperimentCompareTrainingSeed] = useState(defaultValues.experimentCompareTrainingSeed);
  const [exportFormat, setExportFormat] = useState(defaultValues.exportFormat);
  const [exportOutputDir, setExportOutputDir] = useState(defaultValues.exportOutputDir);

  const title = useMemo(() => {
    if (activeView === 'Create') return 'Create Persona';
    if (activeView === 'Train') return 'Train Persona';
    if (activeView === 'Experiment') return 'Run Experiment';
    if (activeView === 'Export') return 'Export Persona';
    return 'Settings';
  }, [activeView]);
  const latestTrainingPrep = trainingPreps[0] ?? null;
  const latestEvidenceImport = evidenceImports[0] ?? null;
  const currentRunPresentation = currentRun ? deriveWorkbenchRunPresentation(currentRun) : null;
  const activeTrainingPrep = trainPrepArtifactId
    ? trainingPreps.find((item) => item.id === trainPrepArtifactId) ?? null
    : null;
  const activeEvidenceImport = trainEvidenceImportId
    ? evidenceImports.find((item) => item.id === trainEvidenceImportId) ?? null
    : null;
  const trainLaunchGuidance = activeView === 'Train'
    ? deriveTrainLaunchGuidance({
      activeTrainingPrep,
      activeEvidenceImport,
      trainPrepDocumentsPath,
      trainPrepEvidencePath,
      rounds,
      trainMode,
    })
    : null;
  const createGuidance = activeView === 'Create'
    ? deriveCreateGuidance({
      target,
      targetManifest,
      chatPlatform,
      rounds,
      trainingProfile,
      inputRouting,
      trainingSeedMode,
    })
    : null;
  const experimentGuidance = activeView === 'Experiment'
    ? deriveExperimentGuidance({
      selectedPersona,
      latestTrainingPrep,
      latestEvidenceImport,
      experimentProfiles,
      rounds,
      questionsPerRound,
      experimentGate,
      experimentCompareInputRouting,
      experimentCompareTrainingSeed,
      experimentCompareVariants,
    })
    : null;

  useEffect(() => {
    setTarget(defaultValues.createTarget);
    setTargetManifest(defaultValues.createTargetManifest);
    setChatPlatform(defaultValues.createChatPlatform);
    setRounds(defaultValues.rounds);
    setTrainingProfile(defaultValues.trainingProfile);
    setInputRouting(defaultValues.inputRouting);
    setTrainingSeedMode(defaultValues.trainingSeedMode);
    setKimiStabilityMode(defaultValues.kimiStabilityMode);
    setTrainMode(defaultValues.trainMode);
    setTrainTrack(defaultValues.trainTrack);
    setTrainRetries(defaultValues.trainRetries);
    setTrainFromCheckpoint(defaultValues.trainFromCheckpoint);
    setTrainPrepDocumentsPath(defaultValues.trainPrepDocumentsPath);
    setTrainPrepEvidencePath(defaultValues.trainPrepEvidencePath);
    setTrainPrepArtifactId(defaultValues.trainPrepArtifactId);
    setTrainEvidenceImportId(defaultValues.trainEvidenceImportId);
    setExperimentProfiles(defaultValues.experimentProfiles);
    setQuestionsPerRound(defaultValues.questionsPerRound);
    setExperimentCompareVariants(defaultValues.experimentCompareVariants);
    setExperimentOutputDir(defaultValues.experimentOutputDir);
    setExperimentGate(defaultValues.experimentGate);
    setExperimentCompareInputRouting(defaultValues.experimentCompareInputRouting);
    setExperimentCompareTrainingSeed(defaultValues.experimentCompareTrainingSeed);
    setExportFormat(defaultValues.exportFormat);
    setExportOutputDir(defaultValues.exportOutputDir);
  }, [defaultValues]);

  const buildTrainingPayload = (smoke = false) => {
    if (!selectedPersona) return null;
    return {
      slug: selectedPersona.slug,
      mode: smoke ? 'quick' : trainMode,
      rounds: smoke ? 1 : Number(rounds),
      track: smoke ? 'persona_extract' : trainTrack,
      trainingProfile,
      inputRouting,
      trainingSeedMode,
      retries: Number(trainRetries),
      fromCheckpoint: smoke ? undefined : (trainFromCheckpoint || undefined),
      kimiStabilityMode,
      prepDocumentsPath: trainPrepDocumentsPath || undefined,
      prepEvidencePath: trainPrepEvidencePath || undefined,
      prepArtifactId: trainPrepArtifactId || undefined,
      evidenceImportId: trainEvidenceImportId || undefined,
      smoke,
    };
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeView === 'Create') {
      await onCreatePersona({
        target,
        targetManifest: targetManifest || undefined,
        chatPlatform,
        rounds: Number(rounds),
        trainingProfile,
        inputRouting,
        trainingSeedMode,
        kimiStabilityMode,
      });
      return;
    }
    if (!selectedPersona) return;
    if (activeView === 'Train') {
      const payload = buildTrainingPayload(false);
      if (!payload) return;
      await onStartTraining(payload);
      return;
    }
    if (activeView === 'Experiment') {
      await onStartExperiment({
        slug: selectedPersona.slug,
        profiles: experimentProfiles || undefined,
        rounds: Number(rounds),
        questionsPerRound: Number(questionsPerRound),
        outputDir: experimentOutputDir || undefined,
        gate: experimentGate,
        inputRouting,
        trainingSeedMode,
        compareInputRouting: experimentCompareInputRouting,
        compareTrainingSeed: experimentCompareTrainingSeed,
        compareVariants: experimentCompareVariants || undefined,
        kimiStabilityMode,
      });
      return;
    }
    if (activeView === 'Export') {
      await onExportPersona({ slug: selectedPersona.slug, format: exportFormat, outputDir: exportOutputDir || undefined });
    }
  };

  if (activeView === 'Settings') {
    const serviceBadgeClass = serviceConnectionState === 'connected'
      ? 'badge success'
      : serviceConnectionState === 'recovering'
        ? 'badge'
        : serviceConnectionState === 'checking'
          ? 'badge'
          : 'badge warning';
    const serviceLabel = serviceConnectionState === 'connected'
      ? 'Connected'
      : serviceConnectionState === 'recovering'
        ? 'Recovering'
        : serviceConnectionState === 'checking'
          ? 'Checking'
          : 'Offline';

    return (
      <section className={embedded ? 'workbench-form-embedded' : 'workspace panel form-panel'}>
        {!embedded ? (
          <div className="panel-header workspace-header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Local Service</h2>
          </div>
          <span className={serviceBadgeClass}>{serviceLabel}</span>
          </div>
        ) : (
          <div className="settings-inline-header">
            <div>
              <p className="eyebrow">Runtime</p>
              <strong>Local Service</strong>
            </div>
            <span className={serviceBadgeClass}>{serviceLabel}</span>
          </div>
        )}
        <label className="field">
          <span>Workbench server URL</span>
          <input value={apiBaseUrl} onChange={(event) => onApiBaseUrlChange(event.target.value)} />
        </label>
        <label className="field">
          <span>Local Neeko repo path</span>
          <input
            value={workbenchRepoRoot}
            onChange={(event) => onWorkbenchRepoRootChange(event.target.value)}
            placeholder="/absolute/path/to/Neeko"
          />
        </label>
        <div className="settings-actions">
          <button type="button" className="action-button secondary" onClick={() => void onRefreshHealth()}>
            Refresh Connection
          </button>
        </div>
        <p className="helper-text">
          The desktop shell talks to the structured local API. Default is `http://127.0.0.1:4310`.
        </p>
        <div className="settings-card">
          <div className="list-card-top">
            <strong>Bootstrap readiness</strong>
            <span
              className={
                bootstrapStatus?.mode === 'ready'
                  ? 'badge success'
                  : bootstrapStatus?.mode === 'preparing_core'
                    ? 'badge'
                    : 'badge warning'
              }
            >
              {bootstrapStatus?.mode ?? 'unknown'}
            </span>
          </div>
          <p>{bootstrapStatus?.message ?? 'Bootstrap status is not available yet.'}</p>
          <div className="writeback-summary">
            <span className={bootstrapStatus?.node_available ? 'badge success' : 'badge warning'}>
              node {bootstrapStatus?.node_available ? bootstrapStatus.node_source : 'missing'}
            </span>
            <span className={bootstrapStatus?.dist_ready ? 'badge success' : 'badge warning'}>
              core {bootstrapStatus?.dist_ready ? 'built' : 'pending'}
            </span>
            <span className={bootstrapStatus?.service_managed ? 'badge success' : 'badge'}>
              {bootstrapStatus?.service_managed ? 'managed by desktop' : 'not managed yet'}
            </span>
          </div>
          {bootstrapStatus?.resolved_runtime_root ? (
            <code>{bootstrapStatus.resolved_runtime_root}</code>
          ) : null}
        </div>
        <div className="settings-card">
          <div className="list-card-top">
            <strong>Connection behavior</strong>
            <span className={serviceHealthy ? 'badge success' : 'badge warning'}>
              {serviceHealthy ? 'ready' : 'attention'}
            </span>
          </div>
          <p>
            {serviceConnectionState === 'connected'
              ? 'The desktop workbench is connected to the local structured API.'
              : serviceConnectionState === 'recovering'
                ? 'The desktop shell is restarting the local workbench service and will reconnect automatically.'
                : serviceConnectionState === 'checking'
                  ? 'The desktop shell is checking the local workbench service.'
                  : 'The local workbench service is unavailable right now. The desktop shell will try to recover it automatically when you use a local URL.'}
          </p>
        </div>
        <div className="settings-card">
          <strong>Manual fallback</strong>
          <code>npm run workbench:server</code>
          <code>npm --prefix desktop run tauri:dev</code>
        </div>
      </section>
    );
  }

  const handleLaunchSmoke = async () => {
    const payload = buildTrainingPayload(true);
    if (!payload) return;
    await onStartTraining(payload);
  };

  return (
    <section className={embedded ? 'workbench-form-embedded' : 'workspace panel form-panel'}>
      {!embedded ? (
        <div className="panel-header workspace-header">
          <div>
            <p className="eyebrow">Workbench</p>
            <h2>{title}</h2>
          </div>
          {selectedPersona ? <span className="badge">{selectedPersona.name}</span> : null}
        </div>
      ) : (
        <div className="settings-inline-header">
          <div>
            <p className="eyebrow">Settings</p>
            <strong>{title}</strong>
          </div>
          {selectedPersona ? <span className="badge">{selectedPersona.name}</span> : null}
        </div>
      )}
      {activeView === 'Train' && trainLaunchGuidance ? (
        <div className="settings-card workflow-card">
          <div className="list-card-top">
            <strong>Train Guidance</strong>
            <span className={trainLaunchGuidance.tone === 'good' ? 'badge success' : trainLaunchGuidance.tone === 'warning' ? 'badge warning' : 'badge'}>
              {trainLaunchGuidance.statusLabel}
            </span>
          </div>
          <p>{trainLaunchGuidance.summary}</p>
          <div className="workflow-stage-grid">
            {trainLaunchGuidance.stages.map((stage) => (
              <div key={stage.label} className="workflow-stage-card">
                <strong>{stage.label}</strong>
                <span className={stage.tone === 'good' ? 'badge success' : stage.tone === 'warning' ? 'badge warning' : 'badge'}>
                  {stage.status}
                </span>
              </div>
            ))}
          </div>
          <div className="workflow-step-list">
            {trainLaunchGuidance.actions.map((item) => (
              <small key={item}>{item}</small>
            ))}
          </div>
        </div>
      ) : null}
      {activeView === 'Create' && createGuidance ? (
        <div className="settings-card workflow-card">
          <div className="list-card-top">
            <strong>Create Guidance</strong>
            <span className={createGuidance.tone === 'good' ? 'badge success' : createGuidance.tone === 'warning' ? 'badge warning' : 'badge'}>
              {createGuidance.statusLabel}
            </span>
          </div>
          <p>{createGuidance.summary}</p>
          <div className="workflow-stage-grid">
            {createGuidance.stages.map((stage) => (
              <div key={stage.label} className="workflow-stage-card">
                <strong>{stage.label}</strong>
                <span className={stage.tone === 'good' ? 'badge success' : stage.tone === 'warning' ? 'badge warning' : 'badge'}>
                  {stage.status}
                </span>
              </div>
            ))}
          </div>
          <div className="workflow-step-list">
            {createGuidance.actions.map((item) => (
              <small key={item}>{item}</small>
            ))}
          </div>
        </div>
      ) : null}
      {activeView === 'Experiment' && experimentGuidance ? (
        <div className="settings-card workflow-card">
          <div className="list-card-top">
            <strong>Experiment Guidance</strong>
            <span className={experimentGuidance.tone === 'good' ? 'badge success' : experimentGuidance.tone === 'warning' ? 'badge warning' : 'badge'}>
              {experimentGuidance.statusLabel}
            </span>
          </div>
          <p>{experimentGuidance.summary}</p>
          <div className="workflow-stage-grid">
            {experimentGuidance.stages.map((stage) => (
              <div key={stage.label} className="workflow-stage-card">
                <strong>{stage.label}</strong>
                <span className={stage.tone === 'good' ? 'badge success' : stage.tone === 'warning' ? 'badge warning' : 'badge'}>
                  {stage.status}
                </span>
              </div>
            ))}
          </div>
          <div className="workflow-step-list">
            {experimentGuidance.actions.map((item) => (
              <small key={item}>{item}</small>
            ))}
          </div>
        </div>
      ) : null}
      <form className="form-grid" onSubmit={handleSubmit}>
        {activeView === 'Create' ? (
          <label className="field">
            <span>Target</span>
            <input
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
                onDefaultValuesChange({ createTarget: event.target.value });
              }}
              placeholder="@karpathy or local file"
            />
          </label>
        ) : null}

        {activeView === 'Create' ? (
          <label className="field">
            <span>Target manifest</span>
            <input
              value={targetManifest}
              onChange={(event) => {
                setTargetManifest(event.target.value);
                onDefaultValuesChange({ createTargetManifest: event.target.value });
              }}
              placeholder="/path/to/target-manifest.json"
            />
          </label>
        ) : null}

        {activeView === 'Create' ? (
          <label className="field">
            <span>Chat platform</span>
            <select
              value={chatPlatform}
              onChange={(event) => {
                setChatPlatform(event.target.value);
                onDefaultValuesChange({ createChatPlatform: event.target.value });
              }}
            >
              <option value="wechat">wechat</option>
              <option value="feishu">feishu</option>
            </select>
          </label>
        ) : null}

        {activeView !== 'Export' ? (
          <label className="field">
            <span>Rounds</span>
            <input
              value={rounds}
              onChange={(event) => {
                setRounds(event.target.value);
                onDefaultValuesChange({ rounds: event.target.value });
              }}
              inputMode="numeric"
            />
          </label>
        ) : null}

        {activeView !== 'Export' ? (
          <label className="field">
            <span>Training profile</span>
            <select
              value={trainingProfile}
              onChange={(event) => {
                setTrainingProfile(event.target.value);
                onDefaultValuesChange({ trainingProfile: event.target.value });
              }}
            >
              <option value="baseline">baseline</option>
              <option value="full">full</option>
              <option value="a1">a1</option>
              <option value="a2">a2</option>
              <option value="a3">a3</option>
              <option value="a4">a4</option>
            </select>
          </label>
        ) : null}

        {activeView === 'Experiment' || activeView === 'Train' || activeView === 'Create' ? (
          <label className="field">
            <span>Input routing</span>
            <select
              value={inputRouting}
              onChange={(event) => {
                setInputRouting(event.target.value);
                onDefaultValuesChange({ inputRouting: event.target.value });
              }}
            >
              <option value="legacy">legacy</option>
              <option value="v2">v2</option>
            </select>
          </label>
        ) : null}

        {activeView === 'Experiment' || activeView === 'Train' || activeView === 'Create' ? (
          <label className="field">
            <span>Training seed mode</span>
            <select
              value={trainingSeedMode}
              onChange={(event) => {
                setTrainingSeedMode(event.target.value);
                onDefaultValuesChange({ trainingSeedMode: event.target.value });
              }}
            >
              <option value="off">off</option>
              <option value="topics">topics</option>
              <option value="signals">signals</option>
            </select>
          </label>
        ) : null}

        {activeView === 'Experiment' || activeView === 'Train' || activeView === 'Create' ? (
          <label className="field">
            <span>Kimi stability mode</span>
            <select
              value={kimiStabilityMode}
              onChange={(event) => {
                setKimiStabilityMode(event.target.value);
                onDefaultValuesChange({ kimiStabilityMode: event.target.value });
              }}
            >
              <option value="standard">standard</option>
              <option value="tight_runtime">tight_runtime</option>
              <option value="sparse_director">sparse_director</option>
              <option value="hybrid">hybrid</option>
            </select>
          </label>
        ) : null}

        {activeView === 'Train' ? (
          <label className="field">
            <span>Mode</span>
            <select
              value={trainMode}
              onChange={(event) => {
                setTrainMode(event.target.value);
                onDefaultValuesChange({ trainMode: event.target.value });
              }}
            >
              <option value="quick">quick</option>
              <option value="full">full</option>
            </select>
          </label>
        ) : null}

        {activeView === 'Train' ? (
          <label className="field">
            <span>Track</span>
            <select
              value={trainTrack}
              onChange={(event) => {
                setTrainTrack(event.target.value);
                onDefaultValuesChange({ trainTrack: event.target.value });
              }}
            >
              <option value="full_serial">full_serial</option>
              <option value="persona_extract">persona_extract</option>
              <option value="work_execute">work_execute</option>
            </select>
          </label>
        ) : null}

        {activeView === 'Train' ? (
          <label className="field">
            <span>Retries</span>
            <input
              value={trainRetries}
              onChange={(event) => {
                setTrainRetries(event.target.value);
                onDefaultValuesChange({ trainRetries: event.target.value });
              }}
              inputMode="numeric"
            />
          </label>
        ) : null}

        {activeView === 'Train' ? (
          <label className="field">
            <span>From checkpoint</span>
            <input
              value={trainFromCheckpoint}
              onChange={(event) => {
                setTrainFromCheckpoint(event.target.value);
                onDefaultValuesChange({ trainFromCheckpoint: event.target.value });
              }}
              placeholder="latest or checkpoint id"
            />
          </label>
        ) : null}

        {activeView === 'Train' ? (
          <label className="field">
            <span>Prep documents path</span>
            <input
              value={trainPrepDocumentsPath}
              onChange={(event) => {
                setTrainPrepDocumentsPath(event.target.value);
                onDefaultValuesChange({ trainPrepDocumentsPath: event.target.value });
              }}
              placeholder="/path/to/training-prep/documents.json"
            />
          </label>
        ) : null}

        {activeView === 'Train' ? (
          <label className="field">
            <span>Prep evidence path</span>
            <input
              value={trainPrepEvidencePath}
              onChange={(event) => {
                setTrainPrepEvidencePath(event.target.value);
                onDefaultValuesChange({ trainPrepEvidencePath: event.target.value });
              }}
              placeholder="/path/to/training-prep/evidence-index.jsonl"
            />
          </label>
        ) : null}

        {activeView === 'Train' ? (
          <label className="field">
            <span>Prep artifact id</span>
            <input
              value={trainPrepArtifactId}
              onChange={(event) => {
                setTrainPrepArtifactId(event.target.value);
                onDefaultValuesChange({ trainPrepArtifactId: event.target.value });
              }}
              placeholder="training prep artifact id"
            />
          </label>
        ) : null}

        {activeView === 'Train' ? (
          <label className="field">
            <span>Evidence import id</span>
            <input
              value={trainEvidenceImportId}
              onChange={(event) => {
                setTrainEvidenceImportId(event.target.value);
                onDefaultValuesChange({ trainEvidenceImportId: event.target.value });
              }}
              placeholder="linked evidence import id"
            />
          </label>
        ) : null}

        {activeView === 'Experiment' ? (
          <label className="field">
            <span>Profiles</span>
            <input
              value={experimentProfiles}
              onChange={(event) => {
                setExperimentProfiles(event.target.value);
                onDefaultValuesChange({ experimentProfiles: event.target.value });
              }}
              placeholder="baseline,full"
            />
          </label>
        ) : null}

        {activeView === 'Experiment' ? (
          <label className="field">
            <span>Questions / round</span>
            <input
              value={questionsPerRound}
              onChange={(event) => {
                setQuestionsPerRound(event.target.value);
                onDefaultValuesChange({ questionsPerRound: event.target.value });
              }}
              inputMode="numeric"
            />
          </label>
        ) : null}

        {activeView === 'Experiment' ? (
          <label className="field">
            <span>Compare variants</span>
            <input
              value={experimentCompareVariants}
              onChange={(event) => {
                setExperimentCompareVariants(event.target.value);
                onDefaultValuesChange({ experimentCompareVariants: event.target.value });
              }}
              placeholder="legacy:off,v2:off,v2:signals"
            />
          </label>
        ) : null}

        {activeView === 'Experiment' ? (
          <label className="field">
            <span>Output dir</span>
            <input
              value={experimentOutputDir}
              onChange={(event) => {
                setExperimentOutputDir(event.target.value);
                onDefaultValuesChange({ experimentOutputDir: event.target.value });
              }}
              placeholder="/path/to/experiment-output"
            />
          </label>
        ) : null}

        {activeView === 'Experiment' ? (
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={experimentGate}
              onChange={(event) => {
                setExperimentGate(event.target.checked);
                onDefaultValuesChange({ experimentGate: event.target.checked });
              }}
            />
            <span>Enable gate</span>
          </label>
        ) : null}

        {activeView === 'Experiment' ? (
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={experimentCompareInputRouting}
              onChange={(event) => {
                setExperimentCompareInputRouting(event.target.checked);
                onDefaultValuesChange({ experimentCompareInputRouting: event.target.checked });
              }}
            />
            <span>Compare input routing</span>
          </label>
        ) : null}

        {activeView === 'Experiment' ? (
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={experimentCompareTrainingSeed}
              onChange={(event) => {
                setExperimentCompareTrainingSeed(event.target.checked);
                onDefaultValuesChange({ experimentCompareTrainingSeed: event.target.checked });
              }}
            />
            <span>Compare training seed</span>
          </label>
        ) : null}

        {activeView === 'Export' ? (
          <label className="field">
            <span>Format</span>
            <select
              value={exportFormat}
              onChange={(event) => {
                setExportFormat(event.target.value);
                onDefaultValuesChange({ exportFormat: event.target.value });
              }}
            >
              <option value="openclaw">openclaw</option>
            </select>
          </label>
        ) : null}

        {activeView === 'Export' ? (
          <label className="field">
            <span>Output dir</span>
            <input
              value={exportOutputDir}
              onChange={(event) => {
                setExportOutputDir(event.target.value);
                onDefaultValuesChange({ exportOutputDir: event.target.value });
              }}
              placeholder="/path/to/export-output"
            />
          </label>
        ) : null}

        <button type="submit" className="primary-button" disabled={activeView !== 'Create' && !selectedPersona}>
          Launch {activeView}
        </button>
        {activeView === 'Train' ? (
          <button type="button" className="action-button secondary" disabled={!selectedPersona} onClick={() => void handleLaunchSmoke()}>
            Run Smoke
          </button>
        ) : null}
      </form>
      {activeView === 'Train' && (activeTrainingPrep || activeEvidenceImport || trainPrepDocumentsPath || trainPrepEvidencePath) ? (
        <div className="settings-card">
          <strong>Attached Training Context</strong>
          <p>
            {activeTrainingPrep
              ? 'This run will start from the selected training prep artifact.'
              : activeEvidenceImport
                ? 'This run will start from the selected evidence intake context.'
                : 'This run includes manually attached training context paths.'}
          </p>
          <div className="writeback-summary">
            {activeTrainingPrep ? <span className="badge success">prep attached</span> : null}
            {activeEvidenceImport ? <span className="badge success">intake attached</span> : null}
            {trainPrepArtifactId ? <span className="badge">{trainPrepArtifactId}</span> : null}
            {trainEvidenceImportId ? <span className="badge">{trainEvidenceImportId}</span> : null}
          </div>
          {trainPrepDocumentsPath ? <code>{trainPrepDocumentsPath}</code> : null}
          {trainPrepEvidencePath ? <code>{trainPrepEvidencePath}</code> : null}
        </div>
      ) : null}
      {currentRun ? (
        <div className="run-card">
          <strong>{currentRun.type}</strong>
          <p>{currentRunPresentation?.primaryMessage ?? currentRun.summary ?? currentRun.status}</p>
          <small>
            {(currentRunPresentation?.statusLabel ?? currentRun.status)} · {new Date(currentRun.started_at).toLocaleString()}
          </small>
          {currentRunPresentation?.secondaryMessage ? <small>{currentRunPresentation.secondaryMessage}</small> : null}
        </div>
      ) : null}
      {recentRuns.length > 0 ? (
        <div className="run-history">
          <div className="run-history-header">
            <strong>Recent runs</strong>
            <small>{selectedPersona ? selectedPersona.slug : 'global'}</small>
          </div>
          {recentRuns.slice(0, 6).map((run) => (
            <button
              key={run.id}
              type="button"
              className={run.id === currentRun?.id ? 'run-history-item active' : 'run-history-item'}
              onClick={() => void onSelectRun(run)}
            >
              <span>{run.type}</span>
              <span>{deriveWorkbenchRunPresentation(run).statusLabel}</span>
            </button>
          ))}
        </div>
      ) : null}
      {activeView === 'Train' && (latestTrainingPrep || latestEvidenceImport) ? (
        <div className="run-history">
          <div className="run-history-header">
            <strong>Preparation Assets</strong>
            <small>{selectedPersona ? selectedPersona.slug : 'persona required'}</small>
          </div>
          {latestTrainingPrep ? (
            <article className="settings-card">
              <strong>Latest Training Prep</strong>
              <p>{latestTrainingPrep.summary}</p>
              <small>{new Date(latestTrainingPrep.updated_at).toLocaleString()}</small>
              <code>{latestTrainingPrep.documents_path}</code>
              <code>{latestTrainingPrep.evidence_index_path}</code>
              <div className="settings-actions">
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => {
                    setTrainPrepDocumentsPath(latestTrainingPrep.documents_path);
                    setTrainPrepEvidencePath(latestTrainingPrep.evidence_index_path);
                    setTrainPrepArtifactId(latestTrainingPrep.id);
                    setTrainEvidenceImportId('');
                    onDefaultValuesChange({
                      trainPrepDocumentsPath: latestTrainingPrep.documents_path,
                      trainPrepEvidencePath: latestTrainingPrep.evidence_index_path,
                      trainPrepArtifactId: latestTrainingPrep.id,
                      trainEvidenceImportId: '',
                    });
                  }}
                >
                  Use Latest Prep
                </button>
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onCopyValue(latestTrainingPrep.documents_path, 'Training prep documents path')}
                >
                  Copy Docs Path
                </button>
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onCopyValue(latestTrainingPrep.evidence_index_path, 'Training prep evidence path')}
                >
                  Copy Evidence Path
                </button>
              </div>
            </article>
          ) : null}
          {latestEvidenceImport ? (
            <article className="settings-card">
              <strong>Latest Evidence Intake</strong>
              <p>{latestEvidenceImport.summary}</p>
              <small>{new Date(latestEvidenceImport.updated_at).toLocaleString()}</small>
              <code>{latestEvidenceImport.artifacts.documents_path}</code>
              <code>{latestEvidenceImport.artifacts.evidence_index_path}</code>
              <div className="settings-actions">
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => {
                    setTrainPrepDocumentsPath(latestEvidenceImport.artifacts.documents_path);
                    setTrainPrepEvidencePath(latestEvidenceImport.artifacts.evidence_index_path);
                    setTrainPrepArtifactId('');
                    setTrainEvidenceImportId(latestEvidenceImport.id);
                    onDefaultValuesChange({
                      trainPrepDocumentsPath: latestEvidenceImport.artifacts.documents_path,
                      trainPrepEvidencePath: latestEvidenceImport.artifacts.evidence_index_path,
                      trainPrepArtifactId: '',
                      trainEvidenceImportId: latestEvidenceImport.id,
                    });
                  }}
                >
                  Use Latest Import
                </button>
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onCopyValue(latestEvidenceImport.artifacts.documents_path, 'Evidence import documents path')}
                >
                  Copy Docs Path
                </button>
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => void onCopyValue(latestEvidenceImport.artifacts.evidence_index_path, 'Evidence import evidence path')}
                >
                  Copy Evidence Path
                </button>
              </div>
            </article>
          ) : null}
          <div className="settings-actions">
            <button
              type="button"
              className="action-button secondary"
              onClick={() => {
                setTrainPrepDocumentsPath('');
                setTrainPrepEvidencePath('');
                setTrainPrepArtifactId('');
                setTrainEvidenceImportId('');
                onDefaultValuesChange({
                  trainPrepDocumentsPath: '',
                  trainPrepEvidencePath: '',
                  trainPrepArtifactId: '',
                  trainEvidenceImportId: '',
                });
              }}
            >
              Clear Prep Context
            </button>
          </div>
          <div className="helper-text">
            Train launch only carries these prep/import fields as contextual metadata for traceability. It does not bypass the existing training core or write back into formal `Soul`.
          </div>
        </div>
      ) : null}
    </section>
  );
}

function deriveWorkbenchRunPresentation(run: WorkbenchRun): {
  statusLabel: string;
  primaryMessage: string;
  secondaryMessage?: string;
} {
  const recoveryState = run.recovery_state ?? 'idle';
  const attempts = run.attempt_count ?? 1;

  if (recoveryState === 'recovering') {
    return {
      statusLabel: 'recovering',
      primaryMessage: 'The system is retrying this run automatically.',
      secondaryMessage: attempts > 1
        ? `Saved progress is being reused. Recovery attempt ${attempts} is in progress.`
        : 'Saved progress will be reused when available.',
    };
  }

  if (run.status === 'failed') {
    return {
      statusLabel: 'paused',
      primaryMessage: 'This run is paused for now.',
      secondaryMessage: 'Progress has been saved safely for a later retry.',
    };
  }

  if (run.status === 'completed' && attempts > 1) {
    return {
      statusLabel: 'completed',
      primaryMessage: 'This run completed after automatic recovery.',
      secondaryMessage: 'A temporary issue was handled internally during the run.',
    };
  }

  return {
    statusLabel: run.status,
    primaryMessage: run.summary ?? run.status,
  };
}

function deriveCreateGuidance(input: {
  target: string;
  targetManifest: string;
  chatPlatform: string;
  rounds: string;
  trainingProfile: string;
  inputRouting: string;
  trainingSeedMode: string;
}): {
  tone: 'good' | 'warning' | 'neutral';
  statusLabel: string;
  summary: string;
  actions: string[];
  stages: Array<{ label: string; status: string; tone: 'good' | 'warning' | 'neutral' }>;
} {
  const hasTarget = Boolean(input.target.trim());
  const hasManifest = Boolean(input.targetManifest.trim());
  const rounds = Number(input.rounds || '1');

  const stages = [
    {
      label: 'Target',
      status: hasTarget ? 'provided' : 'missing',
      tone: hasTarget ? 'good' as const : 'warning' as const,
    },
    {
      label: 'Manifest',
      status: hasManifest ? 'attached' : 'optional',
      tone: hasManifest ? 'good' as const : 'neutral' as const,
    },
    {
      label: 'Profile',
      status: input.trainingProfile,
      tone: input.trainingProfile === 'full' ? 'good' as const : 'neutral' as const,
    },
    {
      label: 'Routing',
      status: `${input.inputRouting} / ${input.trainingSeedMode}`,
      tone: input.inputRouting === 'v2' || input.trainingSeedMode !== 'off' ? 'good' as const : 'neutral' as const,
    },
  ];

  if (!hasTarget) {
    return {
      tone: 'warning',
      statusLabel: 'add target',
      summary: 'A target is still missing, so persona creation cannot start yet.',
      actions: [
        'Add a target handle or local source identifier first.',
        'If you are creating from private chat or video evidence, attach a target manifest as well.',
      ],
      stages,
    };
  }

  if (!hasManifest) {
    return {
      tone: 'neutral',
      statusLabel: 'manifest optional',
      summary: `You can create directly from ${input.chatPlatform}, but a target manifest gives better speaker attribution when you move into chat or video evidence.`,
      actions: [
        'Proceed if this is a simple public-source create flow.',
        'Add a target manifest now if you expect to use private chat or video evidence soon.',
      ],
      stages,
    };
  }

  if (rounds <= 1) {
    return {
      tone: 'good',
      statusLabel: 'start lean',
      summary: 'This create setup is lightweight and suitable for a first pass persona bootstrap.',
      actions: [
        'Launch create now to generate the initial persona asset.',
        'Use Train or Experiment afterward to deepen and validate the profile.',
      ],
      stages,
    };
  }

  return {
    tone: 'good',
    statusLabel: 'ready to create',
    summary: 'The create form has enough structure for a richer first-pass persona bootstrap.',
    actions: [
      'Launch create now to build the persona baseline.',
      'After creation, move into Train or Experiment to validate routing and stability.',
    ],
    stages,
  };
}

function deriveTrainLaunchGuidance(input: {
  activeTrainingPrep: TrainingPrepArtifact | null;
  activeEvidenceImport: WorkbenchEvidenceImport | null;
  trainPrepDocumentsPath: string;
  trainPrepEvidencePath: string;
  rounds: string;
  trainMode: string;
}): {
  tone: 'good' | 'warning' | 'neutral';
  statusLabel: string;
  summary: string;
  actions: string[];
  stages: Array<{ label: string; status: string; tone: 'good' | 'warning' | 'neutral' }>;
} {
  const hasManualContext = Boolean(input.trainPrepDocumentsPath || input.trainPrepEvidencePath);
  const stages = [
    {
      label: 'Corpus',
      status: input.activeTrainingPrep ? 'prep artifact' : input.activeEvidenceImport ? 'evidence intake' : hasManualContext ? 'manual paths' : 'none',
      tone: input.activeTrainingPrep || input.activeEvidenceImport || hasManualContext ? 'good' as const : 'warning' as const,
    },
    {
      label: 'Launch Mode',
      status: input.trainMode === 'quick' ? 'quick' : 'full',
      tone: input.trainMode === 'quick' ? 'neutral' as const : 'good' as const,
    },
    {
      label: 'Rounds',
      status: input.rounds || '1',
      tone: Number(input.rounds || '1') > 1 ? 'good' as const : 'neutral' as const,
    },
  ];

  if (input.activeTrainingPrep) {
    return {
      tone: 'good',
      statusLabel: 'start with smoke',
      summary: 'A training prep artifact is attached, so the train path is ready. Start with Smoke to verify the prep before a longer run.',
      actions: [
        'Run Smoke first to validate the attached prep artifact.',
        'If Smoke stays stable, run the full train flow with the same context.',
      ],
      stages,
    };
  }

  if (input.activeEvidenceImport) {
    const stats = input.activeEvidenceImport.stats;
    if (stats.target_windows === 0 || (stats.cross_session_stable_items === 0 && stats.windows <= 8)) {
      return {
        tone: 'warning',
        statusLabel: 'expand corpus first',
        summary: 'The attached intake is still thin, so a longer train run would likely be noisy.',
        actions: [
          'Import a larger slice of the corpus before training.',
          'If you still want to probe it, keep the next run to Smoke only.',
        ],
        stages,
      };
    }

    if (stats.blocked_scene_items > stats.cross_session_stable_items && stats.blocked_scene_items >= 3) {
      return {
        tone: 'neutral',
        statusLabel: 'smoke with caution',
        summary: 'The intake has usable evidence, but scene filtering is doing a lot of work. Verify with Smoke before any longer run.',
        actions: [
          'Run Smoke first and inspect the result before scaling up.',
          'If the result feels noisy, go back and refine the corpus or route it through handoff review.',
        ],
        stages,
      };
    }

    return {
      tone: 'good',
      statusLabel: 'smoke then train',
      summary: 'The attached intake looks healthy enough to move into train. Smoke is still the safest first step before a full run.',
      actions: [
        'Run Smoke first to verify the intake behaves as expected in training.',
        'If Smoke is stable, continue with a longer run using the same context.',
      ],
      stages,
    };
  }

  if (hasManualContext) {
    return {
      tone: 'neutral',
      statusLabel: 'manual context attached',
      summary: 'Manual training context is attached. Smoke is the safest way to validate these paths before a longer run.',
      actions: [
        'Run Smoke first to verify the attached paths resolve correctly.',
        'Keep the same paths for a longer run only after Smoke completes cleanly.',
      ],
      stages,
    };
  }

  return {
    tone: 'warning',
    statusLabel: 'attach context',
    summary: 'No prep artifact or evidence intake is attached to this train form yet.',
    actions: [
      'Attach a recent evidence intake or a training prep artifact first.',
      'If you want more control, review candidates and create handoff plus prep before training.',
    ],
    stages,
  };
}

function deriveExperimentGuidance(input: {
  selectedPersona: PersonaSummary | null;
  latestTrainingPrep: TrainingPrepArtifact | null;
  latestEvidenceImport: WorkbenchEvidenceImport | null;
  experimentProfiles: string;
  rounds: string;
  questionsPerRound: string;
  experimentGate: boolean;
  experimentCompareInputRouting: boolean;
  experimentCompareTrainingSeed: boolean;
  experimentCompareVariants: string;
}): {
  tone: 'good' | 'warning' | 'neutral';
  statusLabel: string;
  summary: string;
  actions: string[];
  stages: Array<{ label: string; status: string; tone: 'good' | 'warning' | 'neutral' }>;
} {
  const rounds = Number(input.rounds || '1');
  const questions = Number(input.questionsPerRound || '5');
  const compareMode = input.experimentCompareVariants.trim()
    ? 'custom variants'
    : input.experimentCompareInputRouting && input.experimentCompareTrainingSeed
      ? 'routing + seed'
      : input.experimentCompareInputRouting
        ? 'routing'
        : input.experimentCompareTrainingSeed
          ? 'seed'
          : 'profile only';
  const corpusSource = input.latestTrainingPrep
    ? 'prep artifact'
    : input.latestEvidenceImport
      ? 'evidence intake'
      : 'none';

  const stages = [
    {
      label: 'Corpus',
      status: corpusSource,
      tone: corpusSource === 'none' ? 'warning' as const : 'good' as const,
    },
    {
      label: 'Compare Mode',
      status: compareMode,
      tone: compareMode === 'profile only' ? 'neutral' as const : 'good' as const,
    },
    {
      label: 'Gate',
      status: input.experimentGate ? 'enabled' : 'review only',
      tone: input.experimentGate ? 'good' as const : 'neutral' as const,
    },
    {
      label: 'Sample Size',
      status: `${rounds} rounds x ${questions} q`,
      tone: rounds >= 2 && questions >= 5 ? 'good' as const : 'neutral' as const,
    },
  ];

  if (!input.selectedPersona) {
    return {
      tone: 'warning',
      statusLabel: 'select persona',
      summary: 'Choose a persona before launching an experiment.',
      actions: [
        'Select the target persona first.',
        'Then decide whether to compare profiles only or run a routing/seed PK.',
      ],
      stages,
    };
  }

  if (!input.latestTrainingPrep && !input.latestEvidenceImport) {
    return {
      tone: 'warning',
      statusLabel: 'attach corpus first',
      summary: 'This persona does not have a recent prep artifact or intake context visible in the workbench yet.',
      actions: [
        'Import evidence or build a training prep artifact first.',
        'Use experiment after the training context for this persona is clearer.',
      ],
      stages,
    };
  }

  if (rounds <= 1 || questions < 5) {
    return {
      tone: 'neutral',
      statusLabel: 'quick probe',
      summary: 'This experiment is currently configured as a light probe. Good for a sanity check, but not ideal for final routing decisions.',
      actions: [
        'Use this setup for a quick validation pass.',
        'Increase rounds or questions when you want a more trustworthy PK result.',
      ],
      stages,
    };
  }

  if (compareMode === 'profile only') {
    return {
      tone: 'neutral',
      statusLabel: 'profile sweep',
      summary: 'This setup is best for checking the best training profile before comparing routing or seed variants.',
      actions: [
        'Run the profile sweep first if you still need a stable baseline.',
        'After that, enable routing or seed comparison for a cleaner PK.',
      ],
      stages,
    };
  }

  return {
    tone: 'good',
    statusLabel: input.experimentGate ? 'ready for PK' : 'review PK',
    summary: input.experimentGate
      ? 'This experiment is ready for a gated PK decision.'
      : 'This experiment is ready for a comparison run. Review the output before treating it as a decision gate.',
    actions: [
      'Run the experiment and inspect clean mean plus excluded runs in the report.',
      'If the result is stable, keep the winning routing or seed path and carry it forward into the next training round.',
    ],
    stages,
  };
}
