import { NextResponse } from 'next/server';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Conf (projectName: 'neeko') stores here on macOS
const CONFIG_PATH = join(
  homedir(),
  'Library',
  'Preferences',
  'neeko-nodejs',
  'config.json'
);

function readConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(data: Record<string, unknown>) {
  const dir = join(homedir(), 'Library', 'Preferences', 'neeko-nodejs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export async function GET() {
  const cfg = readConfig();
  // Never expose raw keys to client — send masked versions
  return NextResponse.json({
    anthropicApiKey:  cfg.anthropicApiKey  ? String(cfg.anthropicApiKey)  : '',
    openaiApiKey:     cfg.openaiApiKey     ? String(cfg.openaiApiKey)     : '',
    kimiApiKey:       cfg.kimiApiKey       ? String(cfg.kimiApiKey)       : '',
    geminiApiKey:     cfg.geminiApiKey     ? String(cfg.geminiApiKey)     : '',
    deepseekApiKey:   cfg.deepseekApiKey   ? String(cfg.deepseekApiKey)   : '',
    qdrantUrl:        cfg.qdrantUrl        ? String(cfg.qdrantUrl)        : 'http://localhost:6333',
    activeProvider:   cfg.activeProvider   ? String(cfg.activeProvider)   : 'claude',
    defaultTrainingProfile: cfg.defaultTrainingProfile ? String(cfg.defaultTrainingProfile) : 'full',
    ingestMode:       cfg.ingestMode       ? String(cfg.ingestMode)       : 'opencli',
    twitterApiKey:    cfg.twitterApiKey    ? String(cfg.twitterApiKey)    : '',
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const current = readConfig();

  const merged = {
    ...current,
    ...(body.anthropicApiKey  !== undefined && { anthropicApiKey:  body.anthropicApiKey }),
    ...(body.openaiApiKey     !== undefined && { openaiApiKey:     body.openaiApiKey }),
    ...(body.kimiApiKey       !== undefined && { kimiApiKey:       body.kimiApiKey }),
    ...(body.geminiApiKey     !== undefined && { geminiApiKey:     body.geminiApiKey }),
    ...(body.deepseekApiKey   !== undefined && { deepseekApiKey:   body.deepseekApiKey }),
    ...(body.qdrantUrl        !== undefined && { qdrantUrl:        body.qdrantUrl }),
    ...(body.activeProvider   !== undefined && { activeProvider:   body.activeProvider }),
    ...(body.defaultTrainingProfile !== undefined && { defaultTrainingProfile: body.defaultTrainingProfile }),
    ...(body.ingestMode       !== undefined && { ingestMode:       body.ingestMode }),
    ...(body.twitterApiKey    !== undefined && { twitterApiKey:    body.twitterApiKey }),
  };

  writeConfig(merged);
  return NextResponse.json({ ok: true });
}
