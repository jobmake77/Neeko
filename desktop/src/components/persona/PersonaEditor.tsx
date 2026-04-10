import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ChevronLeft, Upload, Link, Film, FileAudio } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { PersonaSummary } from '@/lib/types';
import * as api from '@/lib/api';
import { usePersonaStore } from '@/stores/persona';

type SourceType = 'social' | 'chat_file' | 'video_file';
type VideoSubMode = 'channel' | 'single' | 'local';
type TrainingMode = 'quick' | 'full';

interface Props {
  mode: 'create' | 'edit';
  persona?: PersonaSummary;
  open: boolean;
  onClose: () => void;
}

const SOURCE_OPTIONS: { type: SourceType; label: string; desc: string; icon: string }[] = [
  { type: 'social', label: 'Social', desc: 'X/Twitter 公开推文', icon: '𝕏' },
  { type: 'chat_file', label: 'Chat File', desc: '微信 / 飞书聊天记录', icon: '💬' },
  { type: 'video_file', label: 'Video File', desc: '视频 / 音频文件', icon: '🎬' },
];

const STEPS_CREATE = ['stepBasicInfo', 'stepDataSource', 'stepCultivation'];

export function PersonaEditor({ mode, persona, open, onClose }: Props) {
  const { reload } = usePersonaStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('social');
  const [handle, setHandle] = useState('');
  const [chatFile, setChatFile] = useState<string>('');
  const [videoSubMode, setVideoSubMode] = useState<VideoSubMode>('channel');
  const [channelUrl, setChannelUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoFile, setVideoFile] = useState<string>('');
  const [trainingMode, setTrainingMode] = useState<TrainingMode>('quick');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      if (mode === 'edit' && persona) {
        setName(persona.name);
        setSourceType((persona.source_type as SourceType) || 'social');
      } else {
        setName('');
        setSourceType('social');
        setHandle('');
        setChatFile('');
        setChannelUrl('');
        setVideoUrl('');
        setVideoFile('');
        setTrainingMode('quick');
      }
      setStep(0);
      setError('');
    }
  }, [open, mode, persona]);

  async function handleSave() {
    if (!name.trim()) { setError('请填写人格名称'); return; }
    setSaving(true);
    setError('');
    try {
      // Server reads `persona_slug` (not `slug`) when source_type is present
      const persona_slug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 32) || `persona-${Date.now()}`;

      if (mode === 'create') {
        // Build source_target from the appropriate sub-field
        let source_target: string | undefined;
        let source_path: string | undefined;
        if (sourceType === 'social') source_target = handle || undefined;
        else if (sourceType === 'video_file') {
          if (videoSubMode === 'channel') source_target = channelUrl || undefined;
          else if (videoSubMode === 'single') source_target = videoUrl || undefined;
          else source_path = videoFile || undefined;
        } else if (sourceType === 'chat_file') {
          source_path = chatFile || undefined;
        }

        await api.createPersona({
          name: name.trim(),
          persona_slug,
          source_type: sourceType,
          source_target,
          source_path,
        });

        // Use the slug we computed — more reliable than reading back from the response
        api.startTraining(persona_slug, trainingMode).catch(console.warn);

      } else if (persona) {
        await api.updatePersona(persona.slug, { name: name.trim(), source_type: sourceType as 'social' | 'chat_file' | 'video_file' });
      }
      await reload();
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const isCreate = mode === 'create';
  const canProceed = name.trim().length > 0;
  const totalSteps = isCreate ? 3 : 1;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgb(0 0 0 / 0.5)',
              backdropFilter: 'blur(4px)',
              zIndex: 200,
            }}
          />

          {/* 居中 wrapper */}
          <div style={{
            position: 'fixed', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 201, pointerEvents: 'none',
          }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', damping: 28, stiffness: 380, duration: 0.2 }}
            style={{
              pointerEvents: 'auto',
              width: 480,
              maxHeight: '82vh',
              background: 'rgb(var(--bg-card))',
              border: '1px solid rgb(var(--border))',
              borderRadius: 14,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 24px 48px rgb(0 0 0 / 0.25)',
              overflow: 'hidden',
            }}
          >
            {/* 头部 */}
            <div style={{
              padding: '18px 20px 14px',
              borderBottom: '1px solid rgb(var(--border-light))',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'rgb(var(--text-primary))' }}>
                  {isCreate ? t('newPersona') : t('editPersona')}
                </div>
                {isCreate && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    {STEPS_CREATE.map((labelKey, i) => (
                      <React.Fragment key={i}>
                        <div style={{
                          fontSize: 11, fontWeight: 500,
                          color: step === i ? 'rgb(var(--accent))' : 'rgb(var(--text-tertiary))',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                          <div style={{
                            width: 16, height: 16, borderRadius: '50%', fontSize: 9, fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: step === i ? 'rgb(var(--accent))' : step > i ? '#22c55e' : 'rgb(var(--border))',
                            color: step >= i ? '#fff' : 'rgb(var(--text-tertiary))',
                          }}>{i + 1}</div>
                          {t(labelKey)}
                        </div>
                        {i < totalSteps - 1 && <div style={{ width: 16, height: 1, background: 'rgb(var(--border))' }} />}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
              <button className="btn btn-icon" onClick={onClose} style={{ width: 30, height: 30, marginTop: -2 }}>
                <X size={15} />
              </button>
            </div>

            {/* 内容 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
              {/* 步骤 0：名称 */}
              {(step === 0 || !isCreate) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--text-secondary))', display: 'block', marginBottom: 6 }}>
                      {t('personaName')} *
                    </label>
                    <input
                      className="input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="给这个人格取个名字…"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter' && isCreate && canProceed) setStep(1); }}
                    />
                  </div>
                </div>
              )}

              {/* 步骤 1：数据来源 */}
              {(step === 1 || !isCreate) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: !isCreate ? 14 : 0 }}>
                  {!isCreate && (
                    <div style={{ height: 1, background: 'rgb(var(--border-light))', margin: '4px 0' }} />
                  )}

                  {/* 来源类型选择 */}
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--text-secondary))', display: 'block', marginBottom: 8 }}>
                      {t('personaSource')}
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {SOURCE_OPTIONS.map((opt) => (
                        <button
                          key={opt.type}
                          onClick={() => setSourceType(opt.type)}
                          style={{
                            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                            padding: '10px 8px', borderRadius: 8, border: '1px solid',
                            borderColor: sourceType === opt.type ? 'rgb(var(--accent))' : 'rgb(var(--border))',
                            background: sourceType === opt.type ? 'rgb(var(--accent) / 0.06)' : 'transparent',
                            cursor: 'pointer', transition: 'all 0.15s', gap: 4,
                          }}
                        >
                          <span style={{ fontSize: 18, lineHeight: 1 }}>{opt.icon}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: sourceType === opt.type ? 'rgb(var(--accent))' : 'rgb(var(--text-primary))' }}>
                            {opt.label}
                          </span>
                          <span style={{ fontSize: 10, color: 'rgb(var(--text-tertiary))', textAlign: 'center', lineHeight: 1.3 }}>
                            {opt.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Social */}
                  {sourceType === 'social' && (
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--text-secondary))', display: 'block', marginBottom: 6 }}>
                        {t('personaHandle')}
                      </label>
                      <input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@username" />
                    </div>
                  )}

                  {/* Chat File */}
                  {sourceType === 'chat_file' && (
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--text-secondary))', display: 'block', marginBottom: 6 }}>
                        {t('uploadFile')}
                      </label>
                      <div
                        onClick={() => chatFileInputRef.current?.click()}
                        style={{
                          border: '2px dashed rgb(var(--border))', borderRadius: 8, padding: '20px 16px',
                          textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgb(var(--accent))')}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgb(var(--border))')}
                      >
                        <Upload size={20} style={{ color: 'rgb(var(--text-tertiary))', margin: '0 auto 8px' }} />
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'rgb(var(--text-primary))' }}>
                          {chatFile ? chatFile.split(/[\\/]/).pop() : t('chatFileHint')}
                        </div>
                        <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginTop: 4 }}>
                          {t('chatFileFormats')}
                        </div>
                      </div>
                      <input
                        ref={chatFileInputRef} type="file" hidden
                        accept=".txt,.json,.csv,.html,.zip"
                        onChange={(e) => { if (e.target.files?.[0]) setChatFile(e.target.files[0].name); }}
                      />
                    </div>
                  )}

                  {/* Video File */}
                  {sourceType === 'video_file' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* 子模式选择 */}
                      <div style={{ display: 'flex', gap: 6 }}>
                        {([
                          { mode: 'channel' as VideoSubMode, icon: <Link size={12} />, label: t('channelUrl') },
                          { mode: 'single' as VideoSubMode, icon: <Film size={12} />, label: t('singleVideoUrl') },
                          { mode: 'local' as VideoSubMode, icon: <FileAudio size={12} />, label: t('localFile') },
                        ] as const).map((opt) => (
                          <button
                            key={opt.mode}
                            onClick={() => setVideoSubMode(opt.mode)}
                            className={`btn ${videoSubMode === opt.mode ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ flex: 1, fontSize: 11, padding: '5px 8px', gap: 4 }}
                          >
                            {opt.icon}{opt.label}
                          </button>
                        ))}
                      </div>

                      {videoSubMode === 'channel' && (
                        <div>
                          <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginBottom: 6 }}>{t('channelUrlHint')}</div>
                          <input className="input" value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)} placeholder="https://youtube.com/@creator" />
                        </div>
                      )}
                      {videoSubMode === 'single' && (
                        <div>
                          <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginBottom: 6 }}>{t('singleVideoUrlHint')}</div>
                          <input className="input" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." />
                        </div>
                      )}
                      {videoSubMode === 'local' && (
                        <div>
                          <div
                            onClick={() => videoFileInputRef.current?.click()}
                            style={{
                              border: '2px dashed rgb(var(--border))', borderRadius: 8, padding: '16px',
                              textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.15s',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgb(var(--accent))')}
                            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgb(var(--border))')}
                          >
                            <FileAudio size={18} style={{ color: 'rgb(var(--text-tertiary))', margin: '0 auto 6px' }} />
                            <div style={{ fontSize: 12, color: 'rgb(var(--text-primary))' }}>
                              {videoFile ? videoFile.split(/[\\/]/).pop() : t('localFileHint')}
                            </div>
                            <div style={{ fontSize: 10, color: 'rgb(var(--text-tertiary))', marginTop: 3 }}>
                              .mp4  .mp3  .wav  .m4a  .webm
                            </div>
                          </div>
                          <input
                            ref={videoFileInputRef} type="file" hidden
                            accept=".mp4,.mp3,.wav,.m4a,.webm,.ogg,.flac"
                            onChange={(e) => { if (e.target.files?.[0]) setVideoFile(e.target.files[0].name); }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 步骤 2：培养细节 */}
              {isCreate && step === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 13, color: 'rgb(var(--text-secondary))', lineHeight: 1.6 }}>
                    选择培养深度，这将决定人格学习的轮数和精细程度。
                  </div>
                  {([
                    {
                      mode: 'quick' as TrainingMode,
                      icon: '⚡',
                      label: t('quickMode'),
                      desc: t('quickModeDesc'),
                      detail: '约 3 轮问答，适合快速预览',
                    },
                    {
                      mode: 'full' as TrainingMode,
                      icon: '🌊',
                      label: t('fullMode'),
                      desc: t('fullModeDesc'),
                      detail: '约 10 轮问答，人格更丰富精准',
                    },
                  ]).map((opt) => (
                    <button
                      key={opt.mode}
                      onClick={() => setTrainingMode(opt.mode)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 14,
                        padding: '14px 16px', borderRadius: 10, border: '1.5px solid',
                        borderColor: trainingMode === opt.mode ? 'rgb(var(--accent))' : 'rgb(var(--border))',
                        background: trainingMode === opt.mode ? 'rgb(var(--accent) / 0.06)' : 'transparent',
                        cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left', width: '100%',
                      }}
                    >
                      <span style={{ fontSize: 24, lineHeight: 1, marginTop: 2 }}>{opt.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: trainingMode === opt.mode ? 'rgb(var(--accent))' : 'rgb(var(--text-primary))' }}>
                            {opt.label}
                          </span>
                          {opt.mode === 'full' && (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'rgb(var(--accent) / 0.12)', color: 'rgb(var(--accent))' }}>
                              推荐
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>{opt.desc}</div>
                        <div style={{ fontSize: 11, color: 'rgb(var(--text-tertiary))', marginTop: 2 }}>{opt.detail}</div>
                      </div>
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                        border: `2px solid ${trainingMode === opt.mode ? 'rgb(var(--accent))' : 'rgb(var(--border))'}`,
                        background: trainingMode === opt.mode ? 'rgb(var(--accent))' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {trainingMode === opt.mode && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {error && (
                <div style={{ fontSize: 12, color: '#ef4444', padding: '8px 12px', background: 'rgb(239 68 68 / 0.08)', borderRadius: 6, marginTop: 12 }}>
                  {error}
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            <div style={{
              padding: '14px 20px', borderTop: '1px solid rgb(var(--border-light))',
              display: 'flex', gap: 8, justifyContent: 'flex-end',
            }}>
              {isCreate && step > 0 && (
                <button className="btn btn-ghost" onClick={() => setStep((s) => s - 1)} style={{ marginRight: 'auto', gap: 4 }}>
                  <ChevronLeft size={13} />{t('back')}
                </button>
              )}
              <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
              {isCreate && step < 2 ? (
                <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !canProceed} style={{ gap: 4 }}>
                  下一步 <ChevronRight size={13} />
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? t('loading') : isCreate ? t('createAndCultivate') : t('save')}
                </button>
              )}
            </div>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
