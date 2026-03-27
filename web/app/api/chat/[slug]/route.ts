import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIG_PATH = join(homedir(), 'Library', 'Preferences', 'neeko-nodejs', 'config.json');

function readConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; }
}

function getPersonaDir(slug: string) {
  return join(homedir(), '.neeko', 'personas', slug);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const dir = getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');

  if (!existsSync(personaPath)) {
    return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
  }

  const { message, history } = await req.json() as {
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  const cfg = readConfig();

  // Resolve model identifier to pass to the inline script
  const activeProvider = String(cfg.activeProvider ?? 'claude');
  const anthropicKey = String(cfg.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '');
  const openaiKey    = String(cfg.openaiApiKey    ?? process.env.OPENAI_API_KEY    ?? '');
  const kimiKey      = String(cfg.kimiApiKey      ?? process.env.KIMI_API_KEY      ?? '');
  const geminiKey    = String(cfg.geminiApiKey    ?? process.env.GEMINI_API_KEY    ?? '');
  const deepseekKey  = String(cfg.deepseekApiKey  ?? process.env.DEEPSEEK_API_KEY  ?? '');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEEKO_ACTIVE_PROVIDER: activeProvider,
  };
  if (anthropicKey) env.ANTHROPIC_API_KEY = anthropicKey;
  if (openaiKey)    env.OPENAI_API_KEY    = openaiKey;
  if (kimiKey)      env.KIMI_API_KEY      = kimiKey;
  if (geminiKey)    env.GOOGLE_GENERATIVE_AI_API_KEY = geminiKey;
  if (deepseekKey)  env.DEEPSEEK_API_KEY  = deepseekKey;

  // Call CLI chat-once command via child process
  const { spawn } = await import('child_process');
  const repoRoot = `${process.cwd()}/..`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const child = spawn(process.execPath, ['dist/index.js', 'chat-once', slug,
        '--message', message,
        '--history', JSON.stringify(history),
      ], { env, cwd: repoRoot });

      let stdoutOutput = '';
      let stderrOutput = '';
      child.stdout.on('data', (chunk: Buffer) => { stdoutOutput += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderrOutput += chunk.toString(); });

      child.on('close', (code) => {
        const result = code === 0
          ? stdoutOutput.trim()
          : `[错误] 模型调用失败（code ${code}）${stderrOutput ? `\n${stderrOutput.trim()}` : ''}`;
        controller.enqueue(encoder.encode(JSON.stringify({ reply: result })));
        controller.close();
      });

      child.on('error', (err) => {
        controller.enqueue(encoder.encode(JSON.stringify({ reply: `[错误] ${err.message}` })));
        controller.close();
      });

      req.signal.addEventListener('abort', () => { child.kill(); controller.close(); });
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
}
