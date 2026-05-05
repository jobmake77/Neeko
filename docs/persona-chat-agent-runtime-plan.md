# Persona Chat Agent Runtime Plan

Updated: 2026-05-05
Owner: Main agent
Audience: Service agent, Desktop agent, QA agent, future runtime implementers

## 1. 背景与目标

Neeko 当前已经有桌面端聊天、Persona 资产、本地 `workbench-server`、会话日志、会话摘要和候选写回链路。下一阶段的问题不是再做一个新的聊天 UI，而是把聊天背后的 Agent 编排整理成可测试、可追踪、可恢复、可长期演进的内部 runtime。

本计划定义一个轻量自研的 `PersonaChatAgent Runtime`。它借鉴成熟 Agent 工程实践，但不把 LangGraph、Letta、Mastra、AutoGen 作为 production dependency。

借鉴原则：

- LangGraph：借鉴 state、checkpoint、replay 的工程边界。
- MemGPT / Letta：借鉴 context engineering 和长期状态分层。
- ReAct：借鉴有限的 reasoning/action loop，不实现无限自主循环。
- AutoGen：借鉴 conversable participant 抽象，但不把多 Agent 概念暴露到客户端。
- Open WebUI / Mastra：借鉴 tool/skill registry、权限边界和可观测性。

目标架构：

```text
Desktop Client
  -> WorkbenchService.sendMessage
  -> PersonaChatAgent Runtime
      -> ContextAssembler
      -> SkillRegistry
      -> BoundedAgentLoop
      -> Persistence
      -> Trace / Replay
```

非目标：

- 不新增用户可见一级入口。
- 不把 runtime trace、skill execution、内部治理对象暴露到极简客户端 UI。
- 不允许聊天流程直接写正式 Persona、Soul、正式长期记忆或训练资产。
- 不为了引入框架而改写现有 `workbench-server` API。

## 2. 当前实现基线

当前服务端聊天主入口在 `src/core/workbench/service.ts`。

已具备能力：

- `createConversation()` 创建本地 conversation。
- `sendMessage()` 完成用户消息落库、附件处理、调用回复生成、生成 assistant message、写入 memory candidates、更新 session summary。
- `generateReply()` 负责调用 Persona 回复和附加 grounding / orchestration 逻辑。
- `buildMemoryCandidates()` 与 `buildSessionSummary()` 已建立保守写回路径。

当前 Persona 回复能力在 `src/core/agents/index.ts`。

已具备能力：

- `PersonaAgent.respondWithMeta()` 支持 Soul 渲染、MemoryRetriever 检索、skill trigger selection、模型 fallback 和 meta 返回。
- `selectTriggeredSkillsForQuery()` 当前更接近“触发上下文选择”，还不是严格 schema tool-call runtime。

当前本地持久化在 `src/core/workbench/store.ts`。

已具备能力：

- conversations
- messages
- memory candidates
- session summary
- promotion handoffs
- training prep artifacts
- runs

当前类型定义在 `src/core/models/workbench.ts`。

已具备能力：

- `Conversation`
- `ConversationMessage`
- `ConversationOrchestration`
- `SessionSummary`
- `MemoryCandidate`
- `WorkbenchRun`

结论：

当前系统已经能完成端到端聊天，但编排逻辑集中在 `WorkbenchService.sendMessage()` 及其周边 helper 中。下一步应优先拆出 runtime stage，而不是重写模型调用、桌面 API 或 Persona 资产结构。

## 3. PersonaChatAgent Runtime 目标架构

Runtime 的职责是把一轮聊天变成显式、可追踪的内部流程。

```text
ChatAgentRuntimeInput
  -> ContextAssembler
  -> SkillRegistry
  -> BoundedAgentLoop
  -> Persistence
  -> ChatAgentRuntimeResult
```

### 3.1 ContextAssembler

职责：

- 加载 conversation、persona、soul、history、session summary。
- 处理当前用户消息和附件的上下文输入。
- 调用或复用现有 MemoryRetriever，准备 relevant persona materials。
- 选择本轮可暴露给模型的 skill context。
- 组装 safety policy 和 prompt components。

约束：

- 不调用 LLM。
- 不写文件。
- 不改变 API response shape。
- 输出确定性上下文对象，便于单元测试。

