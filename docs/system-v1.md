# Neeko 系统 V1 正式定义

更新时间：2026-04-05

关联文档：

- [架构设计](/Users/a77/Desktop/Neeko/docs/architecture.md)
- [输入架构阶段总结](/Users/a77/Desktop/Neeko/docs/input-architecture-status.md)
- [大语料稳定蒸馏实施方案](/Users/a77/Desktop/Neeko/docs/large-corpus-implementation-plan.md)
- [大语料扩展优化路线图](/Users/a77/Desktop/Neeko/docs/large-corpus-roadmap.md)
- [Dynamic Evidence Scaling Framework](/Users/a77/Desktop/Neeko/docs/dynamic-evidence-scaling-framework.md)
- [账号分型与阶段分型路由框架](/Users/a77/Desktop/Neeko/docs/account-stage-routing-framework.md)

## 1. 文档目标

本文档将当前仓库内已经落地并经过真实实验验证的能力，正式定义为 `Neeko V1`。

这里的 `V1` 不是最终形态，而是当前已经具备工程闭环、可执行、可观察、可继续扩展的第一版正式系统。

V1 的核心定位是：

1. 以公开文本语料为主，完成目标人物的数字人格蒸馏
2. 支持从输入证据到 persona 训练的端到端流程
3. 为聊天、视频、多模态和更大规模语料预留统一输入底座
4. 在不破坏默认稳定链路的前提下，灰度推进 `v2` 输入路由

## 2. V1 系统定义

### 2.1 系统目标

V1 目标不是“喂一堆 prompt 模拟说话”，而是建立一条完整的培养链路：

`原始语料 -> 证据标准化 -> 输入路由 -> Soul 提炼 -> Memory 构建 -> 培养循环 -> Persona 输出`

V1 已经能够处理以下核心任务：

1. 从推文、文章、本地聊天记录、视频转写中获取目标人物证据
2. 将输入归一为可追踪、可评分、可解释的证据对象
3. 对输入做 `Soul / Memory / Discard` 分流
4. 生成结构化人格资产：
   - `persona.json`
   - `soul.yaml`
   - `training-report.json`
   - `skill library`
5. 运行多轮训练，并记录质量、覆盖率、冲突率、重复率和 fallback 情况
6. 在同一 persona 上对 `legacy` 与 `v2` 路由策略做实验对照

### 2.2 V1 的稳定主线

当前 V1 的默认稳定主线仍然是：

- 输入策略：`legacy`
- 训练档位：`full`
- 对照方式：`experiment`
- 大语料策略：`先分片蒸馏，再合并，再训练`

当前判断：

- `legacy` 是 V1 默认稳定链路
- `v2` 是 V1 中已接入、已验证有价值、但仍在继续优化的灰度链路
- 当前推荐灰度实验线收口为 `v2 + off`
- `v2 + topics` 与 `v2 + signals` 继续保留，但不作为当前默认推荐组合
- `dynamic scaling recommendation` 当前以 recommendation-only 方式接入，不自动改训练决策

## 3. V1 能力范围

### 3.1 已正式纳入 V1 的能力

#### A. 输入与证据层

支持输入类型：

1. Twitter/X 推文
2. 文章链接
3. 本地聊天文件
4. 本地视频/音频文件的 transcript 入口

支持的统一证据对象：

- `TargetManifest`
- `EvidenceItem`
- `EvidenceBatch`

支持的证据语义字段包括：

- `speaker_role`
- `speaker_name`
- `target_confidence`
- `scene`
- `conversation_id`
- `session_id`
- `window_role`
- `context_before/context_after`
- `evidence_kind`
- `stability_hints`

#### B. 输入路由

V1 已支持两套输入路由策略：

1. `legacy`
2. `v2`

其中：

- `legacy`：清洗后基本全部保留进入 soul 提炼
- `v2`：根据证据归因、稳定性、上下文清晰度、场景权重进行 `Soul / Memory / Discard` 分流

#### C. Soul 与 Skill 提炼

V1 已具备：

1. 语义切块
2. `SoulExtractor` 批量提炼
3. `SoulAggregator` 聚合
4. `Skill origin -> distilled skills` 的自动构建

Soul 的结构化维度包括：

1. `language_style`
2. `values`
3. `thinking_patterns`
4. `behavioral_traits`
5. `knowledge_domains`

#### D. 训练循环

V1 已具备完整培养闭环：

1. `TrainerAgent` 出题
2. `PersonaAgent` 回答
3. `EvaluatorAgent` 评估
4. `MemoryGovernance` 记忆治理
5. `DirectorAgent` 收敛控制

