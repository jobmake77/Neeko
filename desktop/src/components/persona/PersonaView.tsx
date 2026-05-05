import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '@/stores/app';
import { useChatStore } from '@/stores/chat';
import { useCultivationStore } from '@/stores/cultivation';
import { usePersonaStore } from '@/stores/persona';
import { t } from '@/lib/i18n';
import type { CultivationDetail, PersonaSummary } from '@/lib/types';
import * as api from '@/lib/api';
import { CultivationCenter } from './CultivationCenter';
import { PersonaCard } from './PersonaCard';
import { PersonaEditor } from './PersonaEditor';

function isReadyPersona(status?: string, isReady?: boolean): boolean {
  if (isReady) return true;
  return ['ready', 'available', 'converged', 'exported'].includes(String(status ?? '').toLowerCase());
}

function formatPersonaStatus(status?: string, isReady?: boolean): string {
  if (isReadyPersona(status, isReady)) return '可对话';
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'error') return '需要处理';
  if (['creating', 'created', 'pending'].includes(normalized)) return '待更新';
  return '后台更新中';
}

function formatDate(value?: string): string {
  if (!value) return '未记录';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatProgress(persona: PersonaSummary, detail?: CultivationDetail): number {
  return Math.max(0, Math.min(100, detail?.progress.percent ?? persona.progress_percent ?? (isReadyPersona(persona.status, persona.is_ready) ? 100 : 0)));
}

function sourceTypeLabel(type?: string) {
  if (type === 'social') return '公开账号';
  if (type === 'chat_file') return '聊天资料';
  if (type === 'video_file') return '视频资料';
  if (type === 'audio_file') return '音频资料';
  if (type === 'article') return '网页文章';
  return type || '混合来源';
}

function DetailStat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="detail-stat">
      <div className="detail-stat-label">{label}</div>
      <div className="detail-stat-value">{value}</div>
      {hint ? <div className="muted-copy" style={{ marginTop: 5 }}>{hint}</div> : null}
    </div>
  );
}

function EmptyDetail({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="persona-detail-panel surface-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <div className="persona-avatar" style={{ marginBottom: 18 }}>
          <span>N</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 750, color: 'rgb(var(--text-primary))' }}>还没有人格</div>
        <div className="muted-copy" style={{ marginTop: 8 }}>创建后会在这里看到概览、来源、后台更新和关系信息。</div>
        <button className="btn btn-primary" onClick={onCreate} style={{ marginTop: 18 }}>
          <Plus size={14} />
          {t('newPersona')}
        </button>
      </div>
    </div>
  );
}

