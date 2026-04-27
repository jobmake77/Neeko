import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RawDocument, RawDocumentSchema } from '../models/memory.js';
import {
  EvidenceItem,
  EvidenceItemSchema,
  EvidenceReference,
  EvidenceReferenceSchema,
  PersonaIdentityArc,
  PersonaIdentityArcSchema,
  PersonaIdentityFacet,
  PersonaWebArtifacts,
  PersonaWebArtifactsSchema,
  PersonaWebContextFrame,
  PersonaWebContextFrameSchema,
  PersonaWebEntity,
  PersonaWebEntitySchema,
  PersonaWebEntityType,
  PersonaWebGraph,
  PersonaWebGraphSchema,
  PersonaWebGraphSource,
  PersonaWebProvenanceReport,
  PersonaWebProvenanceReportSchema,
  PersonaWebRelation,
  PersonaWebRelationSchema,
  PersonaWebRelationType,
  TrainingSeedV3,
  TrainingSeedV3Schema,
} from '../models/evidence.js';
import { loadEvidenceItemsFromFile } from './evidence-layer.js';

const DEFAULT_ENTITY_LIMIT = 48;
const DEFAULT_RELATION_LIMIT = 72;
const DEFAULT_CONTEXT_LIMIT = 24;
const DEFAULT_IDENTITY_ARC_LIMIT = 24;
const HIGH_CONFIDENCE_THRESHOLD = 0.72;
const PERSONA_WEB_FILENAMES = {
  entities: 'persona-web-entities.json',
  relations: 'persona-web-relations.json',
  contexts: 'persona-web-contexts.json',
  identityArcs: 'persona-web-identity-arcs.json',
  graph: 'persona-web-graph.json',
  trainingSeedV3: 'training-seed-v3.json',
  provenanceReport: 'persona-web-provenance-report.json',
} as const;

interface PersonaWebBuildInput {
  personaSlug?: string;
  targetName?: string;
  documents: RawDocument[];
  evidenceItems?: EvidenceItem[];
  source?: Partial<PersonaWebGraphSource>;
  maxEntities?: number;
  maxRelations?: number;
  maxContexts?: number;
  maxIdentityArcs?: number;
}

export interface PersonaWebBuildResult {
  graph: PersonaWebGraph;
  trainingSeedV3: TrainingSeedV3;
  provenanceReport: PersonaWebProvenanceReport;
}

export interface PersonaWebArtifactBundle extends PersonaWebBuildResult {
  artifacts: PersonaWebArtifacts;
}

export interface EnsurePersonaWebArtifactsInput {
  outputDir: string;
  personaSlug?: string;
  targetName?: string;
  documentsPath?: string;
  evidencePath?: string;
  prepArtifactId?: string;
  evidenceImportId?: string;
}

interface EntityAccumulator {
  id: string;
  canonicalName: string;
  entityType: PersonaWebEntityType;
  aliases: Set<string>;
  evidenceRefs: EvidenceReference[];
  confidenceValues: number[];
  salience: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  metadata: Record<string, unknown>;
}

interface ContextAccumulator {
  id: string;
  label: string;
  scene: EvidenceItem['scene'];
  speakerNames: Set<string>;
  participantEntityIds: Set<string>;
  startedAt?: string;
  endedAt?: string;
  confidenceValues: number[];
  evidenceRefs: EvidenceReference[];
  snippets: string[];
}

interface RelationAccumulator {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: PersonaWebRelationType;
  direction: 'directed' | 'undirected';
  valence: 'positive' | 'neutral' | 'negative' | 'mixed';
  summary: string;
  contextFrameIds: Set<string>;
  evidenceRefs: EvidenceReference[];
  confidenceValues: number[];
  firstSeenAt?: string;
  lastSeenAt?: string;
}

interface IdentityArcAccumulator {
  id: string;
  facet: PersonaIdentityFacet;
  label: string;
  summary: string;
  relatedEntityIds: Set<string>;
  evidenceRefs: EvidenceReference[];
  confidenceValues: number[];
  firstSeenAt?: string;
  lastSeenAt?: string;
  hasHistoricalSignal: boolean;
}

interface RelationPattern {
  relationType: PersonaWebRelationType;
  regex: RegExp;
  targetEntityType: PersonaWebEntityType;
  valence: 'positive' | 'neutral' | 'negative';
  direction?: 'directed' | 'undirected';
}

