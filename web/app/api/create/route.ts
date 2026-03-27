import { spawn } from 'child_process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 去掉 ANSI 转义色彩码
function stripAnsi(str: string) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');      // 'single' | 'fusion'
  const handle = url.searchParams.get('handle');  // e.g. elonmusk
  const skill = url.searchParams.get('skill');    // e.g. 全栈工程师
  const rounds = url.searchParams.get('rounds');  // e.g. 10
  const trainingProfile = url.searchParams.get('trainingProfile'); // e.g. full

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      function send(data: string) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line: data })}\n\n`));
      }
      function sendEvent(event: string, data: object) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
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

      const child = spawn(process.execPath, args, {
        cwd: repoRoot,
        env: { ...process.env },
        // 让子进程跑非交互式（跳过 confirm prompts）
        // 使用 stdio pipe 捕获输出
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

      // 如果客户端断连，kill 子进程
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
