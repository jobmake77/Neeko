# 架构设计文档

## 总体架构

Neeko 采用三层架构：**输入层 → 炼化层 → 输出层**。

```
┌──────────────────────────────────────────────────────────────┐
│                         Neeko                                │
│                                                              │
│  ┌─────────────┐   ┌──────────────────┐   ┌──────────────┐  │
│  │  输入层      │ → │     炼化层        │ → │   输出层      │  │
│  │  Ingestion  │   │    Refinery      │   │   Export     │  │
│  └─────────────┘   └──────────────────┘   └──────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 模块详解

### 输入层 — `src/core/pipeline/`

#### Source Adapters

所有适配器继承 `BaseSourceAdapter`，输出统一的 `RawDocument` 格式：

```typescript
interface RawDocument {
  id: string               // UUID
  source_type: 'twitter' | 'article' | 'video' | 'wechat' | 'feishu' | 'custom'
  source_url?: string
  content: string          // 原始文本
  author: string
  published_at?: string    // ISO 8601
  metadata?: Record<string, unknown>
}
```

| 适配器 | 文件 | 数据来源 | 技术 |
|--------|------|---------|------|
| `TwitterAdapter` | `ingestion/twitter.ts` | Twitter/X 推文 | opencli（复用浏览器） |
| `ArticleAdapter` | `ingestion/article.ts` | 博客/网页 | opencli read / fetch fallback |
| `VideoAdapter` | `ingestion/video.ts` | 视频/音频 | OpenAI Whisper API |
| `ChatAdapter` | `ingestion/chat.ts` | 微信/飞书导出 | JSON / 纯文本解析 |

#### TwitterAdapter 策略

```
优先：opencli twitter search "from:handle" --limit N --format json
  ↓ 失败时
备用：opencli twitter timeline --type following（过滤目标用户）
```

opencli 通过拦截 Chrome 的网络请求获取数据，**无需 API Key**。

#### Data Cleaner

- 基于内容哈希去重（`simpleHash`）
- 过滤长度 < 20 字符的内容
- 输出归一化空白的文本

#### Semantic Chunker

- 按段落边界分块（`\n\n` 分隔）
- 超出 token 上限时滑动分块，保留末尾句子作重叠
- Token 估算：CJK 字符按 0.5 token 计算，其余按 0.25

---

### 炼化层 — `src/core/`

#### Soul 模型

Soul 是 Persona 的核心数据结构，以 YAML 持久化，运行时渲染为 System Prompt。

**五个维度：**

```
language_style      语言风格
  ├── vocabulary_preferences   词汇偏好（带置信度）
  ├── sentence_patterns        句式模式
  ├── formality_level          正式度 0-1
  ├── avg_sentence_length      short/medium/long
  ├── frequent_phrases         高频短语
  └── languages_used           使用语言

values              价值观
  ├── core_beliefs             核心信念（带优先级和置信度）
  ├── priorities               价值排序
  └── known_stances            已知立场

thinking_patterns   思维模式
  ├── reasoning_style          推理风格
  ├── decision_frameworks      决策框架
  ├── cognitive_biases         认知偏差
  ├── first_principles_tendency 第一性原理倾向 0-1
  └── analogy_usage            类比使用频率

behavioral_traits   行为特征
  ├── social_patterns          社交模式
  ├── stress_responses         压力下反应
  ├── signature_behaviors      标志性行为
  ├── humor_style              幽默风格
  └── controversy_handling     争议处理方式

knowledge_domains   知识领域
  ├── expert                   专家级领域
  ├── familiar                 熟悉领域
  └── blind_spots              盲区
```

#### Soul 提炼流程

```
SemanticChunk[]
  → SoulExtractor（LLM 并行，每 chunk 提取结构化 JSON）
  → SoulAggregator（合并 + 频率统计 + 置信度过滤 ≥ 0.3）
  → Soul v1（写入 soul.yaml）