export function PersonaView() {
  const { personas, loading, load, remove } = usePersonaStore();
  const { details, load: loadCultivation, loadDetail, reload: reloadCultivation } = useCultivationStore();
  const { setPersona } = useChatStore();
  const { setView } = useAppStore();
  const [query, setQuery] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editTarget, setEditTarget] = useState<PersonaSummary | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<PersonaSummary | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deletePending, setDeletePending] = useState(false);
  const [activeTab, setActiveTab] = useState<'library' | 'cultivation'>('library');
  const [pendingAction, setPendingAction] = useState<'check' | 'continue' | null>(null);

  useEffect(() => {
    void load();
    void loadCultivation();
  }, [load, loadCultivation]);

  useEffect(() => {
    const ready = personas.filter((item) => isReadyPersona(item.status, item.is_ready));
    if (selectedSlug && ready.some((item) => item.slug === selectedSlug)) return;
    setSelectedSlug(ready[0]?.slug ?? null);
  }, [personas, selectedSlug]);

  const readyPersonas = useMemo(() => personas.filter((item) => isReadyPersona(item.status, item.is_ready)), [personas]);
  const selectedPersona = useMemo(
    () => readyPersonas.find((item) => item.slug === selectedSlug) ?? readyPersonas[0],
    [readyPersonas, selectedSlug],
  );
  const selectedDetail = selectedPersona ? details[selectedPersona.slug] : undefined;
  const cultivatingCount = useCultivationStore((state) => state.cultivating.length);
  const filteredPersonas = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return readyPersonas;
    return readyPersonas.filter((item) => `${item.name} ${item.slug}`.toLowerCase().includes(normalized));
  }, [readyPersonas, query]);

  useEffect(() => {
    if (!selectedPersona) return;
    if (details[selectedPersona.slug]) return;
    void loadDetail(selectedPersona.slug);
  }, [details, loadDetail, selectedPersona]);

  function handleEdit(persona: PersonaSummary) {
    setEditorMode('edit');
    setEditTarget(persona);
    setEditorOpen(true);
  }

  function handleCreate() {
    setEditorMode('create');
    setEditTarget(undefined);
    setEditorOpen(true);
  }

  function handleSaved(persona: PersonaSummary) {
    setSelectedSlug(persona.slug);
    void load();
    void loadCultivation();
    void loadDetail(persona.slug);
  }

  async function handleStartChat(persona: PersonaSummary) {
    if (!isReadyPersona(persona.status, persona.is_ready)) return;
    await setPersona(persona.slug);
    setView('chat');
  }

  async function handleCheckUpdates(persona: PersonaSummary) {
    setPendingAction('check');
    try {
      await api.checkPersonaUpdates(persona.slug);
      await Promise.all([load(), reloadCultivation(), loadDetail(persona.slug)]);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleContinue(persona: PersonaSummary) {
    setPendingAction('continue');
    try {
      await api.continueCultivation(persona.slug);
      await Promise.all([load(), reloadCultivation(), loadDetail(persona.slug)]);
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deletePending) return;
    setDeleteError('');
    setDeletePending(true);
    try {
      await remove(deleteTarget.slug);
      useCultivationStore.getState().remove(deleteTarget.slug);
      setDeleteTarget(null);
    } catch (e: unknown) {
      setDeleteError((e as Error).message || '删除失败');
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div className="workspace-view">
      <div className="view-header">
        <div className="view-container">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18, marginBottom: 18, flexWrap: 'wrap' }}>
            <div>
              <h1 className="page-title" style={{ margin: 0 }}>{t('personas')}</h1>
              <div style={{ marginTop: 8, color: 'rgb(var(--text-secondary))', fontSize: 15 }}>
                可对话人格放在人格库，未完成的人格留在培养中心。
              </div>
            </div>
            <button className="btn btn-primary" onClick={handleCreate} style={{ height: 40, borderRadius: 8, padding: '0 16px' }}>
              <Plus size={15} />
              {t('newPersona')}
            </button>
          </div>
        </div>
      </div>

      <div className="workspace-body">
        <div className="view-container" style={{ height: '100%', minHeight: 0 }}>
          <div className="tab-strip" style={{ marginBottom: 14 }}>
            <button
              className={`tab-button${activeTab === 'library' ? ' active' : ''}`}
              onClick={() => setActiveTab('library')}
            >
              我的人格
            </button>
            <button
              className={`tab-button${activeTab === 'cultivation' ? ' active' : ''}`}
              onClick={() => setActiveTab('cultivation')}
            >
              培养中心{cultivatingCount > 0 ? ` · ${cultivatingCount}` : ''}
            </button>
          </div>

          {activeTab === 'library' ? (
            <div className="persona-library-layout">
              <aside className="persona-list-panel surface-panel" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: 14, borderBottom: '1px solid rgb(var(--border-light))' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                    <div>
                      <div className="section-heading">人格列表</div>
                      <div className="muted-copy">{readyPersonas.length} 个可对话人格</div>
                    </div>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'rgb(var(--text-tertiary))' }} />
                    <input
                      className="input"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索人格"
                      style={{ height: 36, borderRadius: 8, paddingLeft: 32 }}
                    />
                  </div>
                </div>

                <div className="persona-list-scroll" style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {loading ? (
                    <div className="muted-copy" style={{ padding: 12 }}>{t('loading')}</div>
                  ) : filteredPersonas.length === 0 ? (
                    <div className="muted-copy" style={{ padding: 12 }}>{query ? '没有匹配的人格' : '培养完成后的人格会出现在这里。'}</div>
                  ) : (
                    filteredPersonas.map((persona) => (
                      <PersonaCard
                        key={persona.slug}
                        persona={persona}
                        selected={persona.slug === selectedPersona?.slug}
                        onSelect={() => setSelectedSlug(persona.slug)}
                        onEdit={() => handleEdit(persona)}
                        onDelete={() => setDeleteTarget(persona)}
                      />
                    ))
                  )}
                </div>
              </aside>

              {selectedPersona ? (
                <PersonaDetail
                  persona={selectedPersona}
                  detail={selectedDetail}
                  pendingAction={pendingAction}
                  onEdit={() => handleEdit(selectedPersona)}
                  onDelete={() => setDeleteTarget(selectedPersona)}
                  onStartChat={() => void handleStartChat(selectedPersona)}
                  onCheckUpdates={() => void handleCheckUpdates(selectedPersona)}
                  onContinue={() => void handleContinue(selectedPersona)}
                />
              ) : (
                <EmptyDetail onCreate={handleCreate} />
              )}
            </div>
          ) : (
            <div className="surface-panel" style={{ height: 'calc(100% - 52px)', minHeight: 0, overflow: 'hidden' }}>
              <CultivationCenter
                onEdit={handleEdit}
                onDelete={(persona) => setDeleteTarget(persona)}
              />
            </div>
          )}
        </div>
      </div>

      <PersonaEditor
        mode={editorMode}
        persona={editTarget}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={handleSaved}
      />

      {deleteTarget && (
        <>
          <div
            onClick={() => { setDeleteTarget(null); setDeleteError(''); }}
            style={{ position: 'fixed', inset: 0, background: 'rgb(0 0 0 / 0.4)', zIndex: 300 }}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgb(var(--bg-card))',
              border: '1px solid rgb(var(--border))',
              borderRadius: 8,
              padding: 24,
              width: 380,
              zIndex: 301,
              boxShadow: '0 20px 40px rgb(0 0 0 / 0.2)',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: 'rgb(var(--text-primary))', marginBottom: 8 }}>{t('confirmDelete')}</div>
            <div style={{ fontSize: 13, color: 'rgb(var(--text-secondary))', lineHeight: 1.6, marginBottom: 20 }}>{t('confirmDeletePersonaMsg')}</div>
            {deleteError && (
              <div style={{ fontSize: 12, color: '#ef4444', padding: '6px 10px', background: 'rgb(239 68 68 / 0.08)', borderRadius: 6, marginBottom: 12 }}>
                {deleteError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => { setDeleteTarget(null); setDeleteError(''); }} disabled={deletePending}>{t('cancel')}</button>
              <button className="btn btn-primary" onClick={() => void confirmDelete()} disabled={deletePending} style={{ background: '#ef4444' }}>
                {deletePending ? '删除中…' : t('delete')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PersonaDetail({
  persona,
  detail,
  pendingAction,
  onEdit,
  onDelete,
  onStartChat,
  onCheckUpdates,
  onContinue,
}: {
  persona: PersonaSummary;
  detail?: CultivationDetail;
  pendingAction: 'check' | 'continue' | null;
  onEdit: () => void;
  onDelete: () => void;
  onStartChat: () => void;
  onCheckUpdates: () => void;
  onContinue: () => void;
}) {
  const ready = isReadyPersona(persona.status, persona.is_ready);
  const progress = formatProgress(persona, detail);
  const sourceSummary = detail?.source_summary;
  const network = detail?.network_summary ?? sourceSummary?.network_summary;
  const sourceCount = sourceSummary?.total_sources ?? persona.source_count ?? 0;
  const enabledSourceCount = sourceSummary?.enabled_sources ?? persona.source_count ?? 0;
  const cleanDocumentCount = detail?.clean_document_count ?? sourceSummary?.clean_document_count ?? persona.doc_count;
  const relationCount = network?.relation_count ?? persona.memory_node_count;
  const phaseLabel = detail?.soft_closed || sourceSummary?.soft_closed
    ? '已按当前素材完成一版'
    : formatPersonaStatus(detail?.phase ?? persona.status, persona.is_ready);
  const statusColor = ready ? '#22c55e' : persona.status === 'error' ? '#ef4444' : '#0ea5e9';

  return (
    <section className="persona-detail-panel surface-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 18, borderBottom: '1px solid rgb(var(--border-light))', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
          <div className="persona-avatar">
            <span>{persona.name.charAt(0).toUpperCase()}</span>
            <i className="avatar-status" style={{ background: statusColor }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 22, lineHeight: 1.2, fontWeight: 800, color: 'rgb(var(--text-primary))' }}>{persona.name}</h2>
              <span className="status-pill">
                <span style={{ width: 7, height: 7, borderRadius: 999, background: statusColor }} />
                {phaseLabel}
              </span>
            </div>
            <div className="muted-copy" style={{ marginTop: 7 }}>
              {sourceTypeLabel(persona.source_type)} · 最近更新 {formatDate(persona.updated_at)}
            </div>
          </div>
        </div>
        <button className="btn btn-icon" onClick={onDelete} title={t('deletePersona')} style={{ color: '#ef4444', width: 34, height: 34 }}>
          <Trash2 size={15} />
        </button>
      </div>

      <div className="detail-scroll" style={{ flex: 1, padding: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <button className="btn btn-secondary" onClick={onEdit}>{t('editPersona')}</button>
          <button className="btn btn-primary" onClick={onStartChat} disabled={!ready}>
            <MessageCircle size={14} />
            {t('startChat')}
          </button>
          <button className="btn btn-secondary" onClick={onCheckUpdates} disabled={Boolean(pendingAction)}>
            <RefreshCw size={14} style={pendingAction === 'check' ? { animation: 'spin 1s linear infinite' } : undefined} />
            {pendingAction === 'check' ? '检查中…' : '检查更新'}
          </button>
          <button className="btn btn-secondary" onClick={onContinue} disabled={Boolean(pendingAction)}>
            <Sparkles size={14} />
            {pendingAction === 'continue' ? '更新中…' : ready ? '继续培养' : '继续更新'}
          </button>
        </div>

        <Section title="概览">
          <div className="detail-grid">
            <DetailStat label="素材" value={cleanDocumentCount.toLocaleString()} hint={`${persona.doc_count.toLocaleString()} 条总素材`} />
            <DetailStat label="来源" value={`${enabledSourceCount} / ${sourceCount}`} hint="已启用 / 全部来源" />
            <DetailStat label="后台更新" value={`${progress}%`} hint={`${persona.current_round ?? detail?.progress.current_round ?? persona.training_rounds} 轮进展`} />
            <DetailStat label="可对话状态" value={ready ? '已就绪' : '准备中'} hint={ready ? '可以进入聊天' : '完成后台更新后可聊天'} />
          </div>
        </Section>

        <Section title="来源摘要">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="surface-panel" style={{ padding: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--text-primary))' }}>{sourceTypeLabel(persona.source_type)}</div>
                  <div className="muted-copy" style={{ marginTop: 4 }}>
                    {sourceSummary?.latest_update_result || detail?.latest_activity || '来源会在后台持续整理，保持人格材料新鲜。'}
                  </div>
                </div>
                {sourceSummary?.recent_delta_count !== undefined ? (
                  <span className="status-pill">新增 {sourceSummary.recent_delta_count}</span>
                ) : null}
              </div>
            </div>
            {sourceSummary?.source_breakdown ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Object.entries(sourceSummary.source_breakdown).map(([key, count]) => (
                  <span key={key} className="status-pill">{sourceTypeLabel(key)} · {count}</span>
                ))}
              </div>
            ) : null}
          </div>
        </Section>

        <Section title="后台更新状态">
          <div className="surface-panel" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              {persona.status === 'error' ? <AlertCircle size={16} color="#ef4444" /> : ready ? <CheckCircle2 size={16} color="#22c55e" /> : <RefreshCw size={16} color="#0ea5e9" />}
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--text-primary))' }}>{phaseLabel}</div>
            </div>
            <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgb(var(--bg-hover))', border: '1px solid rgb(var(--border-light))' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: ready ? '#22c55e' : '#0ea5e9', transition: 'width 0.2s ease' }} />
            </div>
            <div className="muted-copy" style={{ marginTop: 9 }}>
              最近检查 {formatDate(sourceSummary?.last_update_check_at)} · 最近活动 {formatDate(detail?.last_heartbeat_at ?? sourceSummary?.last_heartbeat_at)}
            </div>
          </div>
        </Section>

        <Section title="关系概览">
          <div className="detail-grid">
            <DetailStat label="人物实体" value={(network?.entity_count ?? 0).toLocaleString()} />
            <DetailStat label="人物关系" value={relationCount.toLocaleString()} />
            <DetailStat label="背景片段" value={(network?.context_pack_count ?? 0).toLocaleString()} />
            <DetailStat label="高置信事实" value={(network?.high_confidence_claim_count ?? 0).toLocaleString()} />
          </div>
          {network?.dominant_domains?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {network.dominant_domains.map((domain) => <span key={domain} className="status-pill">{domain}</span>)}
            </div>
          ) : null}
        </Section>
      </div>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="section-heading" style={{ marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
