import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WorkbenchService } from '../../core/workbench/service.js';

interface WorkbenchServerOptions {
  port?: string;
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.end(JSON.stringify(payload));
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

export async function cmdWorkbenchServer(
  options: WorkbenchServerOptions = {},
  cliEntryPath = process.argv[1]
): Promise<void> {
  const port = Number(options.port ?? process.env.NEEKO_WORKBENCH_PORT ?? 4310);
  const service = new WorkbenchService(undefined, cliEntryPath, process.cwd());

  const server = createServer(async (req, res) => {
    try {
      if (!req.url) {
        writeJson(res, 404, { error: 'Not found' });
        return;
      }
      if (req.method === 'OPTIONS') {
        writeJson(res, 204, {});
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const path = url.pathname;

      if (req.method === 'GET' && path === '/health') {
        writeJson(res, 200, { ok: true, port });
        return;
      }

      if (req.method === 'GET' && path === '/api/personas') {
        writeJson(res, 200, service.listPersonas());
        return;
      }

      const personaMatch = path.match(/^\/api\/personas\/([^/]+)$/);
      if (req.method === 'GET' && personaMatch) {
        writeJson(res, 200, service.getPersona(decodeURIComponent(personaMatch[1])));
        return;
      }

      const personaConversationsMatch = path.match(/^\/api\/personas\/([^/]+)\/conversations$/);
      if (req.method === 'GET' && personaConversationsMatch) {
        writeJson(res, 200, service.listConversations(decodeURIComponent(personaConversationsMatch[1])));
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
        });
        writeJson(res, 200, run);
        return;
      }

      const conversationMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
      if (req.method === 'GET' && conversationMatch) {
        const bundle = service.getConversation(decodeURIComponent(conversationMatch[1]));
        if (!bundle) {
          writeJson(res, 404, { error: 'Conversation not found' });
          return;
        }
        writeJson(res, 200, bundle);
        return;
      }

      const conversationMessageMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (req.method === 'POST' && conversationMessageMatch) {
        const body = await readBody(req);
        const message = getString(body.message);
        if (!message) throw new Error('message is required');
        const bundle = await service.sendMessage(
          decodeURIComponent(conversationMessageMatch[1]),
          message
        );
        writeJson(res, 200, bundle);
        return;
      }

      const candidatesMatch = path.match(/^\/api\/conversations\/([^/]+)\/writeback-candidates$/);
      if (req.method === 'GET' && candidatesMatch) {
        writeJson(res, 200, service.listMemoryCandidates(decodeURIComponent(candidatesMatch[1])));
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

      const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
      if (req.method === 'GET' && runMatch) {
        const run = service.getRunStatus(decodeURIComponent(runMatch[1]));
        if (!run) {
          writeJson(res, 404, { error: 'Run not found' });
          return;
        }
        writeJson(res, 200, run);
        return;
      }

      const runReportMatch = path.match(/^\/api\/runs\/([^/]+)\/report$/);
      if (req.method === 'GET' && runReportMatch) {
        const report = service.getRunReport(decodeURIComponent(runReportMatch[1]));
        if (!report) {
          writeJson(res, 404, { error: 'Run not found' });
          return;
        }
        writeJson(res, 200, report);
        return;
      }

      writeJson(res, 404, { error: 'Not found' });
    } catch (error) {
      writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
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