```

提炼使用 `claude-sonnet-4-6`，并发度 5（批量处理）。

置信度 < 0.5 的条目不进入 System Prompt，但保留在 soul.yaml 供后续强化。

#### Soul 渲染

`SoulRenderer` 使用 Nunjucks 模板将 Soul 结构渲染为自然语言 System Prompt：

```
Soul YAML → Nunjucks 模板 → System Prompt（约 800-1200 tokens）
```

#### Memory 系统

**存储：** Qdrant 向量数据库

**每个 MemoryNode 包含：**
```typescript
{
  id, persona_id,
  original_text,      // 原文
  summary,            // 摘要
  category,           // belief/value/fact/opinion/behavior/knowledge/preference/experience
  soul_dimension,     // 对应 Soul 的哪个维度
  source_chunk_id,    // 来源溯源
  confidence,         // 置信度 0-1
  reinforcement_count,// 培养循环强化次数
  semantic_tags,
  status,             // active | archived
  superseded_by,      // 被哪个节点替代
  relations,          // SUPPORTS/CONTRADICTS/TEMPORAL_FOLLOWS/ELABORATES
  time_reference,     // 时间标记
}
```

**混合检索评分：**
```
score = confidence
      + log(1 + reinforcement_count) × 0.1   // 强化加成
      × exp(-0.3 × age_years)                 // 时间衰减（半衰期约 2.3 年）
```

---

### 四个核心 Agent — `src/core/agents/`

#### PersonaAgent

- 模型：按 `activeProvider` 动态解析（Claude/OpenAI/Kimi/Gemini/DeepSeek）
- 每次对话触发 RAG 检索（top-8 相关记忆节点）
- 追加 Skill 上下文（distilled skill，top-2）
- 支持 `/skill <name>` 手动触发，优先级高于自动触发

#### TrainerAgent

- 模型：按 `activeProvider` 动态解析
- 每轮基于 `TrainingPolicy` 生成问题，覆盖 4 种策略：
  - `blind_spot`：探测知识盲区
  - `stress_test`：压力测试一致性
  - `consistency`：验证已知立场
  - `scenario`：专业情境扩展
- 默认课程顺序：`consistency -> scenario -> stress_test -> blind_spot`

#### EvaluatorAgent

- 模型：按 `activeProvider` 动态解析
- **不接触 Soul 内容**，纯从用户视角评分
- 输出四个分数：consistency / authenticity / depth / overall
- 裁定：`write | reinforce | discard | flag_contradiction`
- 支持 `EvaluationRubric + CalibrationSet` 标尺校准
- 支持双评审（仅在评分分歧超过阈值时触发融合）

#### DirectorAgent

- 模型：按 `activeProvider` 动态解析
- 每轮结束后综合评估
- 决定是否继续训练
- 输出 coverage_score、soul_updates 与可观测指标摘要

---

### 培养循环 — `src/core/training/`

**状态机（v2）：**

```
IDLE
  → GENERATING_QUESTIONS（TrainingPolicy + Trainer 课程化出题）
  → RUNNING_CONVERSATION（Persona 回答）
  → EVALUATING（Evaluator 标尺校准 + 可选双评审）
  → UPDATING_MEMORY（MemoryGovernance：写入/强化/丢弃/冲突隔离）
  → DIRECTOR_REVIEW（Director 综合评估）
  → OBSERVABILITY_AGGREGATION（评分分布/覆盖率/矛盾率/重复率）
  → CONVERGENCE_CHECK
      ├── 未收敛 → 回到 GENERATING_QUESTIONS
      └── 收敛 → DONE
