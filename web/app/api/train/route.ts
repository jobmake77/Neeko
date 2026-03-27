import { spawn } from 'child_process';
import { writeRuntimeProgress } from '@/lib/runtime-progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function stripAnsi(str: string) {
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const rounds = url.searchParams.get('rounds');
  const trainingProfile = url.searchParams.get('trainingProfile');
  const expectedRounds = rounds && /^\d+$/.test(rounds) ? Math.max(1, parseInt(rounds, 10)) : 10;
  const startTs = Date.now();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let currentRound = 0;
      let totalRounds = expectedRounds;
      let percent = 0;
      let stage = 'init';
      let stageLabel = '初始化任务';

      function send(data: string) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line: data })}\n\n`));
      }
      function sendEvent(event: string, data: object) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      function expectedRangeMinutes(): [number, number] {
        if (totalRounds <= 3) return [15, 30];
        if (totalRounds <= 10) return [30, 90];
        return [60, 180];
      }
      function emitProgress(next?: Partial<{ stage: string; stageLabel: string; percent: number; currentRound: number; totalRounds: number }>) {
        if (next?.stage) stage = next.stage;
        if (next?.stageLabel) stageLabel = next.stageLabel;
        if (typeof next?.percent === 'number') percent = Math.max(percent, Math.min(100, next.percent));
        if (typeof next?.currentRound === 'number') currentRound = next.currentRound;
        if (typeof next?.totalRounds === 'number') totalRounds = Math.max(1, next.totalRounds);
        const elapsedSec = Math.max(0, Math.floor((Date.now() - startTs) / 1000));
        const [minTotal, maxTotal] = expectedRangeMinutes();
        const elapsedMin = elapsedSec / 60;
        const etaMin = Math.max(0, Math.ceil(minTotal - elapsedMin));
        const etaMax = Math.max(0, Math.ceil(maxTotal - elapsedMin));
        const payload = {
          stage,
          stageLabel,
          percent,
          currentRound,
          totalRounds,
          elapsedSec,
          etaMin,
          etaMax,
        };
        sendEvent('progress', payload);
        if (slug) {
          writeRuntimeProgress(slug, payload);
        }
      }
      function parseProgressLine(line: string) {
        const roundMatch = line.match(/Round\s+(\d+)\/(\d+)/i);
        if (roundMatch) {
          const round = parseInt(roundMatch[1], 10);
          const maxRounds = parseInt(roundMatch[2], 10);
          emitProgress({
            stage: 'training',
            stageLabel: '培养循环',
            totalRounds: maxRounds,
            currentRound: round,
            percent: 10 + (round / Math.max(1, maxRounds)) * 85,
          });
          return;
        }
        if (line.includes('启动继续培养')) {
          emitProgress({ stage: 'init', stageLabel: '初始化任务', percent: 3 });
          return;
        }
        if (line.includes('继续培养') || line.includes('profile=')) {
          emitProgress({ stage: 'training', stageLabel: '培养循环', percent: 10 });
          return;
        }
        if (line.includes('培养完成') || line.startsWith('✓')) {
          emitProgress({ stage: 'finalize', stageLabel: '收尾与保存', percent: 98 });
        }
      }

      if (!slug) {
        send('❌ 参数错误：缺少 slug');
        sendEvent('done', { success: false });
        controller.close();
        return;
      }

      const repoRoot = `${process.cwd()}/..`;
      const args = ['dist/index.js', 'train', slug];

      if (rounds && /^\d+$/.test(rounds)) {
        args.push('--rounds', rounds);
      }
      if (trainingProfile && /^(baseline|a1|a2|a3|a4|full)$/i.test(trainingProfile)) {
        args.push('--training-profile', trainingProfile.toLowerCase());
      }

      send(`▶ 启动继续培养：${slug}`);
      emitProgress({ stage: 'init', stageLabel: '初始化任务', percent: 3 });

      const child = spawn(process.execPath, args, {
        cwd: repoRoot,
        env: { ...process.env },
      });

      child.stdout.on('data', (chunk: Buffer) => {
        const lines = stripAnsi(chunk.toString()).split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            send(trimmed);
            parseProgressLine(trimmed);
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const lines = stripAnsi(chunk.toString()).split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            send(trimmed);
            parseProgressLine(trimmed);
          }
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          emitProgress({ stage: 'done', stageLabel: '培养完成', percent: 100, currentRound: totalRounds });
          sendEvent('done', { success: true });
        } else {
          send(`❌ 进程退出（code ${code}）`);
          sendEvent('progress', {
            stage: 'error',
            stageLabel: '执行失败',
            percent,
            currentRound,
            totalRounds,
            elapsedSec: Math.max(0, Math.floor((Date.now() - startTs) / 1000)),
            etaMin: 0,
            etaMax: 0,
          });
          sendEvent('done', { success: false });
        }
        controller.close();
      });

      child.on('error', (err) => {
        send(`❌ 启动失败：${err.message}`);
        sendEvent('done', { success: false });
        controller.close();
      });

      req.signal.addEventListener('abort', () => {
        child.kill();
        controller.close();
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
