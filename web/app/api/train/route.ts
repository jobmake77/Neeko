import { spawn } from 'child_process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function stripAnsi(str: string) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const rounds = url.searchParams.get('rounds');
  const trainingProfile = url.searchParams.get('trainingProfile');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      function send(data: string) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line: data })}\n\n`));
      }
      function sendEvent(event: string, data: object) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
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

      const child = spawn(process.execPath, args, {
        cwd: repoRoot,
        env: { ...process.env },
      });

      child.stdout.on('data', (chunk: Buffer) => {
        const lines = stripAnsi(chunk.toString()).split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) send(trimmed);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const lines = stripAnsi(chunk.toString()).split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) send(trimmed);
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          sendEvent('done', { success: true });
        } else {
          send(`❌ 进程退出（code ${code}）`);
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
