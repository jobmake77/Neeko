import { NextResponse } from 'next/server';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface ChatLogItem {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

function getPersonaRoot() {
  return join(homedir(), '.neeko', 'personas');
}

export async function GET() {
  const root = getPersonaRoot();
  if (!existsSync(root)) return NextResponse.json([]);

  const slugs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const items = slugs.map((slug) => {
    const personaPath = join(root, slug, 'persona.json');
    const chatPath = join(root, slug, 'chat-log.json');
    if (!existsSync(personaPath) || !existsSync(chatPath)) return null;
    try {
      const persona = JSON.parse(readFileSync(personaPath, 'utf-8')) as { name: string; slug: string };
      const log = JSON.parse(readFileSync(chatPath, 'utf-8')) as ChatLogItem[];
      if (!Array.isArray(log) || log.length === 0) return null;
      const last = log[log.length - 1];
      return {
        slug: persona.slug,
        name: persona.name,
        last_message: String(last.content ?? '').slice(0, 80),
        last_at: String(last.created_at ?? ''),
        total_messages: log.length,
      };
    } catch {
      return null;
    }
  }).filter(Boolean) as Array<{
    slug: string;
    name: string;
    last_message: string;
    last_at: string;
    total_messages: number;
  }>;

  items.sort((a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime());
  return NextResponse.json(items.slice(0, 20));
}