```

**收敛条件（全部满足）：**

1. 连续 3 轮新写入节点数 < 3
2. `soul.overall_confidence` > 0.80
3. `soul.coverage_score` > 0.85
4. `contradiction_rate` < 0.15
5. 最近 3 轮 `new_high_value_memories` 平均值趋稳（默认 <= 1.5）
6. 安全上限：最多 20 轮

**可观测指标（每轮）**

- 评分分布：`min / p50 / p90 / max`
- 低置信维度覆盖率：`low_confidence_coverage`
- 风险指标：`contradiction_rate`、`duplication_rate`
- 记忆质量：`new_high_value_memories`、`quarantined_memories`
- 记忆增长：`memory_growth_by_type`
- Skill 指标：`skill_trigger_precision`、`skill_method_adherence`、`skill_boundary_violation_rate`、`skill_transfer_success_rate`

---

### Skill 库（v2）

`skills.json` 升级为 v2，关键字段：
- `origin_skills`：中间态原点（可追溯）
- `distilled_skills`：最终可用 skill（动态 3-6）
- `candidate_skill_pool`：未达标候选

Skill 质量门控（入库需同时满足）：
- `evidence_count >= 4`
- `source_diversity >= 2`
- `confidence >= 0.65`
- `contradiction_risk <= 0.15`
- `method_completeness >= 0.7`

---

## Web UI — `web/`

基于 Next.js 15 App Router + shadcn/ui + Tailwind CSS。

```
web/app/
  page.tsx              Persona 卡片列表（Server Component，读 ~/.neeko/personas/）
  create/page.tsx       新建向导（3步，Client Component）
  chat/[slug]/page.tsx  对话页（流式输出，Soul 侧边栏）
  training/page.tsx     培养中心（报告看板 + 轮次趋势 + 实验历史）
  export/page.tsx       导出页
  settings/page.tsx     API Key 配置
  api/
    personas/route.ts          GET：列出所有 Persona
    personas/[slug]/route.ts   GET：单个 Persona + Soul 详情
    training/route.ts          GET：训练报告列表
    training/[slug]/route.ts   GET：单个 Persona 训练轮次报告
    experiments/[slug]/route.ts GET：实验历史报告列表
```

### 设计规范

- 背景色：`oklch(0.96 0.002 90)`（暖灰）
- 卡片：白色 + 圆角 16px
- 强调色：`oklch(0.72 0.18 142)`（绿色）
- 字体：系统字体栈，中文优先 PingFang SC

---

## 数据持久化

```
~/.neeko/
  personas/
    {slug}/
      persona.json    Persona 元数据
      soul.yaml       Soul 结构化数据
      runtime-task.json      任务状态
      runtime-progress.json  实时进度
      training-context.json  断点续训上下文
      training-report.json   训练轮次报告（增量落盘）
```

Qdrant 集合命名规范：`nico_{slug}`

运行时锁：
```
~/.neeko/runtime/locks/
  train-{slug}.lock
```

锁记录字段：
- `owner_id`
- `pid`
- `fencing_token`
- `job_id`
- `acquired_at`
- `last_heartbeat_at`
- `expires_at`

### 锁与恢复策略

1. 同一 persona 训练任务串行执行（单实例）
2. 使用租约锁（Lease Lock）而非纯 PID 锁
3. Worker 定时心跳续租；续租失败会主动终止，避免双写
4. 锁过期或持有进程失活时允许抢占（token 递增）
5. 训练中按轮次 checkpoint 落盘；中断后从 `training-context.json` 续训

---

## 成本控制策略

| 场景 | 模型 | 原因 |
|------|------|------|
| Soul 提炼 | claude-sonnet-4-6 | 结构化提取，精度关键 |
| Evaluator | claude-sonnet-4-6 | 质量裁判，需要准确判断 |
| Director | claude-sonnet-4-6 | 全局决策 |
| Trainer 出题 | claude-haiku-4-5 | 批量生成，成本敏感 |
| Persona 对话 | claude-haiku-4-5 | 高频调用，成本敏感 |
| Embedding | text-embedding-3-small | 最高性价比 |
| 推文采集 | opencli（免费） | 复用浏览器，零 API 费用 |
