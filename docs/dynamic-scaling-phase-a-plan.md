# Dynamic Scaling Phase A 实施方案

更新时间：2026-04-05

关联文档：

- [Dynamic Evidence Scaling Framework](/Users/a77/Desktop/Neeko/docs/dynamic-evidence-scaling-framework.md)
- [Neeko 系统 V1 正式定义](/Users/a77/Desktop/Neeko/docs/system-v1.md)
- [大语料扩展优化路线图](/Users/a77/Desktop/Neeko/docs/large-corpus-roadmap.md)

## 1. 文档目标

本方案用于把 `Dynamic Evidence Scaling Framework` 拆成第一批可开发、可灰度、可验证的工程任务。

Phase A 不直接改训练核心，而是先完成三件事：

1. 定义 `EvidencePack` 标准层
2. 定义动态状态指标的可计算口径
3. 定义第一版 `budget-based shard builder`

本阶段的目标不是一次到位，而是让后续所有代码实现围绕同一组标准对象和指标推进。

## 2. Phase A 边界

### 2.1 本阶段必须完成

1. `EvidencePack` schema
2. `PackBuildStats / PackSummary` schema
3. 动态指标计算函数
4. 第一版预算驱动 shard 规划器
5. 新增中间资产落盘
6. 兼容当前 `CorpusSnapshot / ShardPlan / GlobalMerge`

### 2.2 本阶段不做

1. 不改 `TrainingLoop`
2. 不改四类训练 agent
3. 不上复杂 semantic clustering provider 调用
4. 不做多目标培养
5. 不做视频视觉理解
6. 不把动态机制直接变成默认路径

## 3. 新增对象设计

## 3.1 `EvidencePack`

建议新增文件：

- `src/core/models/evidence-pack.ts`

建议 schema：

```ts
EvidencePack {
  id: string
  persona_slug?: string
  source_type: 'twitter' | 'wechat' | 'feishu' | 'article' | 'video' | 'custom'
  modality: 'text' | 'chat' | 'transcript' | 'mixed'
  scene_profile: 'public' | 'work' | 'private' | 'mixed' | 'unknown'
  time_window: {
    started_at?: string
    ended_at?: string
    days_span?: number
  }
  item_ids: string[]
  raw_document_ids: string[]
  conversation_ids: string[]
  session_ids: string[]
  primary_speaker_role: 'target' | 'self' | 'other' | 'unknown' | 'mixed'
  topic_signature: string[]
  stats: {
    item_count: number
    raw_doc_count: number
    total_chars: number
    estimated_tokens: number
    avg_item_chars: number
    target_ratio: number
    cross_session_stable_ratio: number
  }
  scores: {
    quality: number
    novelty: number
    stability: number
    risk: number
    target_relevance: number
    duplication_pressure: number
    value: number
  }
  routing_projection: {
    soul_candidate_items: number
    memory_candidate_items: number
    discard_candidate_items: number
  }
  metadata: Record<string, unknown>
}
```

### 3.2 设计意图

`EvidencePack` 的作用是把“大量零散证据”压成“可调度、可观测、可增量刷新”的中间单元。

它不是：

1. 单条证据
2. 最终 shard
3. 最终训练 seed

它是介于 `EvidenceItem` 和 `Shard` 之间的调度层。

### 3.3 `PackBuildStats`

建议新增：

```ts
PackBuildStats {
  raw_item_count: number
  produced_pack_count: number
  avg_items_per_pack: number
  avg_tokens_per_pack: number
  mixed_source_pack_count: number
  high_risk_pack_count: number
  high_duplication_pack_count: number
  target_dominant_pack_count: number
}
```

### 3.4 `DynamicScalingMetrics`

建议新增一个统一状态指标对象：

```ts
DynamicScalingMetrics {
  stable_topic_growth: number
  marginal_coverage_gain: number
  duplication_pressure: number
  conflict_pressure: number
  runtime_pressure: number
  seed_maturity: number
}
```

## 4. 指标定义口径

这里不要求一步做到“完美算法”，但要求定义稳定、可重复、可比较的 V1 口径。

### 4.1 `quality`

用于衡量 pack 的基本可信度与清晰度。

第一版建议来自以下因子：

1. item 平均长度
2. target ratio
3. cross-session stable ratio
4. scene 权重
5. 被 routing 判断为 soul/memory 的占比

建议：

- `public/work` 加分
- `private` 中性或轻降
- `intimate/conflict` 降权

### 4.2 `novelty`

用于衡量 pack 与已有 pack / 已有 seeds 的差异度。

第一版建议不做 embedding 级语义距离，先使用：

1. `topic_signature` 与历史 pack topic 的 overlap
2. 高频关键词重复率
3. 同时期 pack 的相似度近似值

后续再升级到 semantic novelty。

### 4.3 `stability`

用于衡量该 pack 是否反映目标对象的长期稳定信号。

第一版建议来自：

1. target 发言比例
2. cross-session stable signals 占比
3. repeated topic presence
4. 非情绪性表达比例

### 4.4 `risk`

用于衡量 pack 是否可能污染 soul 主干。

第一版风险项建议包括：

1. `private`
2. `intimate`
3. `conflict`
4. `unknown speaker`
5. 纯事务性/短期协同性内容

### 4.5 `target_relevance`

用于衡量 pack 是否真的围绕目标对象，而不是围绕外部互动噪音。

第一版建议来自：

1. `speaker_role = target` 占比
2. 第一人称/目标归因程度
3. 非 target 上下文比例

### 4.6 `duplication_pressure`

