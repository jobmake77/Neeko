import { FormEvent, useMemo, useState } from 'react';
import { NavView, PersonaSummary, TrainingPrepArtifact, WorkbenchEvidenceImport, WorkbenchRun } from '../lib/types';

interface WorkbenchFormsProps {
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
      await onStartTraining({
        slug: selectedPersona.slug,
        mode: trainMode,
        rounds: Number(rounds),
        track: trainTrack,
        trainingProfile,
        inputRouting,
        trainingSeedMode,
        retries: Number(trainRetries),
        fromCheckpoint: trainFromCheckpoint || undefined,
        kimiStabilityMode,
        prepDocumentsPath: trainPrepDocumentsPath || undefined,
        prepEvidencePath: trainPrepEvidencePath || undefined,
        prepArtifactId: trainPrepArtifactId || undefined,
        evidenceImportId: trainEvidenceImportId || undefined,
      });
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
    return (
      <section className="workspace panel form-panel">
        <div className="panel-header workspace-header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Local Service</h2>
          </div>
          <span className={serviceHealthy ? 'badge success' : 'badge warning'}>
            {serviceHealthy ? 'Connected' : 'Offline'}
          </span>
        </div>
        <label className="field">
          <span>Workbench server URL</span>
          <input value={apiBaseUrl} onChange={(event) => onApiBaseUrlChange(event.target.value)} />
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
          <strong>Recommended local flow</strong>
          <code>npm run workbench:server</code>
          <code>npm --prefix desktop run dev</code>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace panel form-panel">
      <div className="panel-header workspace-header">
        <div>
          <p className="eyebrow">Workbench</p>
          <h2>{title}</h2>
        </div>
        {selectedPersona ? <span className="badge">{selectedPersona.name}</span> : null}
      </div>
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
      </form>
      {currentRun ? (
        <div className="run-card">
          <strong>{currentRun.type}</strong>
          <p>{currentRun.summary ?? currentRun.status}</p>
          <small>
            {currentRun.status} · {new Date(currentRun.started_at).toLocaleString()}
          </small>
          {currentRun.report_path ? <code>{currentRun.report_path}</code> : null}
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
              <span>{run.status}</span>
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