const RELATION_PATTERNS: RelationPattern[] = [
  {
    relationType: 'self_describes',
    regex: /\b(?:i am|i'm|i was|as a|as an)\s+([^,.!\n;]{2,64})/ig,
    targetEntityType: 'identity_facet',
    valence: 'neutral',
  },
  {
    relationType: 'builds',
    regex: /\b(?:i build|i built|i'm building|i maintain|i maintained|i create|i created|i made)\s+([^,.!\n;]{2,64})/ig,
    targetEntityType: 'project',
    valence: 'positive',
  },
  {
    relationType: 'works_on',
    regex: /\b(?:i work on|i'm working on|i focus on|i am focused on|i spend time on)\s+([^,.!\n;]{2,64})/ig,
    targetEntityType: 'project',
    valence: 'positive',
  },
  {
    relationType: 'uses',
    regex: /\b(?:i use|i'm using|i used|i rely on)\s+([^,.!\n;]{2,64})/ig,
    targetEntityType: 'product',
    valence: 'neutral',
  },
  {
    relationType: 'prefers',
    regex: /\b(?:i prefer|i like|i enjoy|i gravitate to)\s+([^,.!\n;]{2,64})/ig,
    targetEntityType: 'product',
    valence: 'positive',
  },
  {
    relationType: 'collaborates_with',
    regex: /\b(?:with|alongside|together with|collaborat(?:e|ed|ing) with)\s+([^,.!\n;]{2,48})/ig,
    targetEntityType: 'person',
    valence: 'positive',
    direction: 'undirected',
  },
  {
    relationType: 'learns_from',
    regex: /\b(?:i learn(?:ed|ing)? from|i was inspired by|inspired by)\s+([^,.!\n;]{2,48})/ig,
    targetEntityType: 'person',
    valence: 'positive',
  },
  {
    relationType: 'teaches',
    regex: /\b(?:i teach|i share|i explain|i write about)\s+([^,.!\n;]{2,64})/ig,
    targetEntityType: 'topic',
    valence: 'positive',
  },
  {
    relationType: 'cares_about',
    regex: /\b(?:i care about|i value|i believe in)\s+([^,.!\n;]{2,64})/ig,
    targetEntityType: 'value',
    valence: 'positive',
  },
  {
    relationType: 'avoids',
    regex: /\b(?:i avoid|i do not do|i don't do|i stay away from|i hate)\s+([^,.!\n;]{2,64})/ig,
    targetEntityType: 'topic',
    valence: 'negative',
  },
  {
    relationType: 'belongs_to',
    regex: /\b(?:i'm part of|i am part of|i work at|i am at|member of)\s+([^,.!\n;]{2,64})/ig,
    targetEntityType: 'organization',
    valence: 'neutral',
  },
];

export function buildPersonaWebArtifacts(input: PersonaWebBuildInput): PersonaWebBuildResult {
  const generatedAt = new Date().toISOString();
  const documents = input.documents
    .map((doc) => RawDocumentSchema.safeParse(doc))
    .filter((item): item is { success: true; data: RawDocument } => item.success)
    .map((item) => item.data);
  const evidenceItems = Array.isArray(input.evidenceItems)
    ? input.evidenceItems
      .map((item) => normalizeEvidenceItemForPersonaWeb(item))
      .filter((item): item is EvidenceItem => Boolean(item))
    : [];
  const entityMap = new Map<string, EntityAccumulator>();
  const contextMap = new Map<string, ContextAccumulator>();
  const relationMap = new Map<string, RelationAccumulator>();
  const identityArcMap = new Map<string, IdentityArcAccumulator>();
  const targetName = cleanPhrase(input.targetName ?? inferTargetName(documents, evidenceItems) ?? input.personaSlug ?? 'target') ?? 'target';
  const targetEntity = ensureEntity(entityMap, targetName, 'person', {
    excerpt: targetName,
    confidence: 0.98,
  }, {
    is_target: true,
    persona_slug: input.personaSlug,
  });

  for (const doc of documents) {
    const timestamp = doc.published_at ?? doc.fetched_at;
    const docRef = buildDocumentReference(doc, 0.74);
    if (doc.author) {
      const authorType = isTargetSpeaker(doc.author, targetName) ? 'person' : 'person';
      const authorEntity = ensureEntity(entityMap, doc.author, authorType, docRef);
      if (!isTargetSpeaker(doc.author, targetName) && mentionsTarget(doc.content, targetName)) {
        addRelation(relationMap, {
          sourceEntityId: authorEntity.id,
          targetEntityId: targetEntity.id,
          relationType: 'associated_with',
          direction: 'directed',
          valence: 'neutral',
          summary: `${authorEntity.canonicalName} references ${targetEntity.canonicalName}`,
          contextFrameId: undefined,
          evidenceRef: docRef,
          confidence: 0.52,
          seenAt: timestamp,
        });
      }
    }

    for (const candidate of extractDocumentEntities(doc.content)) {
      ensureEntity(entityMap, candidate, guessEntityType(candidate), docRef);
    }
  }

  for (const item of evidenceItems) {
    const evidenceRef = buildEvidenceReference(item, item.target_confidence);
    const frameId = registerContextFrame(contextMap, item, entityMap, targetName);
    const speakerEntity = ensureEntity(entityMap, item.speaker_name, isTargetSpeaker(item.speaker_name, targetName) ? 'person' : 'person', evidenceRef);
    if (frameId) {
      const frame = contextMap.get(frameId);
      if (frame) frame.participantEntityIds.add(speakerEntity.id);
    }

    const speakerNames = [
      item.speaker_name,
      ...item.context_before.map((entry) => entry.speaker_name),
      ...item.context_after.map((entry) => entry.speaker_name),
    ];
    for (const name of speakerNames) {
      if (!name) continue;
      const entity = ensureEntity(entityMap, name, isTargetSpeaker(name, targetName) ? 'person' : 'person', evidenceRef);
      const frame = frameId ? contextMap.get(frameId) : null;
      if (frame) frame.participantEntityIds.add(entity.id);
    }

    for (const candidate of extractDocumentEntities(item.content)) {
      const entity = ensureEntity(entityMap, candidate, guessEntityType(candidate), evidenceRef);
      const frame = frameId ? contextMap.get(frameId) : null;
      if (frame) frame.participantEntityIds.add(entity.id);
    }

    if (!isTargetCentricEvidence(item, targetName)) continue;
    const derivedRelations = extractTargetRelations(item.content, targetEntity.id, frameId, evidenceRef, entityMap, item);
    for (const relation of derivedRelations) {
      addRelation(relationMap, relation);
    }
  }

  const relations = finalizeRelations(relationMap, input.maxRelations ?? DEFAULT_RELATION_LIMIT);
  const contextFrames = finalizeContextFrames(contextMap, input.maxContexts ?? DEFAULT_CONTEXT_LIMIT);
  const identityArcs = finalizeIdentityArcs(relations, input.maxIdentityArcs ?? DEFAULT_IDENTITY_ARC_LIMIT);
  const entities = finalizeEntities(entityMap, input.maxEntities ?? DEFAULT_ENTITY_LIMIT, relations, contextFrames, identityArcs);

  const graph: PersonaWebGraph = PersonaWebGraphSchema.parse({
    schema_version: 1,
    generated_at: generatedAt,
    persona_slug: input.personaSlug,
    target_name: targetName,
    source: {
      documents_path: input.source?.documents_path,
      evidence_index_path: input.source?.evidence_index_path,
      prep_artifact_id: input.source?.prep_artifact_id,
      evidence_import_id: input.source?.evidence_import_id,
    },
    stats: {
      document_count: documents.length,
      evidence_count: evidenceItems.length,
      entity_count: entities.length,
      relation_count: relations.length,
      context_count: contextFrames.length,
      identity_arc_count: identityArcs.length,
      high_confidence_entity_count: entities.filter((item) => item.confidence >= HIGH_CONFIDENCE_THRESHOLD).length,
      high_confidence_relation_count: relations.filter((item) => item.confidence >= HIGH_CONFIDENCE_THRESHOLD).length,
    },
    entities,
    relations,
    context_frames: contextFrames,
    identity_arcs: identityArcs,
  });

  const provenanceReport = buildProvenanceReport(graph);
  const trainingSeedV3 = compileTrainingSeedV3(graph, provenanceReport);
  return {
    graph,
    trainingSeedV3,
    provenanceReport,
  };
}

export function compileTrainingSeedV3(
  graph: PersonaWebGraph,
  provenanceReport: PersonaWebProvenanceReport = buildProvenanceReport(graph)
): TrainingSeedV3 {
  const topicEntities = graph.entities
    .filter((item) => item.entity_type === 'project' || item.entity_type === 'product' || item.entity_type === 'topic' || item.entity_type === 'value')
    .sort((a, b) => b.salience - a.salience || b.confidence - a.confidence)
    .slice(0, 8)
    .map((item) => item.canonical_name);
  const relationshipHints = graph.relations
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8)
    .map((item) => item.summary);
  const contextHints = graph.context_frames
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 6)
    .map((item) => `${item.scene}: ${item.summary}`);
  const identityHints = graph.identity_arcs
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 6)
    .map((item) => item.summary);
  const signals = dedupeStrings([
    ...relationshipHints,
    ...identityHints,
    ...graph.entities
      .filter((item) => item.entity_type === 'person' || item.entity_type === 'organization')
      .sort((a, b) => b.salience - a.salience)
      .slice(0, 6)
      .map((item) => item.canonical_name),
  ]).slice(0, 12);
  const guardrails = buildGuardrailNotes(graph, provenanceReport);
  const dominantDomains = inferDominantDomains(graph, topicEntities, contextHints, relationshipHints, identityHints);

  return TrainingSeedV3Schema.parse({
    schema_version: 3,
    generated_at: graph.generated_at,
    persona_slug: graph.persona_slug,
    target_name: graph.target_name,
    summary: summarizeGraph(graph),
    stats: {
      entity_count: graph.stats.entity_count,
      relation_count: graph.stats.relation_count,
      context_count: graph.stats.context_count,
      identity_arc_count: graph.stats.identity_arc_count,
      provenance_coverage_score: provenanceReport.coverage_score,
      verified_relation_count: provenanceReport.verified_relation_count,
      guarded_claim_count: guardrails.length,
    },
    dominant_domains: dominantDomains,
    topics: topicEntities,
    signals,
    relationship_hints: relationshipHints,
    context_hints: contextHints,
    identity_hints: identityHints,
    provenance_guardrails: guardrails,
  });
}

export function buildProvenanceReport(graph: PersonaWebGraph): PersonaWebProvenanceReport {
  const verifiedEntities = graph.entities.filter((item) => item.confidence >= HIGH_CONFIDENCE_THRESHOLD);
  const verifiedRelations = graph.relations.filter((item) => item.confidence >= HIGH_CONFIDENCE_THRESHOLD);
  const lowConfidenceEntities = graph.entities.filter((item) => item.confidence < 0.45);
  const lowConfidenceRelations = graph.relations.filter((item) => item.confidence < 0.45);
  const coverageScore = clamp01(
    (safeRatio(verifiedEntities.length, Math.max(1, graph.entities.length)) * 0.35) +
    (safeRatio(verifiedRelations.length, Math.max(1, graph.relations.length)) * 0.45) +
    (Math.min(1, graph.identity_arcs.length / 5) * 0.2)
  );
  const guardrailContext = {
    coverage_score: coverageScore,
    low_confidence_entity_count: lowConfidenceEntities.length,
    low_confidence_relation_count: lowConfidenceRelations.length,
  } satisfies Pick<PersonaWebProvenanceReport, 'coverage_score' | 'low_confidence_entity_count' | 'low_confidence_relation_count'>;
  return PersonaWebProvenanceReportSchema.parse({
    schema_version: 1,
    generated_at: graph.generated_at,
    persona_slug: graph.persona_slug,
    target_name: graph.target_name,
    coverage_score: coverageScore,
    verified_entity_count: verifiedEntities.length,
    verified_relation_count: verifiedRelations.length,
    low_confidence_entity_count: lowConfidenceEntities.length,
    low_confidence_relation_count: lowConfidenceRelations.length,
    guardrail_notes: buildGuardrailNotes(graph, guardrailContext),
  });
}

export function selectTrainingSeedV3Hints(seed: TrainingSeedV3, limit = 8): string[] {
  return dedupeStrings([
    ...seed.relationship_hints,
    ...seed.identity_hints,
    ...seed.context_hints,
    ...seed.topics,
    ...seed.signals,
  ]).slice(0, Math.max(1, limit));
}

export function writePersonaWebArtifacts(outputDir: string, result: PersonaWebBuildResult): PersonaWebArtifacts {
  mkdirSync(outputDir, { recursive: true });
  const entityIndexPath = join(outputDir, PERSONA_WEB_FILENAMES.entities);
  const relationIndexPath = join(outputDir, PERSONA_WEB_FILENAMES.relations);
  const contextIndexPath = join(outputDir, PERSONA_WEB_FILENAMES.contexts);
  const identityArcPath = join(outputDir, PERSONA_WEB_FILENAMES.identityArcs);
  const graphPath = join(outputDir, PERSONA_WEB_FILENAMES.graph);
  const trainingSeedV3Path = join(outputDir, PERSONA_WEB_FILENAMES.trainingSeedV3);
  const provenanceReportPath = join(outputDir, PERSONA_WEB_FILENAMES.provenanceReport);

  writeFileSync(entityIndexPath, JSON.stringify(result.graph.entities, null, 2), 'utf-8');
  writeFileSync(relationIndexPath, JSON.stringify(result.graph.relations, null, 2), 'utf-8');
  writeFileSync(contextIndexPath, JSON.stringify(result.graph.context_frames, null, 2), 'utf-8');
  writeFileSync(identityArcPath, JSON.stringify(result.graph.identity_arcs, null, 2), 'utf-8');
  writeFileSync(graphPath, JSON.stringify(result.graph, null, 2), 'utf-8');
  writeFileSync(trainingSeedV3Path, JSON.stringify(result.trainingSeedV3, null, 2), 'utf-8');
  writeFileSync(provenanceReportPath, JSON.stringify(result.provenanceReport, null, 2), 'utf-8');

  return PersonaWebArtifactsSchema.parse({
    entity_index_path: entityIndexPath,
    relation_index_path: relationIndexPath,
    context_index_path: contextIndexPath,
    identity_arc_path: identityArcPath,
    graph_path: graphPath,
    training_seed_v3_path: trainingSeedV3Path,
    provenance_report_path: provenanceReportPath,
  });
}

export function ensurePersonaWebArtifacts(input: EnsurePersonaWebArtifactsInput): PersonaWebArtifactBundle | null {
  const documents = loadRawDocuments(input.documentsPath);
  const evidenceItems = loadEvidenceItems(input.evidencePath);
  if (documents.length === 0 && evidenceItems.length === 0) return null;
  const result = buildPersonaWebArtifacts({
    personaSlug: input.personaSlug,
    targetName: input.targetName,
    documents,
    evidenceItems,
    source: {
      documents_path: input.documentsPath,
      evidence_index_path: input.evidencePath,
      prep_artifact_id: input.prepArtifactId,
      evidence_import_id: input.evidenceImportId,
    },
  });
  const artifacts = writePersonaWebArtifacts(input.outputDir, result);
  return {
    ...result,
    artifacts,
  };
}

export function loadPersonaWebArtifactsFromDir(dir: string): PersonaWebArtifactBundle | null {
  const artifacts = PersonaWebArtifactsSchema.safeParse({
    entity_index_path: join(dir, PERSONA_WEB_FILENAMES.entities),
    relation_index_path: join(dir, PERSONA_WEB_FILENAMES.relations),
    context_index_path: join(dir, PERSONA_WEB_FILENAMES.contexts),
    identity_arc_path: join(dir, PERSONA_WEB_FILENAMES.identityArcs),
    graph_path: join(dir, PERSONA_WEB_FILENAMES.graph),
    training_seed_v3_path: join(dir, PERSONA_WEB_FILENAMES.trainingSeedV3),
    provenance_report_path: join(dir, PERSONA_WEB_FILENAMES.provenanceReport),
  });
  if (!artifacts.success) return null;
  const paths = artifacts.data;
  const requiredPaths = Object.values(paths);
  if (requiredPaths.some((filePath) => !existsSync(filePath))) return null;
  try {
    const graph = PersonaWebGraphSchema.parse(JSON.parse(readFileSync(paths.graph_path, 'utf-8')));
    const trainingSeedV3 = TrainingSeedV3Schema.parse(JSON.parse(readFileSync(paths.training_seed_v3_path, 'utf-8')));
    const provenanceReport = PersonaWebProvenanceReportSchema.parse(JSON.parse(readFileSync(paths.provenance_report_path, 'utf-8')));
    return {
      graph,
      trainingSeedV3,
      provenanceReport,
      artifacts: paths,
    };
  } catch {
    return null;
  }
}

function loadRawDocuments(filePath?: string): RawDocument[] {
  if (!filePath || !existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => RawDocumentSchema.safeParse(item))
      .filter((item): item is { success: true; data: RawDocument } => item.success)
      .map((item) => item.data);
  } catch {
    return [];
  }
}

function loadEvidenceItems(filePath?: string): EvidenceItem[] {
  if (!filePath || !existsSync(filePath)) return [];
  return loadEvidenceItemsFromFile(filePath);
}

function ensureEntity(
  entityMap: Map<string, EntityAccumulator>,
  rawName: string,
  entityType: PersonaWebEntityType,
  evidenceRef: EvidenceReference,
  metadata: Record<string, unknown> = {}
): EntityAccumulator {
  const canonicalName = cleanPhrase(rawName) ?? rawName.trim();
  const key = normalizeNameKey(canonicalName);
  const existing = entityMap.get(key);
  if (existing) {
    existing.aliases.add(canonicalName);
    existing.evidenceRefs.push(evidenceRef);
    existing.confidenceValues.push(evidenceRef.confidence ?? 0.5);
    existing.salience += 1;
    mergeRange(existing, evidenceRef.timestamp_start, evidenceRef.timestamp_end);
    existing.metadata = {
      ...existing.metadata,
      ...metadata,
    };
    return existing;
  }

  const next: EntityAccumulator = {
    id: `entity:${key || crypto.randomUUID()}`,
    canonicalName,
    entityType,
    aliases: new Set([canonicalName]),
    evidenceRefs: [evidenceRef],
    confidenceValues: [evidenceRef.confidence ?? 0.5],
    salience: 1,
    firstSeenAt: evidenceRef.timestamp_start,
    lastSeenAt: evidenceRef.timestamp_end ?? evidenceRef.timestamp_start,
    metadata,
  };
  entityMap.set(key, next);
  return next;
}

function registerContextFrame(
  contextMap: Map<string, ContextAccumulator>,
  item: EvidenceItem,
  entityMap: Map<string, EntityAccumulator>,
  targetName: string,
): string {
  const timeKey = timeBucket(item.timestamp_start ?? item.timestamp_end);
  const id = `context:${normalizeNameKey(item.session_id ?? item.conversation_id ?? `${item.scene}:${timeKey}`)}`;
  const existing = contextMap.get(id);
  const evidenceRef = buildEvidenceReference(item, item.target_confidence);
  if (existing) {
    existing.speakerNames.add(item.speaker_name);
    existing.confidenceValues.push(item.target_confidence);
    existing.evidenceRefs.push(evidenceRef);
    existing.snippets.push(item.content);
    mergeRange(existing, item.timestamp_start, item.timestamp_end);
    return existing.id;
  }

  const frame: ContextAccumulator = {
    id,
    label: item.session_id ?? item.conversation_id ?? `${item.scene}:${timeKey}`,
    scene: item.scene,
    speakerNames: new Set([item.speaker_name]),
    participantEntityIds: new Set(),
    startedAt: item.timestamp_start,
    endedAt: item.timestamp_end ?? item.timestamp_start,
    confidenceValues: [item.target_confidence],
    evidenceRefs: [evidenceRef],
    snippets: [item.content],
  };
  contextMap.set(id, frame);

  const speakerEntity = ensureEntity(entityMap, item.speaker_name, isTargetSpeaker(item.speaker_name, targetName) ? 'person' : 'person', evidenceRef);
  frame.participantEntityIds.add(speakerEntity.id);
  return id;
}

function extractTargetRelations(
  content: string,
  sourceEntityId: string,
  contextFrameId: string | undefined,
  evidenceRef: EvidenceReference,
  entityMap: Map<string, EntityAccumulator>,
  item: EvidenceItem,
): Array<{
  sourceEntityId: string;
  targetEntityId: string;
  relationType: PersonaWebRelationType;
  direction: 'directed' | 'undirected';
  valence: 'positive' | 'neutral' | 'negative';
  summary: string;
  contextFrameId?: string;
  evidenceRef: EvidenceReference;
  confidence: number;
  seenAt?: string;
}> {
  const relations: Array<{
    sourceEntityId: string;
    targetEntityId: string;
    relationType: PersonaWebRelationType;
    direction: 'directed' | 'undirected';
    valence: 'positive' | 'neutral' | 'negative';
    summary: string;
    contextFrameId?: string;
    evidenceRef: EvidenceReference;
    confidence: number;
    seenAt?: string;
  }> = [];

  for (const pattern of RELATION_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(content)) !== null) {
      const phrase = sanitizeRelationObject(match[1] ?? '');
      if (!phrase) continue;
      const targetEntity = ensureEntity(entityMap, phrase, pattern.targetEntityType, evidenceRef);
      relations.push({
        sourceEntityId,
        targetEntityId: targetEntity.id,
        relationType: pattern.relationType,
        direction: pattern.direction ?? 'directed',
        valence: pattern.valence,
        summary: summarizeRelation(pattern.relationType, phrase),
        contextFrameId,
        evidenceRef,
        confidence: computeRelationConfidence(item, pattern.relationType),
        seenAt: item.timestamp_start ?? item.timestamp_end,
      });
    }
  }

  return relations;
}

