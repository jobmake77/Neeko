import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Trash2, X, FolderOpen, RefreshCw } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { DiscoveredSourceCandidate, PersonaConfig, PersonaDetail, PersonaSource, PersonaSummary } from '@/lib/types';
import * as api from '@/lib/api';
import { usePersonaStore } from '@/stores/persona';
import { pickFiles } from '@/lib/tauri';
import { PersonaGenesisAscii } from './PersonaGenesisAscii';

type Props = {
  mode: 'create' | 'edit';
  persona?: PersonaSummary;
  open: boolean;
  onClose: () => void;
};

const DEFAULT_POLICY: PersonaConfig['update_policy'] = {
  auto_check_remote: true,
  check_interval_minutes: 60,
  training_threshold: 500,
  strategy: 'incremental',
};

function slugifyPersonaName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'persona';
}

function makeSource(type: PersonaSource['type'] = 'social'): PersonaSource {
  return {
    id: crypto.randomUUID(),
    type,
    mode: type === 'social' ? 'handle' : type === 'article' ? 'remote_url' : 'local_file',
    enabled: true,
    status: 'idle',
    platform: type === 'social' ? 'twitter' : type === 'chat_file' ? 'wechat' : type === 'article' ? 'web' : 'local',
    sync_strategy: type === 'social' ? 'deep_window' : 'incremental',
    horizon_mode: 'deep_archive',
    horizon_years: type === 'social' ? 8 : undefined,
    batch_limit: type === 'social' ? 100 : undefined,
  };
}

function SourceEditor({
  source,
  onChange,
  onRemove,
}: {
  source: PersonaSource;
  onChange: (next: PersonaSource) => void;
  onRemove: () => void;
}) {
  async function pickLocalPath(field: 'local_path' | 'manifest_path') {
    const paths = await pickFiles({ multiple: false });
    if (paths[0]) onChange({ ...source, [field]: paths[0] });
  }

  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            className="input"
            value={source.type}
            onChange={(e) => {
              const type = e.target.value as PersonaSource['type'];
              onChange({ ...makeSource(type), id: source.id, enabled: source.enabled });
            }}
            style={{ width: 140 }}
          >
            <option value="social">公开账号</option>
            <option value="chat_file">聊天文件</option>
            <option value="video_file">视频资料</option>
            <option value="article">网页文章</option>
          </select>
          <select
            className="input"
            value={source.mode}
            onChange={(e) => onChange({ ...source, mode: e.target.value as PersonaSource['mode'] })}
            style={{ width: 140 }}
          >
            {source.type === 'social' ? <option value="handle">账号</option> : null}
            {source.type === 'video_file' ? <option value="channel_url">频道链接</option> : null}
            {source.type === 'video_file' ? <option value="single_url">视频链接</option> : null}
            {source.type !== 'social' && source.type !== 'article' ? <option value="local_file">本地文件</option> : null}
            {source.type !== 'social' ? <option value="remote_url">远程链接</option> : null}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'rgb(var(--text-secondary))', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={source.enabled}
              onChange={(e) => onChange({ ...source, enabled: e.target.checked })}
            />
            启用
          </label>
          <button className="btn btn-icon" onClick={onRemove} title="删除来源" style={{ color: '#ef4444' }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {source.type === 'social' ? (
          <>
            <input
              className="input"
              value={source.handle_or_url ?? ''}
              onChange={(e) => onChange({ ...source, handle_or_url: e.target.value })}
              placeholder="@karpathy"
            />
            <input
              className="input"
              value={source.platform ?? ''}
              onChange={(e) => onChange({ ...source, platform: e.target.value })}
              placeholder="twitter / x"
            />
            <select
              className="input"
              value={source.horizon_mode ?? 'recent_3y'}
              onChange={(e) => onChange({
                ...source,
                horizon_mode: e.target.value as PersonaSource['horizon_mode'],
                horizon_years: e.target.value === 'deep_archive' ? 8 : 3,
              })}
            >
              <option value="recent_3y">近 3 年尽量全量</option>
              <option value="deep_archive">更深档案 5-10 年</option>
            </select>
          </>
        ) : (
          <>
            {source.mode === 'local_file' ? (
              <div style={{ display: 'flex', gap: 8, gridColumn: '1 / -1', flexWrap: 'wrap' }}>
                <input
                  className="input"
                  value={source.local_path ?? ''}
                  onChange={(e) => onChange({ ...source, local_path: e.target.value })}
                  placeholder="选择真实本地路径"
                  style={{ minWidth: 0, flex: '1 1 280px' }}
                />
                <button className="btn btn-secondary" onClick={() => void pickLocalPath('local_path')}>
                  <FolderOpen size={14} /> 选择
                </button>
              </div>
            ) : (
              <input
                className="input"
                value={source.handle_or_url ?? ''}
                onChange={(e) => onChange({ ...source, handle_or_url: e.target.value })}
                placeholder={source.mode === 'channel_url' ? '频道链接' : source.mode === 'single_url' ? '视频链接' : '远程链接'}
                style={{ gridColumn: '1 / -1' }}
              />
            )}
            <input
              className="input"
              value={source.platform ?? ''}
              onChange={(e) => onChange({ ...source, platform: e.target.value })}
              placeholder={source.type === 'chat_file' ? 'wechat / feishu' : source.type === 'article' ? 'web / blog / podcast' : 'youtube / bilibili / local'}
            />
            {source.type !== 'article' ? (
              <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                value={source.manifest_path ?? ''}
                onChange={(e) => onChange({ ...source, manifest_path: e.target.value })}
                placeholder="target manifest 路径"
                style={{ minWidth: 0, flex: '1 1 220px' }}
              />
              <button className="btn btn-secondary" onClick={() => void pickLocalPath('manifest_path')}>
                <FolderOpen size={14} />
              </button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>网页来源会作为补充材料进入统一素材池，不需要 target manifest。</div>
            )}
          </>
        )}
      </div>

      {source.summary ? (
        <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>{source.summary}</div>
      ) : null}
    </div>
  );
}

