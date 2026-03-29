import { NextResponse } from 'next/server';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { resolveCliEntry } from '@/lib/cli-entry';

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

interface ChatLogItem {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  triggered_skills?: Array<{ id: string; name: string; reason: 'manual' | 'automatic'; trigger_score: number }>;
}

function getChatLogPath(slug: string): string {
  return join(getPersonaDir(slug), 'chat-log.json');
}

function readChatLog(slug: string): ChatLogItem[] {
  const path = getChatLogPath(slug);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ChatLogItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.content === 'string');
  } catch {
    return [];
  }
}

function appendChatLog(slug: string, items: ChatLogItem[]): void {
  try {
    const current = readChatLog(slug);
    const merged = [...current, ...items].slice(-400);
    writeFileSync(getChatLogPath(slug), JSON.stringify(merged, null, 2), 'utf-8');
  } catch {
    // best effort
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const dir = getPersonaDir(slug);
  const personaPath = join(dir, 'persona.json');
  if (!existsSync(personaPath)) {
    return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
  }
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw && /^\d+$/.test(limitRaw) ? Math.max(1, Math.min(200, parseInt(limitRaw, 10))) : 80;
  const log = readChatLog(slug);
  return NextResponse.json({
    slug,
    total: log.length,
    messages: log.slice(-limit),
  });
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
  const { repoRoot, cliEntry } = resolveCliEntry();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const child = spawn(process.execPath, [cliEntry, 'chat-once', slug,
        '--message', message,
        '--history', JSON.stringify(history),
      ], { env, cwd: repoRoot });

      let stdoutOutput = '';
      let stderrOutput = '';
      child.stdout.on('data', (chunk: Buffer) => { stdoutOutput += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderrOutput += chunk.toString(); });

      child.on('close', (code) => {
        let result = stdoutOutput.trim();
        let triggeredSkills: Array<{ id: string; name: string; reason: 'manual' | 'automatic'; trigger_score: number }> = [];
        if (code === 0) {
          try {
            const parsed = JSON.parse(stdoutOutput.trim()) as {
              reply?: string;
              triggered_skills?: Array<{ id: string; name: string; reason: 'manual' | 'automatic'; trigger_score: number }>;
            };
            result = String(parsed.reply ?? '').trim();
            triggeredSkills = Array.isArray(parsed.triggered_skills) ? parsed.triggered_skills : [];
          } catch {
            // Backward-compatible plain text output.
            result = stdoutOutput.trim();
          }
        } else {
          result = `[错误] 模型调用失败（code ${code}）${stderrOutput ? `\n${stderrOutput.trim()}` : ''}`;
        }
        if (!result) result = '[无回复]';
        const now = new Date().toISOString();
        appendChatLog(slug, [
          { role: 'user', content: message, created_at: now },
          { role: 'assistant', content: result, created_at: now, triggered_skills: triggeredSkills },
        ]);
        controller.enqueue(encoder.encode(JSON.stringify({
          reply: result,
          triggered_skills: triggeredSkills,
          skill_application_trace: triggeredSkills.map((item) => ({
            skill_id: item.id,
            skill_name: item.name,
            reason: item.reason,
            trigger_score: item.trigger_score,
          })),
        })));
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