function addRelation(
  relationMap: Map<string, RelationAccumulator>,
  relation: {
    sourceEntityId: string;
    targetEntityId: string;
    relationType: PersonaWebRelationType;
    direction: 'directed' | 'undirected';
    valence: 'positive' | 'neutral' | 'negative';
    summary: string;
    contextFrameId?: string;
    evidenceRef: EvidenceReference;
    confidence: number;
    seenAt?: string;
  }
): void {
  const key = [relation.sourceEntityId, relation.targetEntityId, relation.relationType, relation.direction].join(':');
  const existing = relationMap.get(key);
  if (existing) {
    existing.summary = existing.summary.length >= relation.summary.length ? existing.summary : relation.summary;
    existing.contextFrameIds.add(relation.contextFrameId ?? '');
    existing.evidenceRefs.push(relation.evidenceRef);
    existing.confidenceValues.push(relation.confidence);
    mergeRange(existing, relation.seenAt, relation.seenAt);
    if (existing.valence !== relation.valence) existing.valence = 'mixed';
    return;
  }

  relationMap.set(key, {
    id: `relation:${crypto.randomUUID()}`,
    sourceEntityId: relation.sourceEntityId,
    targetEntityId: relation.targetEntityId,
    relationType: relation.relationType,
    direction: relation.direction,
    valence: relation.valence,
    summary: relation.summary,
    contextFrameIds: new Set(relation.contextFrameId ? [relation.contextFrameId] : []),
    evidenceRefs: [relation.evidenceRef],
    confidenceValues: [relation.confidence],
    firstSeenAt: relation.seenAt,
    lastSeenAt: relation.seenAt,
  });
}

