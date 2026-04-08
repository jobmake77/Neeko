import { FormEvent, KeyboardEvent, useState } from 'react';
import { ConversationBundle, PersonaSummary } from '../lib/types';
import { useI18n } from '../lib/i18n';

interface ChatWorkspaceProps {
  persona: PersonaSummary | null;
  bundle: ConversationBundle | null;
  loading: boolean;
  onSend: (message: string) => Promise<void>;
  onCopyMessage: (content: string) => Promise<void>;
}

export function ChatWorkspace({ persona, bundle, loading, onSend, onCopyMessage }: ChatWorkspaceProps) {
  const { locale } = useI18n();
  const isZh = locale === 'zh-CN';
  const [message, setMessage] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = message.trim();
    if (!next || loading) return;
    setMessage('');
    await onSend(next);
  };

  const handleKeyDown = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      const next = message.trim();
      if (!next || loading) return;
      setMessage('');
      await onSend(next);
    }
  };

  return (
    <section className="screen chat-screen">
      <header className="screen-header">
        <div>
          <p className="screen-eyebrow">{persona ? persona.name : isZh ? '未选择人格' : 'No persona selected'}</p>
          <h1>{bundle?.conversation.title ?? (isZh ? '开始一段新对话' : 'Start a new conversation')}</h1>
          <p className="screen-subtitle">
            {bundle ? new Date(bundle.conversation.updated_at).toLocaleString() : (isZh ? '选择左侧线程，或直接新建开始聊天。' : 'Select a thread on the left or create a new one to begin.')}
          </p>
        </div>
      </header>
      <div className="message-list">
        {bundle?.messages.length ? bundle.messages.map((item) => (
          <article key={item.id} className={item.role === 'assistant' ? 'message-card assistant' : 'message-card user'}>
            <div className="message-meta">
              <strong>{item.role === 'assistant' ? (isZh ? '人格' : 'Assistant') : (isZh ? '你' : 'You')}</strong>
              <span>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <p>{item.content}</p>
            <div className="message-tools">
              <button type="button" className="text-action" onClick={() => void onCopyMessage(item.content)}>
                {isZh ? '复制' : 'Copy'}
              </button>
            </div>
          </article>
        )) : <div className="empty-chat">{isZh ? '还没有消息。开始你们的第一句对话吧。' : 'No messages yet. Say the first thing.'}</div>}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => void handleKeyDown(event)}
          placeholder={persona ? (isZh ? '输入你想和这个人格说的话' : 'Type a message for this persona') : (isZh ? '先在左侧选择一个人格' : 'Select a persona first')}
          rows={4}
          disabled={!persona}
        />
        <div className="composer-footer">
          <small>{isZh ? 'Cmd/Ctrl + Enter 发送' : 'Cmd/Ctrl + Enter to send'}</small>
          <button type="submit" className="primary-button" disabled={loading || !message.trim() || !persona}>
            {loading ? (isZh ? '发送中…' : 'Sending...') : (isZh ? '发送' : 'Send')}
          </button>
        </div>
      </form>
    </section>
  );
}
