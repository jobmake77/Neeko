import { enqueueTrainJob, readLockHolder } from '@/lib/train-queue';
import { readRuntimeProgress, readRuntimeTaskState } from '@/lib/runtime-progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const roundsRaw = url.searchParams.get('rounds');
  const trainingProfileRaw = url.searchParams.get('trainingProfile');
  const trackRaw = url.searchParams.get('track');
  const modeRaw = url.searchParams.get('mode');
  const resumeRaw = url.searchParams.get('resumeFrom');
  const rounds = roundsRaw && /^\d+$/.test(roundsRaw) ? Math.max(1, parseInt(roundsRaw, 10)) : 10;
  const trainingProfile = trainingProfileRaw && /^(baseline|a1|a2|a3|a4|full)$/i.test(trainingProfileRaw)
    ? trainingProfileRaw.toLowerCase()
    : 'full';
  const track =
    trackRaw && /^(persona_extract|work_execute|full_serial)$/i.test(trackRaw)
      ? (trackRaw.toLowerCase() as 'persona_extract' | 'work_execute' | 'full_serial')
      : 'full_serial';
  const mode =
    modeRaw && /^(quick|full)$/i.test(modeRaw)
      ? (modeRaw.toLowerCase() as 'quick' | 'full')
      : rounds <= 3
      ? 'quick'
      : 'full';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let clientDisconnected = false;
      let pollTimer: NodeJS.Timeout | null = null;
      let lastProgressAt = '';
      let lastTaskAt = '';

      function send(line: string) {
        if (clientDisconnected) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line })}\n\n`));
        } catch {
          clientDisconnected = true;
        }
      }

      function sendEvent(event: string, data: object) {
        if (clientDisconnected) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          clientDisconnected = true;
        }
      }

      function closeIfNeeded() {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (!clientDisconnected) {
          controller.close();
        }
      }

      function pollStatus() {
        if (!slug) return;
        const progress = readRuntimeProgress(slug);
        const task = readRuntimeTaskState(slug);

        if (progress && progress.updatedAt !== lastProgressAt) {
          lastProgressAt = progress.updatedAt;
          sendEvent('progress', progress);
        }

        if (task && task.updatedAt !== lastTaskAt) {
          lastTaskAt = task.updatedAt;
          if (task.state === 'queued') {
            send('⏳ 任务排队中，等待前序训练完成');
          } else if (task.state === 'running') {
            send('▶ 训练执行中');
          } else if (task.state === 'done') {
            send('✓ 训练完成');
            sendEvent('done', { success: true });
            closeIfNeeded();
          } else if (task.state === 'failed') {
            send(`❌ 训练失败：${task.lastError ?? 'unknown error'}`);
            sendEvent('done', { success: false });
            closeIfNeeded();
          }
        }
      }

      if (!slug) {
        send('❌ 参数错误：缺少 slug');
        sendEvent('done', { success: false });
        closeIfNeeded();
        return;
      }

      const accepted = enqueueTrainJob({
        slug,
        rounds,
        profile: trainingProfile,
        retries: 3,
        source: 'api',
        track,
        mode,
        resumeFrom: resumeRaw ?? undefined,
      });

      if (!accepted.accepted && accepted.reason === 'already_queued_or_running') {
        send(`ℹ ${slug} 已在队列中或正在训练，已连接到当前任务状态`);
      } else if (!accepted.accepted) {
        const lockHolder = readLockHolder(slug);
        send(`❌ 无法入队：${accepted.reason ?? 'unknown'}${lockHolder ? ` (lock=${lockHolder})` : ''}`);
        sendEvent('done', { success: false });
        closeIfNeeded();
        return;
      } else {
        send(`▶ 已加入训练队列：${slug}`);
        if ((accepted.queuedAhead ?? 0) > 0) {
          send(`⏳ 前方任务：${accepted.queuedAhead}`);
        }
      }

      pollStatus();
      pollTimer = setInterval(pollStatus, 1000);

      req.signal.addEventListener('abort', () => {
        clientDisconnected = true;
        if (pollTimer) clearInterval(pollTimer);
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
