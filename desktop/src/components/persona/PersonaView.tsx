import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { usePersonaStore } from '@/stores/persona';
import { useCultivationStore } from '@/stores/cultivation';
import { t } from '@/lib/i18n';
import type { PersonaSummary } from '@/lib/types';
import { PersonaCard } from './PersonaCard';
import { PersonaEditor } from './PersonaEditor';
import { CultivationCenter } from './CultivationCenter';

function isReadyPersona(status?: string, isReady?: boolean): boolean {
  if (isReady) return true;
  return ['ready', 'available', 'converged', 'exported'].includes(String(status ?? '').toLowerCase());
}

type Tab = 'personas' | 'cultivation';

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: () => string }[] = [
    { id: 'personas', label: () => t('myPersonas') },
    { id: 'cultivation', label: () => t('cultivationCenter') },
  ];
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgb(var(--border-light))', marginBottom: 24 }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            padding: '12px 18px', fontSize: 13.5, fontWeight: 600, background: 'none', border: 'none',
            borderBottom: active === tab.id ? '2px solid rgb(var(--accent))' : '2px solid transparent',
            color: active === tab.id ? 'rgb(var(--accent))' : 'rgb(var(--text-secondary))',
            cursor: 'pointer', transition: 'all 0.15s', marginBottom: -1,
          }}
        >
          {tab.label()}
        </button>
      ))}
    </div>
  );
}

export function PersonaView() {
  const { personas, loading, load, remove } = usePersonaStore();
  const readyPersonas = personas.filter((item) => isReadyPersona(item.status, item.is_ready));
  const [activeTab, setActiveTab] = useState<Tab>('personas');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editTarget, setEditTarget] = useState<PersonaSummary | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<PersonaSummary | null>(null);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => { load(); }, []);

  function handleEdit(p: PersonaSummary) {
    setEditorMode('edit');
    setEditTarget(p);
    setEditorOpen(true);
  }

  function handleCreate() {
    setEditorMode('create');
    setEditTarget(undefined);
    setEditorOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteError('');
    console.log('[PersonaView] Deleting persona:', deleteTarget.slug);
    try {
      await remove(deleteTarget.slug);
      useCultivationStore.getState().remove(deleteTarget.slug);
      console.log('[PersonaView] Delete succeeded');
      setDeleteTarget(null);
    } catch (e: unknown) {
      console.error('[PersonaView] Delete failed:', e);
      setDeleteError((e as Error).message || '删除失败');
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部区域（标题 + 操作） */}
      <div style={{ padding: '28px 28px 0', flexShrink: 0 }}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'rgb(var(--text-primary))', margin: 0 }}>
              {t('personas')}
            </h1>
            {activeTab === 'personas' && (
              <button className="btn btn-primary" onClick={handleCreate} style={{ gap: 6, minHeight: 40, padding: '0 16px' }}>
                <Plus size={14} />
                {t('newPersona')}
              </button>
            )}
          </div>
          <TabBar active={activeTab} onChange={setActiveTab} />
        </div>
      </div>

      {/* 内容区域 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'cultivation' ? (
          <CultivationCenter onDelete={(p) => setDeleteTarget(p)} />
        ) : (
          <div style={{ padding: '0 28px 28px' }}>
            <div style={{ maxWidth: 1180, margin: '0 auto' }}>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'rgb(var(--text-tertiary))' }}>
                {t('loading')}
              </div>
            ) : readyPersonas.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
                <div style={{ fontSize: 40, opacity: 0.3 }}>🧑</div>
                <div style={{ fontSize: 15, color: 'rgb(var(--text-secondary))' }}>还没有可聊天的人格</div>
                <div style={{ fontSize: 13, color: 'rgb(var(--text-tertiary))', textAlign: 'center', maxWidth: 300 }}>
                  已创建但仍在培养中的人格会留在培养中心，培养完成后才会出现在这里。
                </div>
                <button className="btn btn-primary" onClick={handleCreate} style={{ marginTop: 4 }}>
                  {t('newPersona')}
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(272px, 1fr))', gap: 18, alignItems: 'start' }}>
                {readyPersonas.map((p) => (
                  <PersonaCard key={p.slug} persona={p} onEdit={() => handleEdit(p)} onDelete={() => setDeleteTarget(p)} />
                ))}
              </div>
            )}
            </div>
          </div>
        )}
      </div>

      {/* 编辑器 */}
      <PersonaEditor mode={editorMode} persona={editTarget} open={editorOpen} onClose={() => setEditorOpen(false)} />

      {/* 删除确认 */}
      {deleteTarget && (
        <>
          <div onClick={() => { setDeleteTarget(null); setDeleteError(''); }}
            style={{ position: 'fixed', inset: 0, background: 'rgb(0 0 0 / 0.4)', zIndex: 300 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'rgb(var(--bg-card))', border: '1px solid rgb(var(--border))',
            borderRadius: 12, padding: 24, width: 380, zIndex: 301,
            boxShadow: '0 20px 40px rgb(0 0 0 / 0.2)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'rgb(var(--text-primary))', marginBottom: 8 }}>{t('confirmDelete')}</div>
            <div style={{ fontSize: 13, color: 'rgb(var(--text-secondary))', lineHeight: 1.6, marginBottom: 20 }}>{t('confirmDeletePersonaMsg')}</div>
            {deleteError && (
              <div style={{ fontSize: 12, color: '#ef4444', padding: '6px 10px', background: 'rgb(239 68 68 / 0.08)', borderRadius: 6, marginBottom: 12 }}>
                {deleteError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => { setDeleteTarget(null); setDeleteError(''); }}>{t('cancel')}</button>
              <button className="btn btn-primary" onClick={confirmDelete} style={{ background: '#ef4444' }}>{t('delete')}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