同时支持：

- 训练 profile：`baseline / a1 / a2 / a3 / a4 / full`
- provider runtime preset
- Kimi 稳定性治理模式
- 训练报告与 round 级 observability

#### E. 大语料底座

V1 已正式纳入大语料底座，但当前仍以“稳定 scaffold”定位：

1. `Corpus Snapshot`
2. `Shard Plan`
3. `Shard Distillation`
4. `Global Merge`
5. `Training Seed`

对应资产包括：

- `corpus-snapshot.json`
- `shard-plan.json`
- `input-run-manifest.json`
- `shards/<id>/raw-docs.json`
- `shards/<id>/shard-soul-summary.json`
- `shards/<id>/shard-memory-summary.json`
- `shards/<id>/shard-observability.json`
- `global-soul-seed.json`
- `global-memory-candidates.json`
- `global-conflicts.json`
- `training-seed.json`

### 3.2 V1 当前能力边界

以下能力已经能用，但还不应视为 V1 的完全成熟部分：

1. `v2` 在 `900+` 级别大语料、尤其 Kimi 环境下的稳定领先
2. 聊天记录的复杂 speaker attribution
3. 视频中的完整说话人分离与视觉事件理解
4. 多目标同时培养
5. `5000+ / 10000+` 级别语料的生产级稳定蒸馏
6. 基于 conflict lane 的自动复核、自动回放、自动晋升闭环

换句话说，V1 当前最成熟的是：

- 公开文本人格蒸馏
- 可观察的训练闭环
- 大语料分片蒸馏底座

补充边界更新：

- 当前已通过真实样本验证到 `1048` 条公开推文语料的轻量 experiment 层
- 当前已通过本地阶梯 recommendation 验证到 `4335` 条公开推文语料快照
- 在 `890 / 909 / 1048` 三组真实样本中，系统一致给出：
  - 当前灰度推荐：`v2 + off`
  - 当前动态扩容建议：`explore -> continue_expand`
- 在 `1126 / 1188 / 1227 / 1250 / 1350 / 1400 / 1500 / 1600 / 1800 / 2000 / 2406 / 3002 / 3501 / 4000 / 4335` 十五个本地扩容快照上，系统仍然保持 `explore -> continue_expand`
- 这说明 V1 现在已经具备 `1000+` 量级的 recommendation / observability 闭环
- 但还没有完成 `1000+` 量级的生产级稳定训练收敛验证

补充边界判断：

- V1 目前已经能识别“继续扩容”和“进入边际收益监控期”是两件不同的事
- 到 `4335` 为止，系统已稳定暴露 `stable_signal_growth_plateau / no_new_stable_signals`，但 `duplication_pressure` 与 `runtime_pressure` 仍未升到要求收敛的级别
- 因此 V1 当前更适合采用动态 recommendation 机制，而不是把固定文档阈值写成硬规则

补充工程结论：

- 当前 `1000+` 量级的主要瓶颈之一已经证明来自抓取层，而不只是训练层
- 本轮对抓取层的重复窗口判断与 fallback 降级做收紧后，live corpus 已从 `1188` 继续推进到 `4335`

补充边界判断：

- 当前突破 `2000` 之后，系统仍可继续从更早历史区间补语料，并已把 live corpus 回填到 `2015-01-07`
- 结合 `2014-10 -> 2015-01-03` 的 `opencli` 交叉探针仍为空，这意味着当前 provider 下的可达边界更接近账号公开历史本身，而不是固定数量上限

进一步观察：

- 当外推目标继续提高到 `4500` 时，系统最终把 live corpus 推到了 `4335`
- [karpathy-2406-validation 两轮 PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-2406-pk-aggregate.json) 显示：
  - `legacy + off` 两轮均值 `quality = 0.92`
  - `v2 + off` 两轮均值 `quality = 0.91`，但 `coverage = 0.55070` 明显高于 `legacy + off` 的 `0.53435`
  - `v2 + signals` 仍未证明稳定优于 `off`
- [karpathy-3002-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-3002-pk-aggregate.json) 显示：
  - `legacy + off`：2 次均值 `quality = 0.91`，`coverage = 0.5333`
  - `v2 + off`：4 次均值 `quality = 0.9075`，`coverage = 0.5506625`
  - `v2 + signals`：2 次均值 `quality = 0.90`，`coverage = 0.549875`
