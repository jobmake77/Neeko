import { FormEvent, useMemo, useState } from 'react';
import { NavView, PersonaSummary, WorkbenchRun } from '../lib/types';

interface WorkbenchFormsProps {
  activeView: Exclude<NavView, 'Chat'>;
  selectedPersona: PersonaSummary | null;
  currentRun: WorkbenchRun | null;
  recentRuns: WorkbenchRun[];
  onCreatePersona: (payload: Record<string, unknown>) => Promise<void>;
  onStartTraining: (payload: Record<string, unknown>) => Promise<void>;
  onStartExperiment: (payload: Record<string, unknown>) => Promise<void>;
  onExportPersona: (payload: Record<string, unknown>) => Promise<void>;
  onSelectRun: (run: WorkbenchRun) => Promise<void>;
  apiBaseUrl: string;
  onApiBaseUrlChange: (value: string) => void;
  defaultValues: {
    createTarget: string;
    rounds: string;
    trainingProfile: string;
    inputRouting: string;
    questionsPerRound: string;
    exportFormat: string;
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
    onCreatePersona,
    onStartTraining,
    onStartExperiment,
    onExportPersona,
    onSelectRun,
    apiBaseUrl,
    onApiBaseUrlChange,
    defaultValues,
    onDefaultValuesChange,
    serviceHealthy,
  } = props;
  const [target, setTarget] = useState(defaultValues.createTarget);
  const [rounds, setRounds] = useState(defaultValues.rounds);
  const [trainingProfile, setTrainingProfile] = useState(defaultValues.trainingProfile);
  const [inputRouting, setInputRouting] = useState(defaultValues.inputRouting);
  const [questionsPerRound, setQuestionsPerRound] = useState(defaultValues.questionsPerRound);
  const [exportFormat, setExportFormat] = useState(defaultValues.exportFormat);

  const title = useMemo(() => {
    if (activeView === 'Create') return 'Create Persona';
    if (activeView === 'Train') return 'Train Persona';
    if (activeView === 'Experiment') return 'Run Experiment';
    if (activeView === 'Export') return 'Export Persona';
    return 'Settings';
  }, [activeView]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeView === 'Create') {
      await onCreatePersona({ target, rounds: Number(rounds), trainingProfile, inputRouting });
      return;
    }
    if (!selectedPersona) return;
    if (activeView === 'Train') {
      await onStartTraining({ slug: selectedPersona.slug, rounds: Number(rounds), trainingProfile, inputRouting });
      return;
    }
    if (activeView === 'Experiment') {
      await onStartExperiment({
        slug: selectedPersona.slug,
        rounds: Number(rounds),
        questionsPerRound: Number(questionsPerRound),
        inputRouting,
        compareInputRouting: true,
      });
      return;
    }
    if (activeView === 'Export') {
      await onExportPersona({ slug: selectedPersona.slug, format: exportFormat });
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
        <p className="helper-text">
          The desktop shell talks to the structured local API. Default is `http://127.0.0.1:4310`.
        </p>
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
    </section>
  );
}