### 3.2 SkillRegistry

职责：

- 封装现有 `loadSkillLibrary()` 和 `selectTriggeredSkillsForQuery()`。
- 给每个 skill 明确 id、展示名、描述、权限和启用状态。
- 只把本轮相关的少量 read/context skill 暴露给模型。

V1 约束：

- 只允许 read/context skill 自动进入 prompt。
- `write`、`network`、`filesystem`、`dangerous` skill 只预留类型，不自动执行。
- 不在桌面 UI 暴露 skill registry。

### 3.3 BoundedAgentLoop

职责：

- 把当前 `generateReply()` / `PersonaAgent.respondWithMeta()` 包进显式 runtime loop。
- 记录每一步 runtime stage。
- 未来支持有限 tool call，但 V1 可以先只有 `prepare -> call_model -> persist`。

约束：

- 默认最多 0-2 个 tool/skill step。
- 不实现无限 autonomous loop。
- 模型失败时复用当前 fallback 策略。
- 不改变现有 conversation API。

### 3.4 Persistence

职责：

- 写入 conversation log。
- 写入 session summary。
- 写入 memory candidates。
- 写入 trace metadata。

约束：

- 聊天 runtime 不直接写正式 Persona/Soul。
- 聊天 runtime 不直接写正式长期记忆。
- 聊天 runtime 不直接生成或启动训练资产。
- candidates 仍走 accepted / rejected / promotion-ready / handoff 的治理链路。

### 3.5 Trace / Replay

职责：

- 每轮聊天记录关键 stage、模型、上下文摘要、skill 选择、候选生成、错误信息。
- 支持工程诊断和回归测试。
- 不进入当前极简客户端 UI。

建议路径：

```text
workbench/conversations/<conversation_id>/agent-traces/<trace_id>.json
```

## 4. 核心模块设计

### 4.1 Runtime input / result

```ts
export interface ChatAgentRuntimeInput {
  conversationId: string;
  userMessage: string;
  attachments: AttachmentRef[];
  modelOverride?: ChatModelOverride;
  now?: string;
}

export interface ChatAgentRuntimeResult {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  memoryCandidates: MemoryCandidate[];
  sessionSummary: SessionSummary;
  trace: ChatAgentTrace;
}
```

### 4.2 Context

```ts
export interface ChatAgentContext {
  conversation: Conversation;
  personaSlug: string;
  personaName: string;
  history: ConversationMessage[];
  sessionSummary: SessionSummary | null;
  processedAttachments: AttachmentRef[];
  systemInstructions: string;
  personaContext: string;
  historyContext: Array<{ role: 'user' | 'assistant'; content: string }>;
  retrievedMaterials: CitationItem[];
  availableSkills: SkillSelection[];
  safetyPolicy: ChatAgentSafetyPolicy;
}

export interface ChatAgentSafetyPolicy {
  writeTargets: Array<'conversation_log' | 'session_summary' | 'memory_candidates' | 'trace'>;
  forbiddenTargets: Array<'formal_persona' | 'formal_soul' | 'formal_memory' | 'training_asset'>;
  maxToolSteps: number;
}
```

### 4.3 Skill definitions

```ts
export type SkillPermission =
  | 'read'
  | 'write'
  | 'network'
  | 'filesystem'
  | 'dangerous';

export interface SkillDefinition {
  id: string;
  displayName: string;
  description: string;
  inputSchema?: unknown;
  permission: SkillPermission;
  enabled: boolean;
}

export interface SkillSelection {
  skill: SkillDefinition;
  confidence?: number;
  reason?: string;
}
```

### 4.4 Trace

```ts
export type ChatAgentTraceStatus = 'running' | 'completed' | 'failed';

export type ChatAgentTraceEventType =
  | 'context_assembled'
  | 'memory_retrieved'
  | 'skill_selected'
  | 'llm_called'
  | 'reply_finalized'
  | 'candidate_generated'
  | 'summary_updated'
  | 'failed';

export interface ChatAgentTraceEvent {
  id: string;
  type: ChatAgentTraceEventType;
  at: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface ChatAgentTrace {
  id: string;
  conversation_id: string;
  persona_slug: string;
  user_message_id: string;
  assistant_message_id?: string;
  started_at: string;
  finished_at?: string;
  model?: {
    provider?: string;
    model?: string;
  };
  stages: ChatAgentTraceEvent[];
  status: ChatAgentTraceStatus;
  error?: string;
}
```