function finalizeRelations(relationMap: Map<string, RelationAccumulator>, limit: number): PersonaWebRelation[] {
  return [...relationMap.values()]
    .map((item) => PersonaWebRelationSchema.parse({
      id: item.id,
      source_entity_id: item.sourceEntityId,
      target_entity_id: item.targetEntityId,
      relation_type: item.relationType,
      direction: item.direction,
      valence: item.valence,
      confidence: average(item.confidenceValues),
      context_frame_ids: [...item.contextFrameIds].filter(Boolean),
      evidence_refs: dedupeEvidenceRefs(item.evidenceRefs),
      first_seen_at: item.firstSeenAt,
      last_seen_at: item.lastSeenAt,
      summary: item.summary,
    }))
    .sort((a, b) => b.confidence - a.confidence || b.evidence_refs.length - a.evidence_refs.length)
    .slice(0, limit);
}

function finalizeContextFrames(contextMap: Map<string, ContextAccumulator>, limit: number): PersonaWebContextFrame[] {
  return [...contextMap.values()]
    .map((item) => PersonaWebContextFrameSchema.parse({
      id: item.id,
      label: item.label,
      summary: summarizeContext(item),
      scene: item.scene,
      speaker_names: [...item.speakerNames],
      participant_entity_ids: [...item.participantEntityIds],
      started_at: item.startedAt,
      ended_at: item.endedAt,
      confidence: average(item.confidenceValues),
      evidence_refs: dedupeEvidenceRefs(item.evidenceRefs),
    }))
    .sort((a, b) => b.confidence - a.confidence || b.evidence_refs.length - a.evidence_refs.length)
    .slice(0, limit);
}