export function PersonaEditor({ mode, persona, open, onClose }: Props) {
  const { reload } = usePersonaStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [sources, setSources] = useState<PersonaSource[]>([makeSource('social')]);
  const [policy, setPolicy] = useState<PersonaConfig['update_policy']>(DEFAULT_POLICY);
  const [discovered, setDiscovered] = useState<DiscoveredSourceCandidate[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const hasTwitterSource = sources.some((source) => source.type === 'social');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (mode === 'create' || !persona) {
      setName('');
      setSources([makeSource('social')]);
      setPolicy(DEFAULT_POLICY);
      setDiscovered([]);
      return;
    }
    setLoading(true);
    api.getPersona(persona.slug)
      .then((detail: PersonaDetail) => {
        setName(detail.config.name ?? detail.persona.name);
        setSources(detail.config.sources.length > 0 ? detail.config.sources : [makeSource('social')]);
        setPolicy(detail.config.update_policy ?? DEFAULT_POLICY);
        return api.getDiscoveredSources(persona.slug).then(setDiscovered).catch(() => setDiscovered([]));
      })
      .catch((nextError) => setError((nextError as Error).message))
      .finally(() => setLoading(false));
  }, [open, mode, persona]);

  const canSave = useMemo(() => {
    if (!name.trim()) return false;
    return sources.some((source) => {
      if (!source.enabled) return false;
      if (source.type === 'social') return Boolean(source.handle_or_url?.trim());
      if (source.mode === 'local_file') return Boolean(source.local_path?.trim()) && Boolean(source.manifest_path?.trim());
      return Boolean(source.handle_or_url?.trim());
    });
  }, [name, sources]);

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError('');
    try {
      if (mode === 'create') {
        await api.createPersona({
          name: name.trim(),
          persona_slug: slugifyPersonaName(name),
          sources,
          update_policy: policy,
        });
        await new Promise((resolve) => window.setTimeout(resolve, 2200));
      } else if (persona) {
        await api.updatePersonaSources(persona.slug, { name: name.trim(), sources, update_policy: policy });
      }
      await reload();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscover() {
    if (!persona || discovering) return;
    setDiscovering(true);
    setError('');
    try {
      const next = await api.discoverSources(persona.slug);
      setDiscovered(next);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setDiscovering(false);
    }
  }

  async function handleAcceptCandidate(candidateId: string) {
    if (!persona) return;
    try {
      await api.acceptDiscoveredSource(persona.slug, candidateId);
      const [detail, candidates] = await Promise.all([
        api.getPersona(persona.slug),
        api.getDiscoveredSources(persona.slug),
      ]);
      setSources(detail.config.sources.length > 0 ? detail.config.sources : [makeSource('social')]);
      setDiscovered(candidates);
      await reload();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  async function handleRejectCandidate(candidateId: string) {
    if (!persona) return;
    try {
      await api.rejectDiscoveredSource(persona.slug, candidateId);
      setDiscovered((prev) => prev.map((item) => item.id === candidateId ? { ...item, status: 'rejected' } : item));
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgb(0 0 0 / 0.46)', zIndex: 200 }}
          />
          <div
            style={{
              position: 'fixed',
              zIndex: 201,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              inset: 0,
              padding: 24,
              pointerEvents: 'none',
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              style={{
                width: 860,
                maxWidth: 'min(860px, calc(100vw - 48px))',
                maxHeight: 'min(880px, calc(100vh - 48px))',
                overflow: 'hidden',
                background: 'rgb(var(--bg-card))',
                border: '1px solid rgb(var(--border))',
                borderRadius: 14,
                boxShadow: '0 24px 60px rgb(0 0 0 / 0.24)',
                display: 'flex',
                flexDirection: 'column',
                pointerEvents: 'auto',
              }}
            >
              {saving && mode === 'create' ? (
                <div style={{ padding: 20 }}>
                  <PersonaGenesisAscii
                    name={name}
                    subtitle="正在整理素材池、抽取人格结构并创建可持续培养的初始人格。"
                  />
                </div>
              ) : (
                <>
                  <div style={{ padding: '18px 20px', borderBottom: '1px solid rgb(var(--border-light))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{mode === 'create' ? '新建人格' : '编辑人格'}</div>
                      <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>统一素材池；保存后后台继续同步与培养。</div>
                    </div>
                    <button className="btn btn-icon" onClick={onClose}><X size={16} /></button>
                  </div>

                  <div style={{ padding: 20, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('personaName')} />

                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, paddingTop: 6 }}>素材池</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary" onClick={() => setSources((prev) => [...prev, makeSource('social')])}><Plus size={14} />账号</button>
                        <button className="btn btn-secondary" onClick={() => setSources((prev) => [...prev, makeSource('chat_file')])}><Plus size={14} />聊天</button>
                        <button className="btn btn-secondary" onClick={() => setSources((prev) => [...prev, makeSource('video_file')])}><Plus size={14} />视频</button>
                        <button className="btn btn-secondary" onClick={() => setSources((prev) => [...prev, makeSource('article')])}><Plus size={14} />网页</button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {sources.map((source, index) => (
                        <SourceEditor
                          key={source.id}
                          source={source}
                          onChange={(next) => setSources((prev) => prev.map((item, i) => i === index ? next : item))}
                          onRemove={() => setSources((prev) => prev.filter((item) => item.id !== source.id))}
                        />
                      ))}
                    </div>

                    <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 220, flex: '1 1 320px' }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>自动检查更新</div>
                        <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>远程来源按固定周期检查新增内容，发现增量后继续培养。</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" checked={policy.auto_check_remote} onChange={(e) => setPolicy({ ...policy, auto_check_remote: e.target.checked })} /> 自动
                        </label>
                        <input
                          className="input"
                          type="number"
                          min={5}
                          value={policy.check_interval_minutes}
                          onChange={(e) => setPolicy({ ...policy, check_interval_minutes: Number(e.target.value || 60) })}
                          style={{ width: 96 }}
                        />
                      </div>
                    </div>

                    {hasTwitterSource ? (
                      <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 220, flex: '1 1 320px' }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Twitter 自动训练门槛</div>
                          <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>达到这个素材量后，系统才会自动进入训练。未达到时会继续深抓；达到后若测评未通过，仍会继续补料。</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            className="input"
                            type="number"
                            min={1}
                            max={20000}
                            value={policy.training_threshold ?? 500}
                            onChange={(e) => setPolicy({ ...policy, training_threshold: Math.max(1, Number(e.target.value || 500)) })}
                            style={{ width: 120 }}
                          />
                          <span style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>条</span>
                        </div>
                      </div>
                    ) : null}

                    {mode === 'edit' && persona ? (
                      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{ minWidth: 220, flex: '1 1 320px' }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>自动发现候选来源</div>
                            <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>搜索官网、YouTube 和公开播客访谈页；确认后再进入素材池。</div>
                          </div>
                          <button className="btn btn-secondary" onClick={() => void handleDiscover()} disabled={discovering}>
                            <RefreshCw size={14} /> {discovering ? '搜索中…' : '发现来源'}
                          </button>
                        </div>

                        {discovered.length === 0 ? (
                          <div style={{ fontSize: 12, color: 'rgb(var(--text-tertiary))' }}>还没有候选来源。可先保存账号信息，再执行自动发现。</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {discovered.map((item) => (
                              <div key={item.id} style={{ border: '1px solid rgb(var(--border-light))', borderRadius: 10, padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</div>
                                  <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))', marginTop: 4 }}>{item.summary}</div>
                                  <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginTop: 4, wordBreak: 'break-all' }}>{item.url_or_handle}</div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flex: '0 0 auto' }}>
                                  <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))' }}>{Math.round(item.confidence * 100)}%</div>
                                  {item.status === 'pending' ? (
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                      <button className="btn btn-secondary" onClick={() => void handleRejectCandidate(item.id)}>忽略</button>
                                      <button className="btn btn-primary" onClick={() => void handleAcceptCandidate(item.id)}>加入素材池</button>
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 12, color: item.status === 'accepted' ? '#16a34a' : 'rgb(var(--text-tertiary))' }}>
                                      {item.status === 'accepted' ? '已加入素材池' : '已忽略'}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {loading ? <div style={{ fontSize: 13, color: 'rgb(var(--text-tertiary))' }}><RefreshCw size={14} style={{ verticalAlign: 'middle' }} /> 加载中…</div> : null}
                    {error ? <div style={{ fontSize: 12, color: '#ef4444', background: 'rgb(239 68 68 / 0.08)', borderRadius: 8, padding: '10px 12px' }}>{error}</div> : null}
                  </div>

                  <div style={{ padding: '16px 20px', borderTop: '1px solid rgb(var(--border-light))', display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary" onClick={onClose}>取消</button>
                    <button className="btn btn-primary" onClick={() => void handleSave()} disabled={!canSave || saving}>{saving ? '保存中…' : mode === 'create' ? '创建人格' : '保存修改'}</button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
