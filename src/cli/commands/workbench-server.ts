import { createServer, IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { WorkbenchService } from '../../core/workbench/service.js';

interface WorkbenchServerOptions {
  port?: string;
}

const SERVER_STARTED_AT = new Date().toISOString();

function resolveServerBuildInfo(repoRoot: string): {
  version?: string;
  server_version?: string;
  build_id?: string;
  started_at: string;
  git_sha?: string;
} {
  let version: string | undefined;
  let buildId: string | undefined;
  let gitSha: string | undefined;

  try {
    const packagePath = join(repoRoot, 'package.json');
    if (existsSync(packagePath)) {
      const parsed = JSON.parse(readFileSync(packagePath, 'utf-8')) as { version?: string };
      version = parsed.version;
    }
  } catch {}

  try {
    const distPath = join(repoRoot, 'dist/cli/index.js');
    if (existsSync(distPath)) {
      const mtime = statSync(distPath).mtimeMs;
      buildId = `${version ?? 'dev'}-${Math.round(mtime)}`;
    }
  } catch {}

  try {
    gitSha = execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim() || undefined;
  } catch {}

  return {
    version,
    server_version: version,
    build_id: buildId,
    started_at: SERVER_STARTED_AT,
    git_sha: gitSha,
  };
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.end(JSON.stringify(payload));
}

function writeSafeError(res: ServerResponse, statusCode: number, error: unknown): void {
  writeJson(res, statusCode, { error: toClientSafeError(error) });
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function toClientSafeError(error: unknown): string {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (message.includes('not found')) return 'Requested resource is not available right now.';
  if (message.includes('required')) return 'Some required information is missing.';
  if (message.includes('absolute local path')) return 'Please use an absolute local file path for this import.';
  if (message.includes('must point to a file')) return 'Please choose a file instead of a folder for this import.';
  if (message.includes('json file')) return 'Please choose a valid JSON target manifest file.';
  if (message.includes('different files')) return 'Source and target manifest must be different files.';
  if (message.includes('not available right now')) return 'One of the selected files is not available right now.';
  if (message.includes('qdrant')) return 'Local memory service is not ready yet. Please try again shortly.';
  if (message.includes('timeout') || message.includes('fetch') || message.includes('network') || message.includes('connection')) {
    return 'The local service is still working through a temporary issue. Please try again shortly.';
  }
  return 'The workbench could not finish this action right now.';
}

export async function cmdWorkbenchServer(
  options: WorkbenchServerOptions = {},
  cliEntryPath = process.argv[1]
): Promise<void> {
  const port = Number(options.port ?? process.env.NEEKO_WORKBENCH_PORT ?? 4310);
  const service = new WorkbenchService(undefined, cliEntryPath, process.cwd(), {
    resumeCollectionContinuationsOnInit: true,
  });
  const buildInfo = resolveServerBuildInfo(process.cwd());

  const server = createServer(async (req, res) => {
    try {
      if (!req.url) {
        writeSafeError(res, 404, 'Not found');
        return;
      }
      if (req.method === 'OPTIONS') {
        writeJson(res, 204, {});
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const path = url.pathname;

      if (req.method === 'GET' && path === '/health') {
        writeJson(res, 200, { ok: true, port, ...buildInfo });
        return;
      }

      if (req.method === 'GET' && path === '/api/personas') {
        writeJson(res, 200, service.listPersonas());
        return;
      }

      if (req.method === 'GET' && path === '/api/runtime/model-config') {
        writeJson(res, 200, service.getRuntimeModelConfig());
        return;
      }
      if (req.method === 'PUT' && path === '/api/runtime/model-config') {
        const body = await readBody(req);
        writeJson(res, 200, service.updateRuntimeModelConfig({
          provider: (getString(body.provider) as 'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek' | undefined) ?? 'claude',
          model: getString(body.model) ?? 'claude-sonnet-4-6',
          mode: (getString(body.mode) as 'shared' | 'split' | undefined) ?? 'shared',
          shared_default: body.shared_default && typeof body.shared_default === 'object'
            ? {
                provider: (getString((body.shared_default as Record<string, unknown>).provider) as 'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek' | undefined) ?? 'claude',
                model: getString((body.shared_default as Record<string, unknown>).model) ?? 'claude-sonnet-4-6',
              }
            : undefined,
          chat_default: body.chat_default && typeof body.chat_default === 'object'
            ? {
                provider: (getString((body.chat_default as Record<string, unknown>).provider) as 'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek' | undefined) ?? 'claude',
                model: getString((body.chat_default as Record<string, unknown>).model) ?? 'claude-sonnet-4-6',
              }
            : undefined,
          training_default: body.training_default && typeof body.training_default === 'object'
            ? {
                provider: (getString((body.training_default as Record<string, unknown>).provider) as 'claude' | 'openai' | 'kimi' | 'gemini' | 'deepseek' | undefined) ?? 'claude',
                model: getString((body.training_default as Record<string, unknown>).model) ?? 'claude-sonnet-4-6',
              }
            : undefined,
          api_keys: {
            claude: getString((body.api_keys as Record<string, unknown> | undefined)?.claude),
            openai: getString((body.api_keys as Record<string, unknown> | undefined)?.openai),
            kimi: getString((body.api_keys as Record<string, unknown> | undefined)?.kimi),
            gemini: getString((body.api_keys as Record<string, unknown> | undefined)?.gemini),
            deepseek: getString((body.api_keys as Record<string, unknown> | undefined)?.deepseek),
          },
        }));
        return;
      }
      if (req.method === 'GET' && path === '/api/runtime/settings') {
        writeJson(res, 200, service.getRuntimeSettings());
        return;
      }
      if (req.method === 'PUT' && path === '/api/runtime/settings') {
        const body = await readBody(req);
        writeJson(res, 200, service.updateRuntimeSettings({
          default_training_profile: getString(body.default_training_profile),
          default_input_routing_strategy: getString(body.default_input_routing_strategy),
          qdrant_url: getString(body.qdrant_url),
          data_dir: getString(body.data_dir),
        }));
        return;
      }

      if (req.method === 'GET' && path === '/api/cultivating') {
        writeJson(res, 200, service.listCultivatingPersonas());
        return;
      }

      if (req.method === 'POST' && path === '/api/sources/preview') {
        const body = await readBody(req);
        writeJson(res, 200, await service.previewPersonaSource({
          persona_name: getString(body.persona_name) ?? '',
          source: body.source as any,
        }));
        return;
      }

      const cultivationMatch = path.match(/^\/api\/cultivating\/([^/]+)$/);
      if (req.method === 'GET' && cultivationMatch) {
        writeJson(res, 200, service.getCultivationDetail(decodeURIComponent(cultivationMatch[1])));
        return;
      }

      const personaDetailMatch = path.match(/^\/api\/personas\/([^/]+)\/detail$/);
      if (req.method === 'GET' && personaDetailMatch) {
        writeJson(res, 200, service.getPersonaDetail(decodeURIComponent(personaDetailMatch[1])));
        return;
      }

      const personaConfigMatch = path.match(/^\/api\/personas\/([^/]+)\/config$/);
      if (req.method === 'GET' && personaConfigMatch) {
        writeJson(res, 200, service.getPersonaConfig(decodeURIComponent(personaConfigMatch[1])));
        return;
      }

      const personaSourcesMatch = path.match(/^\/api\/personas\/([^/]+)\/sources$/);
      if (req.method === 'GET' && personaSourcesMatch) {
        writeJson(res, 200, service.getPersonaSources(decodeURIComponent(personaSourcesMatch[1])));
        return;
      }
      if (req.method === 'PUT' && personaSourcesMatch) {
        const slug = decodeURIComponent(personaSourcesMatch[1]);
        const body = await readBody(req);
        writeJson(res, 200, await service.updatePersonaSources(slug, {
          name: getString(body.name),
          update_policy: body.update_policy as any,
          sources: Array.isArray(body.sources) ? body.sources as any : [],
        }));
        return;
      }

      const personaDiscoveredSourcesMatch = path.match(/^\/api\/personas\/([^/]+)\/discovered-sources$/);
      if (req.method === 'GET' && personaDiscoveredSourcesMatch) {
        writeJson(res, 200, service.getDiscoveredSources(decodeURIComponent(personaDiscoveredSourcesMatch[1])));
        return;
      }

      const personaDiscoverSourcesMatch = path.match(/^\/api\/personas\/([^/]+)\/discover-sources$/);
      if (req.method === 'POST' && personaDiscoverSourcesMatch) {
        writeJson(res, 200, await service.discoverPersonaSources(decodeURIComponent(personaDiscoverSourcesMatch[1])));
        return;
      }

      const discoveredSourceDecisionMatch = path.match(/^\/api\/personas\/([^/]+)\/discovered-sources\/([^/]+)\/(accept|reject)$/);
      if (req.method === 'POST' && discoveredSourceDecisionMatch) {
        const slug = decodeURIComponent(discoveredSourceDecisionMatch[1]);
        const candidateId = decodeURIComponent(discoveredSourceDecisionMatch[2]);
        const action = discoveredSourceDecisionMatch[3];
        if (action === 'accept') {
          writeJson(res, 200, service.acceptDiscoveredSource(slug, candidateId));
        } else {
          writeJson(res, 200, service.rejectDiscoveredSource(slug, candidateId));
        }
        return;
      }

      const personaCheckUpdatesMatch = path.match(/^\/api\/personas\/([^/]+)\/check-updates$/);
      if (req.method === 'POST' && personaCheckUpdatesMatch) {
        writeJson(res, 200, await service.checkPersonaUpdates(decodeURIComponent(personaCheckUpdatesMatch[1])));
        return;
      }

      const personaContinueCultivationMatch = path.match(/^\/api\/personas\/([^/]+)\/continue-cultivation$/);
      if (req.method === 'POST' && personaContinueCultivationMatch) {
        writeJson(res, 200, await service.continueCultivationFromSources(decodeURIComponent(personaContinueCultivationMatch[1])));
        return;
      }

      const skillsMatch = path.match(/^\/api\/personas\/([^/]+)\/skills$/);
      if (req.method === 'GET' && skillsMatch) {
        writeJson(res, 200, service.readSkillSummary(decodeURIComponent(skillsMatch[1])));
        return;
      }

      const personaMatch = path.match(/^\/api\/personas\/([^/]+)$/);
      if (req.method === 'GET' && personaMatch) {
        writeJson(res, 200, service.getPersona(decodeURIComponent(personaMatch[1])));
        return;
      }
      if (req.method === 'PATCH' && personaMatch) {
        const slug = decodeURIComponent(personaMatch[1]);
        const body = await readBody(req);
        writeJson(res, 200, await service.updatePersona(slug, {
          name: getString(body.name) ?? '',
          source_type: (getString(body.source_type) as 'social' | 'chat_file' | 'video_file' | 'audio_file' | 'article' | undefined) ?? undefined,
          source_target: getString(body.source_target),
          source_path: getString(body.source_path),
          target_manifest_path: getString(body.target_manifest_path),
          platform: getString(body.platform),
          sources: Array.isArray(body.sources) ? body.sources as any : undefined,
          update_policy: body.update_policy as any,
        }));
        return;
      }
      if (req.method === 'DELETE' && personaMatch) {
        const deleted = await service.deletePersona(decodeURIComponent(personaMatch[1]));
        if (!deleted) {
          writeSafeError(res, 404, 'Persona not found');
          return;
        }
        writeJson(res, 200, { ok: true });
        return;
      }

      const personaMemoryNodeMatch = path.match(/^\/api\/personas\/([^/]+)\/memory-nodes\/([^/]+)$/);
      if (req.method === 'GET' && personaMemoryNodeMatch) {
        const node = await service.getMemoryNode(
          decodeURIComponent(personaMemoryNodeMatch[1]),
          decodeURIComponent(personaMemoryNodeMatch[2])
        );
        if (!node) {
          writeSafeError(res, 404, 'Memory node not found');
          return;
        }
        writeJson(res, 200, node);
        return;
      }

      const personaMemorySourceAssetsMatch = path.match(/^\/api\/personas\/([^/]+)\/memory-nodes\/([^/]+)\/source-assets$/);
      if (req.method === 'GET' && personaMemorySourceAssetsMatch) {
        const assets = await service.getMemoryNodeSourceAssets(
          decodeURIComponent(personaMemorySourceAssetsMatch[1]),
          decodeURIComponent(personaMemorySourceAssetsMatch[2])
        );
        writeJson(res, 200, assets);
        return;
      }

      const personaConversationsMatch = path.match(/^\/api\/personas\/([^/]+)\/conversations$/);
      if (req.method === 'GET' && personaConversationsMatch) {
        writeJson(res, 200, service.listConversations(decodeURIComponent(personaConversationsMatch[1])));
        return;
      }

      const personaHandoffsMatch = path.match(/^\/api\/personas\/([^/]+)\/promotion-handoffs$/);
      if (req.method === 'GET' && personaHandoffsMatch) {
        const personaSlug = decodeURIComponent(personaHandoffsMatch[1]);
        const conversationId = getString(url.searchParams.get('conversationId'));
        writeJson(res, 200, service.listPromotionHandoffs(personaSlug, conversationId));
        return;
      }
      const personaEvidenceImportsMatch = path.match(/^\/api\/personas\/([^/]+)\/evidence-imports$/);
      if (req.method === 'GET' && personaEvidenceImportsMatch) {
        const personaSlug = decodeURIComponent(personaEvidenceImportsMatch[1]);
        const conversationId = getString(url.searchParams.get('conversationId'));
        writeJson(res, 200, service.listEvidenceImports(personaSlug, conversationId));
        return;
      }
      const evidenceImportMatch = path.match(/^\/api\/evidence-imports\/([^/]+)$/);
      if (req.method === 'GET' && evidenceImportMatch) {
        const detail = service.getEvidenceImportDetail(decodeURIComponent(evidenceImportMatch[1]));
        if (!detail) {
          writeSafeError(res, 404, 'Evidence import not found');
          return;
        }
        writeJson(res, 200, detail);
        return;
      }
      if (req.method === 'POST' && personaEvidenceImportsMatch) {
        const body = await readBody(req);
        const sourcePath = getString(body.sourcePath);
        const targetManifestPath = getString(body.targetManifestPath);
        if (!sourcePath) throw new Error('sourcePath is required');
        if (!targetManifestPath) throw new Error('targetManifestPath is required');
        writeJson(res, 200, await service.importEvidence({
          personaSlug: decodeURIComponent(personaEvidenceImportsMatch[1]),
          conversationId: getString(body.conversationId),
          sourceKind: (getString(body.sourceKind) as 'chat' | 'video' | 'audio' | undefined) ?? 'chat',
          sourcePath,
          targetManifestPath,
          chatPlatform: getString(body.chatPlatform) as 'wechat' | 'feishu' | 'custom' | undefined,
        }));
        return;
      }
      const personaTrainingPrepMatch = path.match(/^\/api\/personas\/([^/]+)\/training-preps$/);
      if (req.method === 'GET' && personaTrainingPrepMatch) {
        const personaSlug = decodeURIComponent(personaTrainingPrepMatch[1]);
        const conversationId = getString(url.searchParams.get('conversationId'));
        writeJson(res, 200, service.listTrainingPrepArtifacts(personaSlug, conversationId));
        return;
      }
      if (req.method === 'POST' && personaConversationsMatch) {
        const body = await readBody(req);
        const conversation = service.createConversation(
          decodeURIComponent(personaConversationsMatch[1]),
          getString(body.title) ?? 'New Thread'
        );
        writeJson(res, 200, conversation);
        return;
      }

      if (req.method === 'POST' && path === '/api/personas') {
        const body = await readBody(req);
        const sourceType = getString(body.source_type);
        if (sourceType || Array.isArray(body.sources)) {
          writeJson(res, 200, service.createPersonaFromConfig({
            persona_slug: getString(body.persona_slug),
            name: getString(body.name) ?? '',
            source_type: sourceType as 'social' | 'chat_file' | 'video_file' | 'audio_file' | 'article' | undefined,
            source_target: getString(body.source_target),
            source_path: getString(body.source_path),
            target_manifest_path: getString(body.target_manifest_path),
            platform: getString(body.platform),
            sources: Array.isArray(body.sources) ? body.sources as any : undefined,
            update_policy: body.update_policy as any,
          }));
          return;
        }
        const run = service.createPersona({
          target: getString(body.target),
          skill: getString(body.skill),
          targetManifest: getString(body.targetManifest),
          chatPlatform: getString(body.chatPlatform),
          rounds: getNumber(body.rounds),
          trainingProfile: getString(body.trainingProfile),
          inputRouting: getString(body.inputRouting),
          trainingSeedMode: getString(body.trainingSeedMode),
          kimiStabilityMode: getString(body.kimiStabilityMode),
          slug: getString(body.slug),
        });
        writeJson(res, 200, run);
        return;
      }

      const conversationMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
      if (req.method === 'GET' && conversationMatch) {
        const bundle = service.getConversation(decodeURIComponent(conversationMatch[1]));
        if (!bundle) {
          writeSafeError(res, 404, 'Conversation not found');
          return;
        }
        writeJson(res, 200, bundle);
        return;
      }
      if (req.method === 'PATCH' && conversationMatch) {
        const body = await readBody(req);
        const title = getString(body.title);
        if (!title) throw new Error('title is required');
        const conversation = service.renameConversation(decodeURIComponent(conversationMatch[1]), title);
        if (!conversation) {
          writeSafeError(res, 404, 'Conversation not found');
          return;
        }
        writeJson(res, 200, conversation);
        return;
      }
      if (req.method === 'DELETE' && conversationMatch) {
        const deleted = service.deleteConversation(decodeURIComponent(conversationMatch[1]));
        if (!deleted) {
          writeSafeError(res, 404, 'Conversation not found');
          return;
        }
        writeJson(res, 200, { ok: true });
        return;
      }

      const conversationMessageMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (req.method === 'POST' && conversationMessageMatch) {
        const body = await readBody(req);
        const message = getString(body.message);
        if (!message) throw new Error('message is required');
        const attachments = Array.isArray(body.attachments)
          ? body.attachments
            .map((item) => item as Record<string, unknown>)
            .filter((item) => getString(item.path) && getString(item.name))
            .map((item) => ({
              id: getString(item.id) ?? crypto.randomUUID(),
              type: (getString(item.type) as 'image' | 'video' | 'audio' | 'text' | 'file' | undefined) ?? 'file',
              name: getString(item.name) ?? 'attachment',
              path: getString(item.path) ?? '',
              mime: getString(item.mime),
              size: getNumber(item.size),
            }))
          : [];
        const bundle = await service.sendMessage(
          decodeURIComponent(conversationMessageMatch[1]),
          message,
          attachments,
          body.model_override && typeof body.model_override === 'object'
            ? {
                provider: getString((body.model_override as Record<string, unknown>).provider) as any,
                model: getString((body.model_override as Record<string, unknown>).model),
              }
            : undefined,
        );
        writeJson(res, 200, bundle);
        return;
      }

      const candidatesMatch = path.match(/^\/api\/conversations\/([^/]+)\/writeback-candidates$/);
      if (req.method === 'GET' && candidatesMatch) {
        writeJson(res, 200, service.listMemoryCandidates(decodeURIComponent(candidatesMatch[1])));
        return;
      }

      const handoffsMatch = path.match(/^\/api\/conversations\/([^/]+)\/promotion-handoffs$/);
      if (req.method === 'POST' && handoffsMatch) {
        writeJson(res, 200, service.createPromotionHandoff(decodeURIComponent(handoffsMatch[1])));
        return;
      }

      const candidateReviewMatch = path.match(/^\/api\/conversations\/([^/]+)\/writeback-candidates\/([^/]+)$/);
      if (req.method === 'PATCH' && candidateReviewMatch) {
        const body = await readBody(req);
        const status = getString(body.status) as 'pending' | 'accepted' | 'rejected' | undefined;
        if (!status) throw new Error('status is required');
        const result = service.reviewMemoryCandidate(
          decodeURIComponent(candidateReviewMatch[1]),
          decodeURIComponent(candidateReviewMatch[2]),
          status
        );
        if (!result) {
          writeSafeError(res, 404, 'Candidate not found');
          return;
        }
        writeJson(res, 200, result);
        return;
      }

      const candidatePromotionMatch = path.match(/^\/api\/conversations\/([^/]+)\/writeback-candidates\/([^/]+)\/promotion-state$/);
      if (req.method === 'PATCH' && candidatePromotionMatch) {
        const body = await readBody(req);
        const promotionState = getString(body.promotion_state) as 'idle' | 'ready' | undefined;
        if (!promotionState) throw new Error('promotion_state is required');
        const result = service.setCandidatePromotionState(
          decodeURIComponent(candidatePromotionMatch[1]),
          decodeURIComponent(candidatePromotionMatch[2]),
          promotionState
        );
        if (!result) {
          writeSafeError(res, 404, 'Candidate not found');
          return;
        }
        writeJson(res, 200, result);
        return;
      }

      const refreshSummaryMatch = path.match(/^\/api\/conversations\/([^/]+)\/refresh-summary$/);
      if (req.method === 'POST' && refreshSummaryMatch) {
        const bundle = service.refreshConversationSummary(decodeURIComponent(refreshSummaryMatch[1]));
        if (!bundle) {
          writeSafeError(res, 404, 'Conversation not found');
          return;
        }
        writeJson(res, 200, bundle);
        return;
      }

      const handoffMatch = path.match(/^\/api\/promotion-handoffs\/([^/]+)$/);
      if (req.method === 'GET' && handoffMatch) {
        const handoff = service.getPromotionHandoff(decodeURIComponent(handoffMatch[1]));
        if (!handoff) {
          writeSafeError(res, 404, 'Promotion handoff not found');
          return;
        }
        writeJson(res, 200, handoff);
        return;
      }
      if (req.method === 'PATCH' && handoffMatch) {
        const body = await readBody(req);
        const status = getString(body.status) as 'drafted' | 'queued' | 'archived' | undefined;
        if (!status) throw new Error('status is required');
        const handoff = service.updatePromotionHandoffStatus(decodeURIComponent(handoffMatch[1]), status);
        if (!handoff) {
          writeSafeError(res, 404, 'Promotion handoff not found');
          return;
        }
        writeJson(res, 200, handoff);
        return;
      }

      const handoffExportMatch = path.match(/^\/api\/promotion-handoffs\/([^/]+)\/export$/);
      if (req.method === 'GET' && handoffExportMatch) {
        const requestedFormat = getString(url.searchParams.get('format'));
        const format = requestedFormat === 'json' ? 'json' : 'markdown';
        writeJson(res, 200, service.exportPromotionHandoff(decodeURIComponent(handoffExportMatch[1]), format));
        return;
      }
      const handoffTrainingPrepMatch = path.match(/^\/api\/promotion-handoffs\/([^/]+)\/training-preps$/);
      if (req.method === 'POST' && handoffTrainingPrepMatch) {
        writeJson(res, 200, service.createTrainingPrepFromHandoff(decodeURIComponent(handoffTrainingPrepMatch[1])));
        return;
      }

      const trainingPrepMatch = path.match(/^\/api\/training-preps\/([^/]+)$/);
      if (req.method === 'GET' && trainingPrepMatch) {
        const prep = service.getTrainingPrepArtifact(decodeURIComponent(trainingPrepMatch[1]));
        if (!prep) {
          writeSafeError(res, 404, 'Training prep not found');
          return;
        }
        writeJson(res, 200, prep);
        return;
      }

      const trainingPrepExportMatch = path.match(/^\/api\/training-preps\/([^/]+)\/export$/);
      if (req.method === 'GET' && trainingPrepExportMatch) {
        const requestedFormat = getString(url.searchParams.get('format'));
        const format = requestedFormat === 'json' ? 'json' : 'markdown';
        writeJson(res, 200, service.exportTrainingPrep(decodeURIComponent(trainingPrepExportMatch[1]), format));
        return;
      }

      if (req.method === 'POST' && path === '/api/runs/train') {
        const body = await readBody(req);
        const slug = getString(body.slug);
        if (!slug) throw new Error('slug is required');
        writeJson(res, 200, service.startTraining({
          slug,
          mode: getString(body.mode),
          rounds: getNumber(body.rounds),
          track: getString(body.track),
          trainingProfile: getString(body.trainingProfile),
          inputRouting: getString(body.inputRouting),
          trainingSeedMode: getString(body.trainingSeedMode),
          retries: getNumber(body.retries),
          fromCheckpoint: getString(body.fromCheckpoint),
          kimiStabilityMode: getString(body.kimiStabilityMode),
          prepDocumentsPath: getString(body.prepDocumentsPath),
          prepEvidencePath: getString(body.prepEvidencePath),
          prepArtifactId: getString(body.prepArtifactId),
          evidenceImportId: getString(body.evidenceImportId),
          smoke: getBoolean(body.smoke),
        }));
        return;
      }

      if (req.method === 'POST' && path === '/api/runs/experiment') {
        const body = await readBody(req);
        const slug = getString(body.slug);
        if (!slug) throw new Error('slug is required');
        writeJson(res, 200, service.startExperiment({
          slug,
          profiles: getString(body.profiles),
          rounds: getNumber(body.rounds),
          questionsPerRound: getNumber(body.questionsPerRound),
          outputDir: getString(body.outputDir),
          gate: getBoolean(body.gate),
          maxQualityDrop: getNumber(body.maxQualityDrop),
          maxContradictionRise: getNumber(body.maxContradictionRise),
          maxDuplicationRise: getNumber(body.maxDuplicationRise),
          inputRouting: getString(body.inputRouting),
          trainingSeedMode: getString(body.trainingSeedMode),
          skipProfileSweep: getBoolean(body.skipProfileSweep),
          compareInputRouting: getBoolean(body.compareInputRouting),
          compareTrainingSeed: getBoolean(body.compareTrainingSeed),
          compareVariants: getString(body.compareVariants),
          kimiStabilityMode: getString(body.kimiStabilityMode),
        }));
        return;
      }

      if (req.method === 'POST' && path === '/api/runs/export') {
        const body = await readBody(req);
        const slug = getString(body.slug);
        if (!slug) throw new Error('slug is required');
        writeJson(res, 200, service.exportPersona({
          slug,
          format: getString(body.format),
          outputDir: getString(body.outputDir),
        }));
        return;
      }

      if (req.method === 'GET' && path === '/api/runs') {
        const personaSlug = url.searchParams.get('personaSlug') ?? undefined;
        writeJson(res, 200, service.listRuns(personaSlug));
        return;
      }

      const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
      if (req.method === 'GET' && runMatch) {
        const run = service.getRunStatus(decodeURIComponent(runMatch[1]));
        if (!run) {
          writeSafeError(res, 404, 'Run not found');
          return;
        }
        writeJson(res, 200, run);
        return;
      }

      const runReportMatch = path.match(/^\/api\/runs\/([^/]+)\/report$/);
      if (req.method === 'GET' && runReportMatch) {
        const report = service.getRunReport(decodeURIComponent(runReportMatch[1]));
        if (!report) {
          writeSafeError(res, 404, 'Run not found');
          return;
        }
        writeJson(res, 200, report);
        return;
      }

      writeSafeError(res, 404, 'Not found');
    } catch (error) {
      console.error('[workbench-server]', error);
      writeJson(res, 500, { error: toClientSafeError(error) });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      console.log(`Workbench server listening on http://127.0.0.1:${port}`);
      resolve();
    });
  });
}