### 4.5 API compatibility

V1 不新增桌面端必需接口。

可选内部扩展：

- `ConversationMessage.orchestration.agent_trace_id?: string`
- `GET /api/conversations/:id/agent-traces` 可作为后续工程调试接口，不在当前客户端 UI 暴露。

## 5. 数据对象与接口草案

建议在 `src/core/models/workbench.ts` 增加 Zod schema：

- `SkillDefinitionSchema`
- `SkillSelectionSchema`
- `ChatAgentTraceEventSchema`
- `ChatAgentTraceSchema`

建议在 `src/core/workbench/store.ts` 增加本地持久化方法：

```ts
saveChatAgentTrace(trace: ChatAgentTrace): ChatAgentTrace
getChatAgentTrace(conversationId: string, traceId: string): ChatAgentTrace | null
listChatAgentTraces(conversationId: string): ChatAgentTrace[]
```

建议新增 runtime 文件：

```text
src/core/workbench/chat-agent-runtime.ts
```

建议导出：

```ts
export class PersonaChatAgentRuntime {
  run(input: ChatAgentRuntimeInput): Promise<ChatAgentRuntimeResult>;
}

export class ContextAssembler {
  assemble(input: ChatAgentRuntimeInput): Promise<ChatAgentContext>;
}

export class SkillRegistry {
  selectForTurn(input: {
    userMessage: string;
    personaSlug: string;
    maxSkills?: number;
  }): SkillSelection[];
}
```

第一阶段实现时，`PersonaChatAgentRuntime.run()` 可以仍然委托现有 `PersonaAgent.respondWithMeta()`。重点是建立边界、类型和 trace，而不是一次性改变回复质量。

## 6. 阶段开发计划

### Phase 0: 文档落地

目标：

- 新增本文档。
- 明确当前实现基线、目标架构、阶段计划和测试策略。
- 不改运行时代码。

验收：

- 文档存在于 `docs/persona-chat-agent-runtime-plan.md`。
- 文档没有要求引入外部 Agent 框架硬依赖。
- 文档延续当前写回治理边界。

### Phase 1: Runtime 骨架

目标：

- 新增 `src/core/workbench/chat-agent-runtime.ts`。
- 抽出 `ContextAssembler`。
- 让 `WorkbenchService.sendMessage()` 开始调用 runtime，但保持 API response shape 不变。

实现策略：

- 先把 `sendMessage()` 中的确定性准备逻辑迁移到 `ContextAssembler`。
- 保留现有 `generateReply()` 和 `buildMemoryCandidates()`。
- 不改变桌面端 `desktop/src/stores/chat.ts`。

测试：

- context assembly 包含 persona、history、summary、attachments、model override。
- 无 conversation 时仍报现有错误。
- 无 ready persona 或缺资产时保留现有行为。

### Phase 2: Trace / Replay

状态：Phase 2 trace 基线已落地；当前增量增加最小 replay / diagnostic 派生层。

目标：

- 新增 trace schema 和 store 方法。
- 每轮聊天写入 trace。
- trace 能记录成功和失败路径。
- 从 `ChatAgentTrace` 安全派生 replay timeline，供工程诊断和回归测试使用。

实现策略：

- `sendMessage()` 或 runtime 开始时创建 `running` trace。
- 每个 stage append trace event。
- 成功时标记 `completed`。
- 失败时标记 `failed` 并记录安全错误摘要。

测试：

- 成功聊天产生 completed trace。
- 模型 fallback 记录 llm stage。
- 附件处理失败或候选生成跳过时 trace 可读。
- trace 不改变 conversation bundle 的既有字段要求。
- replay 输出 stage timeline、status、duration、model、persona_slug、conversation_id 和失败摘要，不包含完整 user / assistant message content。

### Phase 3: SkillRegistry V1

目标：

- 封装现有 skill library 选择逻辑。
- 建立最小 skill permission 模型。

实现策略：