function finalizeIdentityArcs(relations: PersonaWebRelation[], limit: number): PersonaIdentityArc[] {
  const arcMap = new Map<string, IdentityArcAccumulator>();
  for (const relation of relations) {
    const mapping = mapRelationToIdentityFacet(relation.relation_type);
    if (!mapping) continue;
    const label = extractIdentityLabel(relation.summary);
    if (!label) continue;
    const key = `${mapping}:${normalizeNameKey(label)}`;
    const existing = arcMap.get(key);
    if (existing) {
      existing.relatedEntityIds.add(relation.target_entity_id);
      existing.evidenceRefs.push(...relation.evidence_refs);
      existing.confidenceValues.push(relation.confidence);
      existing.hasHistoricalSignal = existing.hasHistoricalSignal || /used to|formerly/i.test(relation.summary);
      mergeRange(existing, relation.first_seen_at, relation.last_seen_at);
      continue;
    }

    arcMap.set(key, {
      id: `identity:${crypto.randomUUID()}`,
      facet: mapping,
      label,
      summary: summarizeIdentityArc(mapping, relation.summary),
      relatedEntityIds: new Set([relation.target_entity_id]),
      evidenceRefs: [...relation.evidence_refs],
      confidenceValues: [relation.confidence],
      firstSeenAt: relation.first_seen_at,
      lastSeenAt: relation.last_seen_at,
      hasHistoricalSignal: /used to|formerly/i.test(relation.summary),
    });
  }

  return [...arcMap.values()]
    .map((item) => PersonaIdentityArcSchema.parse({
      id: item.id,
      facet: item.facet,
      label: item.label,
      summary: item.summary,
      confidence: average(item.confidenceValues),
      trajectory: resolveIdentityTrajectory(item),
      related_entity_ids: [...item.relatedEntityIds],
      first_seen_at: item.firstSeenAt,
      last_seen_at: item.lastSeenAt,
      evidence_refs: dedupeEvidenceRefs(item.evidenceRefs),
    }))
    .sort((a, b) => b.confidence - a.confidence || b.evidence_refs.length - a.evidence_refs.length)
    .slice(0, limit);
}