- [karpathy-4000-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-4000-pk-aggregate.json) 显示：
  - `v2 + off` 已在单轮干净运行中拿到 `quality = 0.94`，但该档位仍有一次 `legacy` provider 噪声 outlier，需要多轮解释
- [karpathy-4335-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-4335-pk-aggregate.json) 显示：
  - `legacy + off`：三轮均值 `quality = 0.9167`，`coverage = 0.5340`
  - `v2 + off`：三轮均值 `quality = 0.9233`，`coverage = 0.5347`
  - `v2 + signals`：三轮均值 `quality = 0.9033`，`coverage = 0.5326`
- [paulg-1296-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/paulg-1296-pk-aggregate.json) 显示：
  - `legacy + off`：三轮均值 `quality = 0.9033`，`coverage = 0.5326`
  - `v2 + off`：三轮均值 `quality = 0.8967`，`coverage = 0.5319`
  - `v2 + signals`：三轮均值 `quality = 0.9033`，`coverage = 0.5326`
- [paulg-1503-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/paulg-1503-pk-aggregate.json) 当前补充说明：
  - `legacy + off`：四轮 clean 均值 `0.888 / 0.548`
  - `v2 + off`：四轮 clean 均值 `0.895 / 0.541`
  - `v2 + signals`：四轮 clean 均值 `0.895 / 0.532`
  - `v2 + off` 第二轮出现过一次 `persona respond timeout after 36000ms` 污染后的异常值 `0.15 / 0.3135`，现已在 aggregate 层被正确隔离
- 这说明 V1 当前的真实瓶颈仍主要在抓取效率与大语料稳定性治理，而不是 recommendation 已经要求立即收敛；同时 `v2 + off` 在 `karpathy` 上有增强趋势，但在 `paulg` 上尚未稳定复现，因此现阶段更适合继续保留“安全默认 legacy、灰度观察 v2”的双轨结构
- 这也说明进入 `3000+` 规模后，runtime timeout 与 provider 噪声隔离已经成为需要显式治理的主风险之一，并且 timeout 治理已正式进入 [experiment.ts](/Users/a77/Desktop/Neeko/src/cli/commands/experiment.ts)

V1 当前正在扩展的是：

- 更强的证据层
- 更强的输入路由
- 更大规模语料的稳定训练

## 4. V1 端到端流程

本节定义 V1 的标准执行流程。

### 4.1 `create` 阶段

入口参考：

- [create.ts](/Users/a77/Desktop/Neeko/src/cli/commands/create.ts)

#### Step 1. 创建基础 persona 资产

系统首先创建：

- `persona.json`
- `soul.yaml`

并初始化 persona 状态。

#### Step 2. 获取原始语料

根据输入源选择 adapter：

1. `@handle` -> TwitterAdapter
2. URL -> ArticleAdapter
3. 本地聊天文件 -> chat ingestion
4. 本地视频/音频 -> VideoAdapter + transcript

#### Step 3. 进入 Evidence Layer

不同输入源统一转成 `EvidenceItem`：

- 推文/文章：`standalone`
- 聊天：`sessionized + target-centered window`
- 视频：`transcript segment evidence`

#### Step 4. 生成证据资产

系统会写出：

- `evidence-index.jsonl`
- `evidence-stats.json`
- `speaker-summary.json`
- `scene-summary.json`
- `target-manifest.json`（如适用）

#### Step 5. 转成兼容训练输入

`EvidenceItem` 会被转换为兼容当前培养链路的 `RawDocument-like` 输入，并缓存到：

- `raw-docs.json`

#### Step 6. 执行双路由预览

系统会同时计算：

1. `legacyPreview`
2. `v2Preview`

并得到：

- 分流统计
- 推荐 routing
- corpus shape 判断
- runtime preset 判断

#### Step 7. 生成大语料规划资产

系统基于 `raw-docs` 生成：

1. `Corpus Snapshot`
2. `Shard Plan`
3. `Input Run Manifest`

这一步的作用是冻结本次输入运行计划，避免中途策略漂移。

#### Step 8. 执行 shard distillation

每个 shard 内完成：

1. cleaner
2. chunker
3. routing
4. soul summary
5. memory summary
6. observability summary

#### Step 9. 执行 global merge

系统对所有 shard 进行全局规则合并，生成：

1. `global-soul-seed.json`
2. `global-memory-candidates.json`
3. `global-conflicts.json`
4. `training-seed.json`

#### Step 10. 提炼初始 soul

系统从选中的 soul chunks 中调用：

1. `SoulExtractor`
2. `SoulAggregator`

得到初始 soul 结构。

#### Step 11. 构建 skill library