- read/context skill 可进入 prompt。
- write/network/filesystem/dangerous skill 不自动执行。
- 每轮最多选择 3-8 个 skill context，默认 2 个，与现有行为兼容。

测试：

- disabled skill 不被选择。
- 高权限 skill 不自动进入可执行集合。
- prompt 注入只包含筛选后的 skill context。

### Phase 4: BoundedAgentLoop V1

目标：

- 把回复流程改成显式 loop。
- V1 默认仍只有 prepare、call model、persist。

实现策略：

- `BoundedAgentLoop` 接收 `ChatAgentContext`。
- 调用现有 `PersonaAgent.respondWithMeta()`。
- 产生 `reply_finalized`、`candidate_generated`、`summary_updated` trace events。
- 预留未来 tool-call step，但不实现自动写入类 tool。

测试：

- 普通聊天在 1 个 model step 内完成。
- maxToolSteps 默认不超过 2。
- provider failure 保持现有 fallback 语义。

### Phase 5: Golden Chat Regression

目标：

- 建立最小聊天回归集，保护后续 runtime 重构。

测试样例：

- Persona 风格稳定性。
- 资料检索是否进入上下文。
- 附件摘要是否参与回复。
- 无可用模型时 fallback 行为。
- clarifying/refusal 模式不生成 candidates。
- 聊天不会直接写正式 Persona/Soul。

约束：

- golden chat 测试使用 mock model/provider。
- 不依赖真实 API key。
- 不写 repo 外不可控资源。

## 7. 测试与验收

文档阶段：

- 检查本文档存在且结构完整。
- 检查文档没有要求新增生产框架依赖。
- 检查文档与 `docs/client-conversation-v1-plan.md`、`docs/client-minimal-v2-implementation-note.md` 的治理边界一致。

Runtime 阶段：

- 运行现有 workbench regression 测试。
- 增加 context assembly 单元测试。
- 增加 trace persistence 单元测试。
- 增加 skill registry 权限过滤测试。
- 增加 `WorkbenchService.sendMessage()` 回归测试。

产品约束验收：

- 桌面端 API response shape 不变。
- 极简客户端 UI 不新增内部 runtime 入口。
- 用户可见文案不暴露内部治理术语。
- 聊天写目标仍限制在 conversation log、session summary、memory candidates、trace。

工程验收：

- runtime stage 可以单独测试。
- trace 可以定位一次回复使用了哪些上下文和 skill。
- runtime failure 不破坏已落库 conversation。
- 不引入新的全局 mutable state。

## 8. 风险与约束

### 风险 1: 把 runtime 重构做成框架迁移

控制：

- 不引入 LangGraph、Letta、Mastra、AutoGen 作为 production dependency。
- Phase 1 只抽 ContextAssembler，不改模型调用策略。

### 风险 2: Agent 自动写入污染 Persona

控制：

- `ChatAgentSafetyPolicy` 明确 forbidden targets。
- write/network/filesystem/dangerous skill 默认不自动执行。
- memory candidates 继续走 review 和 promotion-ready 链路。

### 风险 3: Trace 泄漏敏感内容到 UI

控制：

- trace 只写本地工程诊断文件。
- 当前极简客户端不展示 trace。
- 未来若加诊断入口，必须做脱敏和显式开关。

### 风险 4: 单次重构影响现有聊天稳定性

控制：

- 分阶段迁移。
- 每阶段保持 API response shape。
- 先加测试，再移动逻辑。

### 风险 5: Skill registry 变成无限能力入口

控制：

- V1 只做 read/context skill。
- 高权限 skill 只预留类型。
- 每轮聊天限制 skill 暴露数量。

## 9. 默认决策

- Runtime 名称：`PersonaChatAgentRuntime`。
- 第一实现入口：`WorkbenchService.sendMessage()`。
- 第一新增 runtime 文件：`src/core/workbench/chat-agent-runtime.ts`。
- 第一新增 trace 路径：`workbench/conversations/<conversation_id>/agent-traces/<trace_id>.json`。
- 第一阶段不改桌面端 API。
- 第一阶段不改桌面端 UI。
- 第一阶段不引入生产框架依赖。
- 第一阶段不允许聊天直接写正式 Persona/Soul/Memory。
