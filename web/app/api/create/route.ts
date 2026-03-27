import { spawn } from 'child_process';
import {
  estimateEtaRangeMinutes,
  patchRuntimeTaskState,
  recordEtaSample,
  writeRuntimeProgress,
} from '@/lib/runtime-progress';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 去掉 ANSI 转义色彩码
function stripAnsi(str: string) {
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');      // 'single' | 'fusion'
  const handle = url.searchParams.get('handle');  // e.g. elonmusk
  const skill = url.searchParams.get('skill');    // e.g. 全栈工程师
  const rounds = url.searchParams.get('rounds');  // e.g. 10
  const trainingProfile = url.searchParams.get('trainingProfile'); // e.g. full
  const expectedRounds = rounds && /^\d+$/.test(rounds) ? Math.max(1, parseInt(rounds, 10)) : 10;
  const startTs = Date.now();
  const candidatePrefix = normalizeSlugCandidate(mode === 'single' ? handle : skill);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let clientDisconnected = false;
      let activeSlug: string | null = null;
      let childPid: number | null = null;
      let currentRound = 0;
      let totalRounds = expectedRounds;
      let percent = 0;
      let stage = 'init';
      let stageLabel = '初始化任务';

      function send(data: string) {
        if (clientDisconnected) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line: data })}\n\n`));
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
      function emitProgress(next?: Partial<{ stage: string; stageLabel: string; percent: number; currentRound: number; totalRounds: number }>) {
        if (next?.stage) stage = next.stage;
        if (next?.stageLabel) stageLabel = next.stageLabel;
        if (typeof next?.percent === 'number') percent = Math.max(percent, Math.min(100, next.percent));
        if (typeof next?.currentRound === 'number') currentRound = next.currentRound;
        if (typeof next?.totalRounds === 'number') totalRounds = Math.max(1, next.totalRounds);
        const elapsedSec = Math.max(0, Math.floor((Date.now() - startTs) / 1000));
        const { etaMin, etaMax } = estimateEtaRangeMinutes('create', totalRounds, elapsedSec);
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
        if (!activeSlug) {
          activeSlug = resolveRecentSlug(candidatePrefix, startTs);
        }
        if (activeSlug) {
          writeRuntimeProgress(activeSlug, payload);
          patchRuntimeTaskState(activeSlug, {
            state: 'running',
            pid: childPid,
            startedAt: new Date(startTs).toISOString(),
            taskType: 'create',
            rounds: totalRounds,
            profile: trainingProfile?.toLowerCase() ?? 'full',
          });
        }
      }
      function parseProgressLine(line: string) {
        const slugMatch = line.match(/Slug:\s*([a-z0-9][a-z0-9-_]*)/i);
        if (slugMatch) {
          activeSlug = slugMatch[1];
          emitProgress();
          return;
        }
        const roundMatch = line.match(/Round\s+(\d+)\/(\d+)/i);
        if (roundMatch) {
          const round = parseInt(roundMatch[1], 10);
          const maxRounds = parseInt(roundMatch[2], 10);
          emitProgress({
            stage: 'training',
            stageLabel: '培养循环',
            totalRounds: maxRounds,
            currentRound: round,
            percent: 60 + (round / Math.max(1, maxRounds)) * 35,
          });
          return;
        }
        if (line.includes('启动构建')) {
          emitProgress({ stage: 'init', stageLabel: '初始化任务', percent: 2 });
          return;
        }
        if (line.includes('抓取') || line.includes('获取内容')) {
          emitProgress({ stage: 'ingestion', stageLabel: '采集数据源', percent: 15 });
          return;
        }
        if (line.includes('Cleaning and chunking') || line.includes('semantic chunks ready')) {
          emitProgress({ stage: 'preprocess', stageLabel: '清洗与切片', percent: 38 });
          return;
        }
        if (line.includes('Extracting soul') || line.includes('Soul v')) {
          emitProgress({ stage: 'soul', stageLabel: '提炼 Soul', percent: 52 });
          return;
        }
        if (line.includes('Running cultivation loop')) {
          emitProgress({ stage: 'training', stageLabel: '培养循环', percent: 60 });
          return;
        }
        if (line.includes('Training complete') || line.includes('created!') || line.startsWith('✓')) {
          emitProgress({ stage: 'finalize', stageLabel: '收尾与保存', percent: 98 });
        }
      }

      // Build CLI args
      const repoRoot = `${process.cwd()}/..`;
      const args = ['dist/index.js', 'create'];

      if (mode === 'single' && handle) {
        args.push(`@${handle}`, '--yes');
      } else if (mode === 'fusion' && skill) {
        args.push('--skill', skill, '--yes');
      } else {
        send('❌ 参数错误：请提供 handle 或 skill');
        sendEvent('done', { success: false });
        controller.close();
        return;
      }

      if (rounds && /^\d+$/.test(rounds)) {
        args.push('--rounds', rounds);
      }
      if (trainingProfile && /^(baseline|a1|a2|a3|a4|full)$/i.test(trainingProfile)) {
        args.push('--training-profile', trainingProfile.toLowerCase());
      }

      send(`▶ 启动构建：${mode === 'single' ? `@${handle}` : skill}`);
      emitProgress({ stage: 'init', stageLabel: '初始化任务', percent: 3 });

      const child = spawn(process.execPath, args, {
        cwd: repoRoot,
        env: { ...process.env },
        // 让子进程跑非交互式（跳过 confirm prompts）
        // 使用 stdio pipe 捕获输出
      });
      childPid = child.pid ?? null;

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
          if (activeSlug) {
            patchRuntimeTaskState(activeSlug, {
              state: 'done',
              pid: childPid,
              startedAt: new Date(startTs).toISOString(),
              finishedAt: new Date().toISOString(),
              taskType: 'create',
              rounds: totalRounds,
              profile: trainingProfile?.toLowerCase() ?? 'full',
            });
            recordEtaSample('create', totalRounds, Math.max(1, Math.floor((Date.now() - startTs) / 1000)));
          }
          sendEvent('done', { success: true });
        } else {
          send(`❌ 进程退出（code ${code}）`);
          if (activeSlug) {
            patchRuntimeTaskState(activeSlug, {
              state: 'failed',
              pid: childPid,
              startedAt: new Date(startTs).toISOString(),
              finishedAt: new Date().toISOString(),
              lastError: `exit code ${code}`,
              taskType: 'create',
              rounds: totalRounds,
              profile: trainingProfile?.toLowerCase() ?? 'full',
            });
          }
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
        if (!clientDisconnected) {
          controller.close();
        }
      });

      child.on('error', (err) => {
        send(`❌ 启动失败：${err.message}`);
        if (activeSlug) {
          patchRuntimeTaskState(activeSlug, {
            state: 'failed',
            pid: childPid,
            startedAt: new Date(startTs).toISOString(),
            finishedAt: new Date().toISOString(),
            lastError: err.message,
            taskType: 'create',
            rounds: totalRounds,
            profile: trainingProfile?.toLowerCase() ?? 'full',
          });
        }
        sendEvent('done', { success: false });
        controller.close();
      });

      // 如果客户端断连，kill 子进程
      req.signal.addEventListener('abort', () => {
        clientDisconnected = true;
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

function normalizeSlugCandidate(raw: string | null): string {
  const value = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return value;
}

function resolveRecentSlug(candidatePrefix: string, startTs: number): string | null {
  const root = join(homedir(), '.neeko', 'personas');
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const recent = dirs
    .map((slug) => {
      const path = join(root, slug, 'persona.json');
      if (!existsSync(path)) return null;
      try {
        const persona = JSON.parse(readFileSync(path, 'utf-8')) as { slug?: string; updated_at?: string };
        const updatedAt = new Date(persona.updated_at ?? 0).getTime();
        return {
          slug,
          updatedAt,
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is { slug: string; updatedAt: number } => !!item)
    .filter((item) => item.updatedAt >= startTs - 10 * 60 * 1000)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (candidatePrefix) {
    const matched = recent.find((item) => item.slug === candidatePrefix || item.slug.startsWith(`${candidatePrefix}-`));
    if (matched) return matched.slug;
  }
  return recent[0]?.slug ?? null;
}