系统自动从语料中构建：

1. `origin_skills`
2. `distilled_skills`

#### Step 12. 可选进入训练

如果显式指定训练轮数并且 Qdrant 可用，则进入 `TrainingLoop`。

### 4.2 `train` 阶段

入口参考：

- [train.ts](/Users/a77/Desktop/Neeko/src/cli/commands/train.ts)

`train` 的定位是“在既有 persona 资产上继续培养”，而不是重新抓取语料。

标准流程：

1. 读取 `persona.json`
2. 读取 `soul.yaml`
3. 读取 `raw-docs.json`
4. 刷新 corpus planning 资产
5. 刷新 shard distillation 资产
6. 刷新 global merge 资产
7. 加载 training seed hints
8. 解析训练策略与 runtime 策略
9. 进入 `TrainingLoop`

### 4.3 `experiment` 阶段

入口参考：

- [experiment.ts](/Users/a77/Desktop/Neeko/src/cli/commands/experiment.ts)

V1 的实验能力包含两类：

#### A. Profile Sweep

对比：

- `baseline`
- `a1`
- `a2`
- `a3`
- `a4`
- `full`

#### B. Input Routing Comparison

对比：

- `legacy + off`
- `v2 + off`
- `v2 + topics`
- `v2 + signals`

当前推荐口径：

- 安全默认：`legacy + off`
- 推荐灰度线：`v2 + off`
- 继续观察线：`v2 + topics`
- 条件启用线：`v2 + signals`

实验报告会记录：

1. 质量
2. coverage
3. contradiction
4. duplication
5. input routing observability
6. runtime fallback 观测

## 5. V1 的核心设计原则

### 5.1 输入层与训练核心解耦

`v2` 的变化只允许落在输入与预处理层，不直接侵入训练核心。

保持稳定的部分：

- `TrainingLoop`
- 四类训练 agent
- 训练 profile 语义
- 主聊天链路

### 5.2 默认稳定优先

V1 明确采用：

- 新链路可灰度
- 默认行为不轻易切换
- 若 `v2` 退化，可一键回到 `legacy`
- 在更多账号、更多轮数复验完成前，不把 `topics/signals` 升级为默认灰度组合

### 5.3 当前推荐灰度线

截至 `2026-04-06` 的真实对照结果，当前推荐是：

- 安全默认：`legacy + off`
- 推荐灰度实验线：`v2 + off`
- `topics`：保留为实验增强项，但当前尚未稳定优于 `off`
- `signals`：保留为条件增强项，只有 seed readiness 达标时才真正启用；否则自动降到 `topics`
- 在 `karpathy-2406-validation` 的两轮轻量 PK 上，`v2 + off` 已证明“不增加 contradiction / duplication，且 coverage 更高”，因此灰度推荐保持不变
- 在 `karpathy-3002-validation` 上，`v2 + off` 进一步证明“接入动态 timeout 治理后可在默认实验流中稳定完成”，因此灰度推荐保持不变
- 同时，`legacy + off` 的质量方差更小，所以安全默认仍然不变

### 5.4 大语料不直接全量进训练

V1 已经明确否定“1000+ 原文直接塞训练”的做法。

正式原则是：

`raw corpus -> shard distillation -> global merge -> training seed -> training`

### 5.5 冲突与敏感场景隔离

默认规则：

- `public/work`：可进 `soul / memory`
- `private`：优先进 `memory`
- `intimate/conflict`：默认不直接进入 `soul`

## 6. V1 当前结论

截至当前代码与实验状态，可以正式给出以下结论：

1. V1 主链路已经跑通
2. 公开文本蒸馏已具备可用性
3. 大语料分片蒸馏底座已接入主流程
4. 聊天与视频已拥有统一证据层入口
5. `v2` 已证明有价值，但尚未完成在超大语料下的稳定收敛验证
6. 当前默认生产主线仍应保持 `legacy`
7. 当前推荐灰度实验线应收口为 `v2 + off`

## 7. V1 之后的方向

V1 之后，系统将继续沿两条主线前进：

1. `V2 routing` 深化：让输入分流在大语料下更稳定
2. `Evidence Layer` 扩展：把聊天、视频和更大规模语料统一纳入证据蒸馏框架

具体优化路线见：

- [大语料扩展优化路线图](/Users/a77/Desktop/Neeko/docs/large-corpus-roadmap.md)
- [Dynamic Evidence Scaling Framework](/Users/a77/Desktop/Neeko/docs/dynamic-evidence-scaling-framework.md)