function finalizeEntities(
  entityMap: Map<string, EntityAccumulator>,
  limit: number,
  relations: PersonaWebRelation[],
  contextFrames: PersonaWebContextFrame[],
  identityArcs: PersonaIdentityArc[],
): PersonaWebEntity[] {
  const relationBoost = new Map<string, number>();
  for (const relation of relations) {
    relationBoost.set(relation.source_entity_id, (relationBoost.get(relation.source_entity_id) ?? 0) + 1.2);
    relationBoost.set(relation.target_entity_id, (relationBoost.get(relation.target_entity_id) ?? 0) + 1.5);
  }
  for (const frame of contextFrames) {
    for (const entityId of frame.participant_entity_ids) {
      relationBoost.set(entityId, (relationBoost.get(entityId) ?? 0) + 0.8);
    }
  }
  for (const arc of identityArcs) {
    for (const entityId of arc.related_entity_ids) {
      relationBoost.set(entityId, (relationBoost.get(entityId) ?? 0) + 1);
    }
  }

  return [...entityMap.values()]
    .map((item) => {
      const confidence = clamp01((average(item.confidenceValues) * 0.7) + (Math.min(1, item.salience / 6) * 0.3));
      const salience = clamp01(Math.min(1, (item.salience + (relationBoost.get(item.id) ?? 0)) / 8));
      return PersonaWebEntitySchema.parse({
        id: item.id,
        canonical_name: item.canonicalName,
        entity_type: item.entityType,
        aliases: [...item.aliases].filter((entry) => entry !== item.canonicalName),
        confidence,
        salience,
        first_seen_at: item.firstSeenAt,
        last_seen_at: item.lastSeenAt,
        evidence_refs: dedupeEvidenceRefs(item.evidenceRefs),
        metadata: item.metadata,
      });
    })
    .sort((a, b) => b.salience - a.salience || b.confidence - a.confidence)
    .slice(0, limit);
}

