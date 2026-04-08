import { Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
import { PersonaConfig, PersonaDetail, WorkbenchRun } from '../lib/types';
import { useI18n } from '../lib/i18n';

interface PersonaLibraryScreenProps {
  detail: PersonaDetail | null;
  run: WorkbenchRun | null;
  mode: 'view' | 'create';
  onCreate: (payload: CreatePayload) => Promise<void>;
  onSave: (slug: string, payload: CreatePayload) => Promise<void>;
  onDelete: (slug: string) => Promise<void>;
  onStartChat: (slug: string) => Promise<void>;
  onCancelCreate: () => void;
}

export interface CreatePayload {
  name: string;
  source_type: PersonaConfig['source_type'];
  source_target?: string;
  source_path?: string;
  target_manifest_path?: string;
  platform?: string;
}

const EMPTY_FORM: CreatePayload = {
  name: '',
  source_type: 'social',
  source_target: '',
  source_path: '',
  target_manifest_path: '',
  platform: 'x',
};

export function PersonaLibraryScreen({
  detail,
  run,
  mode,
  onCreate,
  onSave,
  onDelete,
  onStartChat,
  onCancelCreate,
}: PersonaLibraryScreenProps) {
  const { locale } = useI18n();
  const isZh = locale === 'zh-CN';
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<CreatePayload>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode === 'create') {
      setForm(EMPTY_FORM);
      setStep(1);
      return;
    }
    if (detail) {
      setForm({
        name: detail.config.name,
        source_type: detail.config.source_type,
        source_target: detail.config.source_target ?? '',
        source_path: detail.config.source_path ?? '',
        target_manifest_path: detail.config.target_manifest_path ?? '',
        platform: detail.config.platform ?? 'x',
      });
      setStep(1);
    }
  }, [detail, mode]);

  const canMoveStep2 = form.name.trim().length > 0;
  const canSubmit = useMemo(() => {
    if (!form.name.trim()) return false;
    if (form.source_type === 'social') return Boolean(form.source_target?.trim());
    return Boolean(form.source_path?.trim() && form.target_manifest_path?.trim());
  }, [form]);

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await onCreate(normalizePayload(form));
      } else if (detail) {
        await onSave(detail.persona.slug, normalizePayload(form));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === 'create') {
    return (
      <section className="screen persona-screen">
        <header className="screen-header compact-gap">
          <div>
            <p className="screen-eyebrow">{isZh ? '两步创建' : 'Two-step Create'}</p>
            <h1>{isZh ? '新建人格' : 'Create Persona'}</h1>
            <p className="screen-subtitle">{isZh ? '只填写用户能理解的信息，后台会自动完成后续构建。' : 'Only user-facing inputs are required. Background rebuilding stays hidden.'}</p>
          </div>
          <button type="button" className="ghost-button" onClick={onCancelCreate}>
            {isZh ? '取消' : 'Cancel'}
          </button>
        </header>

        <div className="wizard-steps">
          <div className={step === 1 ? 'wizard-step active' : 'wizard-step'}>1. {isZh ? '基础信息' : 'Basics'}</div>
          <div className={step === 2 ? 'wizard-step active' : 'wizard-step'}>2. {isZh ? '来源信息' : 'Source'}</div>
        </div>

        {step === 1 ? (
          <div className="form-card">
            <label className="field-block">
              <span>{isZh ? '名称' : 'Name'}</span>
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={isZh ? '例如：Karpathy' : 'For example: Karpathy'} />
            </label>
            <label className="field-block">
              <span>{isZh ? '来源类型' : 'Source Type'}</span>
              <select
                value={form.source_type}
                onChange={(event) => setForm((current) => ({ ...current, source_type: event.target.value as PersonaConfig['source_type'] }))}
              >
                <option value="social">{isZh ? '公开账号' : 'Public Account'}</option>
                <option value="chat_file">{isZh ? '聊天资料' : 'Chat File'}</option>
                <option value="video_file">{isZh ? '视频资料' : 'Video File'}</option>
              </select>
            </label>
            <div className="form-actions">
              <button type="button" className="primary-button" onClick={() => setStep(2)} disabled={!canMoveStep2}>
                {isZh ? '下一步' : 'Next'}
              </button>
            </div>
          </div>
        ) : (
          <div className="form-card">
            <SourceFields form={form} setForm={setForm} isZh={isZh} />
            <div className="form-actions split">
              <button type="button" className="ghost-button" onClick={() => setStep(1)}>
                {isZh ? '上一步' : 'Back'}
              </button>
              <button type="button" className="primary-button" onClick={() => void handleSubmit()} disabled={!canSubmit || submitting}>
                {submitting ? (isZh ? '创建中…' : 'Creating...') : (isZh ? '创建人格' : 'Create Persona')}
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="screen persona-screen empty-screen">
        <div className="empty-screen-card">
          <p className="screen-eyebrow">{isZh ? '人格库' : 'Persona Library'}</p>
          <h1>{isZh ? '先选一个人格，或者创建新的' : 'Select a persona or create a new one'}</h1>
          <p className="screen-subtitle">{isZh ? '这里不会展示任何训练术语，只保留你真正需要管理的内容。' : 'Only the user-facing persona information lives here.'}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="screen persona-screen">
      <header className="screen-header compact-gap">
        <div>
          <p className="screen-eyebrow">{isZh ? '人格详情' : 'Persona Detail'}</p>
          <h1>{detail.persona.name}</h1>
          <p className="screen-subtitle">{isZh ? `${statusLabel(detail.persona.status, true)} · 更新于 ${new Date(detail.persona.updated_at).toLocaleString()}` : `${statusLabel(detail.persona.status, false)} · Updated ${new Date(detail.persona.updated_at).toLocaleString()}`}</p>
        </div>
        <div className="persona-header-actions">
          <button type="button" className="ghost-button" onClick={() => void onStartChat(detail.persona.slug)}>
            {isZh ? '开始聊天' : 'Start Chat'}
          </button>
          <button type="button" className="ghost-button danger" onClick={() => void onDelete(detail.persona.slug)}>
            {isZh ? '删除人格' : 'Delete Persona'}
          </button>
        </div>
      </header>

      <div className="detail-grid">
        <section className="detail-card">
          <h3>{isZh ? '基础信息' : 'Basics'}</h3>
          <div className="detail-row"><span>{isZh ? '名称' : 'Name'}</span><strong>{detail.persona.name}</strong></div>
          <div className="detail-row"><span>{isZh ? '标识' : 'Slug'}</span><strong>{detail.persona.slug}</strong></div>
          <div className="detail-row"><span>{isZh ? '状态' : 'Status'}</span><strong>{statusLabel(detail.persona.status, isZh)}</strong></div>
          <div className="detail-row"><span>{isZh ? '最近更新' : 'Updated'}</span><strong>{new Date(detail.persona.updated_at).toLocaleString()}</strong></div>
        </section>

        <section className="detail-card wide">
          <h3>{isZh ? '编辑来源信息' : 'Edit Source'}</h3>
          <div className="form-card embedded">
            <label className="field-block">
              <span>{isZh ? '名称' : 'Name'}</span>
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="field-block">
              <span>{isZh ? '来源类型' : 'Source Type'}</span>
              <select
                value={form.source_type}
                onChange={(event) => setForm((current) => ({ ...current, source_type: event.target.value as PersonaConfig['source_type'] }))}
              >
                <option value="social">{isZh ? '公开账号' : 'Public Account'}</option>
                <option value="chat_file">{isZh ? '聊天资料' : 'Chat File'}</option>
                <option value="video_file">{isZh ? '视频资料' : 'Video File'}</option>
              </select>
            </label>
            <SourceFields form={form} setForm={setForm} isZh={isZh} />
            <div className="form-actions split">
              <div className="inline-status">{run?.persona_slug === detail.persona.slug && run.status === 'running' ? (isZh ? '后台正在更新这个人格…' : 'Updating this persona in the background...') : null}</div>
              <button type="button" className="primary-button" onClick={() => void handleSubmit()} disabled={!canSubmit || submitting}>
                {submitting ? (isZh ? '保存中…' : 'Saving...') : (isZh ? '保存并后台重建' : 'Save and Rebuild')}
              </button>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function SourceFields({
  form,
  setForm,
  isZh,
}: {
  form: CreatePayload;
  setForm: Dispatch<SetStateAction<CreatePayload>>;
  isZh: boolean;
}) {
  if (form.source_type === 'social') {
    return (
      <>
        <label className="field-block">
          <span>{isZh ? '账号 / 标识' : 'Account / Handle'}</span>
          <input value={form.source_target ?? ''} onChange={(event) => setForm((current) => ({ ...current, source_target: event.target.value }))} placeholder={isZh ? '@karpathy' : '@karpathy'} />
        </label>
        <label className="field-block">
          <span>{isZh ? '平台' : 'Platform'}</span>
          <input value={form.platform ?? ''} onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value }))} placeholder={isZh ? '例如：X' : 'For example: X'} />
        </label>
      </>
    );
  }

  return (
    <>
      <label className="field-block">
        <span>{isZh ? '源文件路径' : 'Source File Path'}</span>
        <input value={form.source_path ?? ''} onChange={(event) => setForm((current) => ({ ...current, source_path: event.target.value }))} placeholder="/absolute/path/to/source" />
      </label>
      <label className="field-block">
        <span>{isZh ? '目标清单路径' : 'Target Manifest Path'}</span>
        <input value={form.target_manifest_path ?? ''} onChange={(event) => setForm((current) => ({ ...current, target_manifest_path: event.target.value }))} placeholder="/absolute/path/to/target-manifest.json" />
      </label>
      {form.source_type === 'chat_file' ? (
        <label className="field-block">
          <span>{isZh ? '平台' : 'Platform'}</span>
          <select value={form.platform ?? 'wechat'} onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value }))}>
            <option value="wechat">{isZh ? '微信' : 'WeChat'}</option>
            <option value="feishu">{isZh ? '飞书' : 'Feishu'}</option>
          </select>
        </label>
      ) : null}
    </>
  );
}

function normalizePayload(form: CreatePayload): CreatePayload {
  return {
    name: form.name.trim(),
    source_type: form.source_type,
    source_target: form.source_target?.trim() || undefined,
    source_path: form.source_path?.trim() || undefined,
    target_manifest_path: form.target_manifest_path?.trim() || undefined,
    platform: form.platform?.trim() || undefined,
  };
}

function statusLabel(status: string, isZh: boolean): string {
  if (['creating'].includes(status)) return isZh ? '创建中' : 'Creating';
  if (['training', 'ingesting', 'refining', 'updating'].includes(status)) return isZh ? '更新中' : 'Updating';
  if (['converged', 'exported', 'available'].includes(status)) return isZh ? '可用' : 'Ready';
  return isZh ? '可用' : 'Ready';
}