用于衡量 pack 是否和已有内容高度重复。

第一版建议：

1. 关键词重叠率
2. 短语重叠率
3. 同 topic 高密出现

### 4.7 `value`

第一版不需要做复杂学习型权重，先采用可配置启发式组合：

`value = quality + novelty + stability + target_relevance - risk - duplication_pressure`

要求：

1. 权重可配置
2. 不写死在业务逻辑里
3. 可在实验模式中打印 score breakdown

## 5. Pack Builder 设计

建议新增模块：

- `src/core/pipeline/pack-builder.ts`

核心职责：

1. 从 `EvidenceItem[]` 构建 `EvidencePack[]`
2. 输出 pack summary 与 stats
3. 为后续 shard builder 提供标准输入

### 5.1 第一版组包原则

先不做复杂聚类，采用规则驱动组包。

组包维度顺序建议：

1. `source_type`
2. `scene band`
3. `time bucket`
4. `topic signature`
5. `speaker dominance`

### 5.2 `time bucket` 机制

不要写死为“固定 30 天”。

建议：

1. 先设一个基础窗口，例如 `14 ~ 45 天`
2. 再根据内容密度动态扩张或收缩
3. 对高密 stream 用更小窗口
4. 对低密长文可放宽窗口

### 5.3 `topic signature` 机制

第一版建议沿用当前 shard/global merge 中的轻量 topic 提取方式：

1. keyword
2. phrase
3. stopword filtering

但不要把它当最终 topic，只作为 pack 级相似性近似。

### 5.4 `speaker dominance` 机制

建议分成：

1. `target-dominant`
2. `mixed`
3. `context-heavy`

默认：

- `target-dominant` 更适合进入 high-value pack
- `context-heavy` 更适合作为 memory-oriented pack

## 6. Budget-Based Shard Builder 设计

建议新增模块：

- `src/core/pipeline/adaptive-shard-plan.ts`

### 6.1 输入

第一版输入建议为：

1. `EvidencePack[]`
2. shard budget config
3. runtime hints

### 6.2 输出

建议输出新对象：

```ts
AdaptiveShardPlan {
  schema_version: 1
  generated_at: string
  planner_version: string
  strategy: 'budget_based_v1'
  config: { ... }
  totals: { ... }
  shards: AdaptiveShardPlanItem[]
}
```

### 6.3 shard 形成规则

不是按 doc 数，而是按预算累计 pack。

建议预算维度：

1. `max_estimated_tokens`
2. `max_estimated_chunks`
3. `max_pack_count`
4. `max_topical_entropy`
5. `max_runtime_cost_hint`

### 6.4 shard 内排序

建议 pack 进入 shard 时优先级如下：

1. `value` 高
2. `target_relevance` 高
3. `duplication_pressure` 低
4. 主题一致性高

### 6.5 高密主题隔离

若某个 topic signature 在局部时间窗口中密度过高：

1. 单独形成 topic pack
2. 优先进入专门 shard
3. 避免挤压其他主题 pack

## 7. 与现有代码的兼容方式

### 7.1 不替换 `planCorpusShards`

第一版不直接删掉旧的：

- `planCorpusShards`

而是新增：

- `planAdaptiveShards`

灰度方式：

1. 默认仍走现有 `planCorpusShards`
2. 仅在显式开关开启时走 adaptive path

### 7.2 不替换 `RawDocument` 主路径

第一版建议：

1. `EvidenceItem -> EvidencePack`
2. `EvidencePack -> AdaptiveShardPlan`
3. 再映射回现有 shard distillation 入口

即：

- 新机制先接入输入调度层
- 不直接破坏 shard distillation 与 global merge 主链路

### 7.3 新旧资产并存

建议新增资产：

1. `evidence-packs.json`
2. `pack-stats.json`
3. `adaptive-shard-plan.json`

而不是直接覆盖：

1. `shard-plan.json`

这样便于：

1. 对照
2. 回退
3. 灰度验证

## 8. 观测与验收

### 8.1 新增观测

第一版至少新增：

1. pack 数
2. 平均 pack token
3. target-dominant pack 占比
4. high-risk pack 占比
5. duplicated pack 占比
6. shard pack 压缩率
7. shard topic entropy

### 8.2 第一阶段验收口径

本阶段不以“训练分数立刻提升”为唯一目标。

最低验收标准：

1. 不破坏现有 `legacy` 默认链路
2. pack 资产可解释
3. adaptive shard plan 可稳定生成
4. 在同一语料上，新旧 shard plan 可直接比较
5. adaptive path 不引入流程性故障

## 9. 推荐实施顺序

### Step 1

新增：

1. `evidence-pack.ts`
2. `dynamic-scaling-metrics.ts`

### Step 2

实现：

1. `pack-builder.ts`
2. `write/read evidence pack assets`

### Step 3

实现：

1. `adaptive-shard-plan.ts`
2. `write adaptive shard assets`

### Step 4

在实验链路接入对照：

1. `legacy shard plan`
2. `adaptive shard plan`

### Step 5

观察 pack/shard 指标，再决定是否推进到：

1. topic canonicalization
2. seed maturity
3. adaptive training mode

## 10. 当前结论

Phase A 的关键不是“做更复杂的算法”，而是先把动态机制的最小工程闭环搭起来。

这意味着：

1. 先有 `EvidencePack`
2. 先有动态指标
3. 先有预算驱动 shard builder
4. 先和现有主链路并行灰度

只要这一步完成，后面再往 semantic merge、adaptive training、增量更新扩展，成本就会明显降低。