function inferTargetName(documents: RawDocument[], evidenceItems: EvidenceItem[]): string | null {
  const names = new Map<string, number>();
  for (const item of evidenceItems) {
    if (item.speaker_role !== 'target') continue;
    const key = cleanPhrase(item.speaker_name);
    if (!key) continue;
    names.set(key, (names.get(key) ?? 0) + 2);
  }
  for (const doc of documents) {
    const metadataRole = String((doc.metadata as Record<string, unknown> | undefined)?.speaker_role ?? '');
    if (metadataRole !== 'target' && doc.source_type !== 'article' && doc.source_type !== 'video') continue;
    const key = cleanPhrase(doc.author);
    if (!key) continue;
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  return [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function isTargetCentricEvidence(item: EvidenceItem, targetName: string): boolean {
  if (item.speaker_role === 'target') return true;
  return isTargetSpeaker(item.speaker_name, targetName);
}

function isTargetSpeaker(name: string, targetName: string): boolean {
  return normalizeNameKey(name) === normalizeNameKey(targetName);
}

function mentionsTarget(content: string, targetName: string): boolean {
  const key = normalizeNameKey(targetName);
  if (!key) return false;
  return normalizeNameKey(content).includes(key);
}

function extractDocumentEntities(content: string): string[] {
  const candidates = new Set<string>();
  const patterns = [
    /@[a-z0-9_.-]{2,32}/ig,
    /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g,
    /\b[A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,2}\b/g,
    /["'“”]([^"'“”]{2,40})["'“”]/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const raw = cleanPhrase(match[1] ?? match[0] ?? '');
      if (!raw || shouldIgnoreEntity(raw)) continue;
      candidates.add(raw);
    }
  }

  return [...candidates].slice(0, 12);
}

function buildDocumentReference(doc: RawDocument, confidence: number): EvidenceReference {
  return EvidenceReferenceSchema.parse({
    raw_document_id: doc.id,
    source_url: doc.source_url,
    speaker_name: doc.author,
    excerpt: doc.content.slice(0, 220),
    timestamp_start: doc.published_at ?? doc.fetched_at,
    timestamp_end: doc.published_at ?? doc.fetched_at,
    confidence,
  });
}

function buildEvidenceReference(item: EvidenceItem, confidence: number): EvidenceReference {
  return EvidenceReferenceSchema.parse({
    evidence_id: item.id,
    raw_document_id: item.raw_document_id,
    source_url: optionalString(item.metadata.source_url),
    speaker_name: item.speaker_name,
    speaker_role: item.speaker_role,
    excerpt: item.content.slice(0, 220),
    timestamp_start: item.timestamp_start,
    timestamp_end: item.timestamp_end ?? item.timestamp_start,
    confidence,
  });
}

function normalizeEvidenceItemForPersonaWeb(item: EvidenceItem): EvidenceItem | null {
  const parsed = EvidenceItemSchema.safeParse({
    ...item,
    timestamp_start: normalizeDatetimeLike(item.timestamp_start),
    timestamp_end: normalizeDatetimeLike(item.timestamp_end) ?? normalizeDatetimeLike(item.timestamp_start),
    context_before: (item.context_before ?? []).map((entry) => ({
      ...entry,
      timestamp: normalizeDatetimeLike(entry.timestamp),
    })),
    context_after: (item.context_after ?? []).map((entry) => ({
      ...entry,
      timestamp: normalizeDatetimeLike(entry.timestamp),
    })),
  });
  return parsed.success ? parsed.data : null;
}

function normalizeDatetimeLike(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return undefined;
    const date = new Date(raw.length === 10 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function inferDominantDomains(
  graph: PersonaWebGraph,
  topics: string[],
  contextHints: string[],
  relationshipHints: string[],
  identityHints: string[],
): string[] {
  const keywordMap: Array<{ label: string; patterns: RegExp[] }> = [
    { label: 'developer tools', patterns: [/\b(raycast|alfred|github|tool|tools|workflow|plugin|plugins|terminal|editor|markdown)\b/i, /(工具|插件|工作流|终端|编辑器|效率)/u] },
    { label: 'apple ecosystem', patterns: [/\b(apple|mac|macos|ios|swift|xcode|app store|apple music|airpods|vision pro)\b/i, /(苹果|mac|iOS|Swift|Xcode)/u] },
    { label: 'web development', patterns: [/\b(web|frontend|browser|html|css|javascript|typescript|node|react|astro)\b/i, /(前端|网页|浏览器|JavaScript|TypeScript|Node)/u] },
    { label: 'open source', patterns: [/\b(open source|oss|star|fork|repo|repository)\b/i, /(开源|仓库|Star|Fork)/u] },
    { label: 'ai', patterns: [/\b(ai|llm|gpt|claude|openai|gemini|chatgpt|model)\b/i, /(模型|大模型|AI|智能体)/u] },
    { label: 'systems programming', patterns: [/\b(rust|cargo|linux|shell|homebrew|docker|wasm|kubernetes)\b/i, /(Rust|系统|容器|Linux)/u] },
    { label: 'design', patterns: [/\b(figma|sketch|design|ui|ux|theme|mockup)\b/i, /(设计|界面|主题|配色)/u] },
    { label: 'startups', patterns: [/\b(startup|founder|fundraising|yc|investor)\b/i, /(创业|创始人|融资|投资)/u] },
    { label: 'markets', patterns: [/\b(stock|ticker|market|tesla|economy|trading)\b/i, /(股票|市场|交易|经济)/u] },
    { label: 'content publishing', patterns: [/\b(blog|newsletter|weekly|podcast|youtube|twitter)\b/i, /(博客|周刊|播客|公众号|推文|视频)/u] },
  ];

  const corpus = [
    ...topics,
    ...contextHints,
    ...relationshipHints,
    ...identityHints,
    ...graph.entities.slice(0, 64).map((item) => item.canonical_name),
    ...graph.relations.slice(0, 64).map((item) => item.summary),
  ].join('\n');

  const matched = keywordMap
    .map((entry) => ({
      label: entry.label,
      score: entry.patterns.reduce((count, pattern) => count + (pattern.test(corpus) ? 1 : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .map((entry) => entry.label);

  if (matched.length > 0) return matched.slice(0, 6);

  return dedupeStrings(
    topics
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length >= 3 && item.length <= 32)
  ).slice(0, 6);
}

function summarizeRelation(relationType: PersonaWebRelationType, phrase: string): string {
  switch (relationType) {
    case 'self_describes':
      return `Identity signal: ${phrase}`;
    case 'builds':
      return `Builds ${phrase}`;
    case 'works_on':
      return `Focuses on ${phrase}`;
    case 'uses':
      return `Uses ${phrase}`;
    case 'prefers':
      return `Prefers ${phrase}`;
    case 'collaborates_with':
      return `Collaborates with ${phrase}`;
    case 'learns_from':
      return `Learns from ${phrase}`;
    case 'teaches':
      return `Shares about ${phrase}`;
    case 'cares_about':
      return `Values ${phrase}`;
    case 'avoids':
      return `Avoids ${phrase}`;
    case 'belongs_to':
      return `Belongs to ${phrase}`;
    case 'influences':
      return `Influences ${phrase}`;
    case 'associated_with':
      return `Associated with ${phrase}`;
    default:
      return phrase;
  }
}

function mapRelationToIdentityFacet(relationType: PersonaWebRelationType): PersonaIdentityFacet | null {
  switch (relationType) {
    case 'self_describes':
      return 'role';
    case 'builds':
    case 'works_on':
    case 'teaches':
      return 'focus';
    case 'cares_about':
      return 'value';
    case 'prefers':
      return 'preference';
    case 'avoids':
      return 'boundary';
    case 'belongs_to':
    case 'collaborates_with':
    case 'learns_from':
      return 'relationship';
    default:
      return null;
  }
}

function summarizeIdentityArc(facet: PersonaIdentityFacet, relationSummary: string): string {
  return `${facet}: ${relationSummary}`;
}

function extractIdentityLabel(summary: string): string | null {
  return cleanPhrase(summary.replace(/^.+?:\s*/, ''));
}

function resolveIdentityTrajectory(item: IdentityArcAccumulator): 'emerging' | 'steady' | 'evolving' | 'episodic' | 'historical' {
  if (item.hasHistoricalSignal) return 'historical';
  const spanDays = diffDays(item.firstSeenAt, item.lastSeenAt);
  if (spanDays >= 120) return 'steady';
  if (spanDays >= 30) return 'evolving';
  if (item.evidenceRefs.length >= 3) return 'episodic';
  return 'emerging';
}

function summarizeContext(item: ContextAccumulator): string {
  const keywords = topKeywords(item.snippets.join(' '), 4);
  const speakerSummary = [...item.speakerNames].slice(0, 3).join(', ');
  const keywordSummary = keywords.length > 0 ? ` around ${keywords.join(', ')}` : '';
  return `${item.scene} context with ${speakerSummary}${keywordSummary}`.trim();
}

function summarizeGraph(graph: PersonaWebGraph): string {
  const topRelations = graph.relations.slice(0, 3).map((item) => item.summary);
  const topArcs = graph.identity_arcs.slice(0, 2).map((item) => item.summary);
  const fragments = dedupeStrings([...topRelations, ...topArcs]).slice(0, 4);
  if (fragments.length === 0) {
    return `Persona web built from ${graph.stats.document_count} documents and ${graph.stats.evidence_count} evidence items.`;
  }
  return fragments.join(' | ');
}

function buildGuardrailNotes(
  graph: PersonaWebGraph,
  provenanceReport: Pick<PersonaWebProvenanceReport, 'coverage_score' | 'low_confidence_entity_count' | 'low_confidence_relation_count'>
): string[] {
  const notes = [
    'Only promote named relationships when both entities and relation wording appear in evidence.',
    'Treat unsupported private-life claims as blocked unless a matching context frame exists.',
  ];
  if (provenanceReport.coverage_score < 0.45) {
    notes.push('Coverage is still thin; default to conservative memory writes for new named claims.');
  }
  if (provenanceReport.low_confidence_relation_count > 0) {
    notes.push('Low-confidence relations exist; require repeated evidence before turning them into stable memories.');
  }
  if (graph.identity_arcs.length === 0) {
    notes.push('Identity arcs are sparse; avoid over-claiming long-term preferences or values.');
  }
  return dedupeStrings(notes).slice(0, 6);
}

function sanitizeRelationObject(value: string): string | null {
  const trimmed = cleanPhrase(
    value
      .replace(/\b(?:because|which|that|who|when|where|while|but|and then|so that)\b.*$/i, '')
      .replace(/^my\s+/i, '')
      .replace(/^(?:the|a|an)\s+/i, '')
  );
  if (!trimmed || shouldIgnoreEntity(trimmed)) return null;
  if (trimmed.split(/\s+/).length > 6) return trimmed.split(/\s+/).slice(0, 6).join(' ');
  return trimmed;
}

function cleanPhrase(value: string): string | null {
  const cleaned = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^[\s'"`]+|[\s'"`,.:;!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 1 ? cleaned : null;
}

function shouldIgnoreEntity(value: string): boolean {
  const normalized = normalizeNameKey(value);
  if (!normalized) return true;
  if (normalized.length <= 2) return true;
  if (/^(i|me|my|you|we|they|this|that|these|those|something|anything)$/.test(normalized)) return true;
  if (/^(today|tomorrow|yesterday|morning|evening|night|people|person|thing)$/.test(normalized)) return true;
  return false;
}

function guessEntityType(value: string): PersonaWebEntityType {
  const lower = value.toLowerCase();
  if (value.startsWith('@')) return 'person';
  if (/(team|studio|lab|inc|corp|company|foundation|university)/i.test(value)) return 'organization';
  if (/(swift|xcode|typescript|node|tauri|kotlin|objective c|ios|macos|react)/i.test(lower)) return 'product';
  if (/(project|app|tool|sdk|library|framework)/i.test(lower)) return 'project';
  if (/(community|club|group)/i.test(lower)) return 'community';
  return value.includes(' ') ? 'topic' : 'unknown';
}

function computeRelationConfidence(item: EvidenceItem, relationType: PersonaWebRelationType): number {
  const stabilityBoost = item.stability_hints.cross_session_stable ? 0.08 : 0;
  const sceneBoost = item.scene === 'public' || item.scene === 'work' ? 0.04 : 0;
  const base = relationType === 'self_describes' || relationType === 'cares_about' ? 0.7 : 0.64;
  return clamp01(base + (item.target_confidence * 0.18) + stabilityBoost + sceneBoost);
}

function dedupeEvidenceRefs(refs: EvidenceReference[]): EvidenceReference[] {
  const map = new Map<string, EvidenceReference>();
  for (const ref of refs) {
    const key = [ref.evidence_id ?? '', ref.raw_document_id ?? '', ref.excerpt ?? ''].join(':');
    if (!map.has(key)) map.set(key, ref);
  }
  return [...map.values()].slice(0, 8);
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return clamp01(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function topKeywords(text: string, limit: number): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function normalizeNameKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function mergeRange(
  target: { firstSeenAt?: string; lastSeenAt?: string } | { startedAt?: string; endedAt?: string },
  nextStart?: string,
  nextEnd?: string,
): void {
  if ('firstSeenAt' in target) {
    const rangeTarget = target as { firstSeenAt?: string; lastSeenAt?: string };
    if (nextStart && (!rangeTarget.firstSeenAt || nextStart < rangeTarget.firstSeenAt)) rangeTarget.firstSeenAt = nextStart;
    const candidateEnd = nextEnd ?? nextStart;
    if (candidateEnd && (!rangeTarget.lastSeenAt || candidateEnd > rangeTarget.lastSeenAt)) rangeTarget.lastSeenAt = candidateEnd;
    return;
  }
  const contextTarget = target as { startedAt?: string; endedAt?: string };
  if (nextStart && (!contextTarget.startedAt || nextStart < contextTarget.startedAt)) contextTarget.startedAt = nextStart;
  const candidateEnd = nextEnd ?? nextStart;
  if (candidateEnd && (!contextTarget.endedAt || candidateEnd > contextTarget.endedAt)) contextTarget.endedAt = candidateEnd;
}

function diffDays(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const startTs = Date.parse(start);
  const endTs = Date.parse(end);
  if (Number.isNaN(startTs) || Number.isNaN(endTs)) return 0;
  return Math.max(0, Math.round((endTs - startTs) / 86_400_000));
}

function timeBucket(value?: string): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

const STOPWORDS = new Set([
  'about', 'after', 'before', 'because', 'being', 'could', 'every', 'from', 'have', 'just', 'like', 'much', 'really', 'should', 'some', 'that', 'their', 'there', 'these', 'thing', 'this', 'with', 'would', 'your', 'ours', 'ourselves', 'into', 'over', 'under', 'again', 'while', 'where', 'when', 'what', 'which', 'also', 'than', 'then', 'them', 'they', 'were', 'been', 'make', 'made', 'using', 'used', 'work', 'working', 'build', 'built', 'focus', 'value', 'prefer', 'avoid'
]);
