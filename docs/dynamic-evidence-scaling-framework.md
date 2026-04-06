# Dynamic Evidence Scaling Framework

更新时间：2026-04-05

关联文档：

- [Neeko 系统 V1 正式定义](/Users/a77/Desktop/Neeko/docs/system-v1.md)
- [输入架构阶段总结](/Users/a77/Desktop/Neeko/docs/input-architecture-status.md)
- [大语料稳定蒸馏实施方案](/Users/a77/Desktop/Neeko/docs/large-corpus-implementation-plan.md)
- [大语料扩展优化路线图](/Users/a77/Desktop/Neeko/docs/large-corpus-roadmap.md)
- [Dynamic Scaling Phase A 实施方案](/Users/a77/Desktop/Neeko/docs/dynamic-scaling-phase-a-plan.md)

## 1. 设计目标

本框架用于替代“按规模段写死规则”的做法。

它不预设：

- `100 -> 500` 用一套规则
- `500 -> 1000` 用另一套规则
- `1000 -> 5000` 再换一套规则

而是定义一套动态机制，让系统根据当前语料状态、人格信号状态、风险状态和运行状态，自动决定：

1. 是否继续扩容
2. 新增语料是否值得保留
3. 如何切 shard
4. 何时进入 merge
5. 何时进入训练
6. 当前训练应该偏向哪种目标

一句话总结：

`Neeko 的后续大语料框架应是一个动态证据调度系统，而不是固定规模阈值系统。`

## 2. 为什么不能用固定规则

固定规则的问题不是“不够精细”，而是它在机制上不适合这个产品。

### 2.1 语料规模不是唯一变量

决定培养策略的，不只是文档数，还包括：

1. 语料来源结构
2. 主题重复度
3. 信息密度
4. 人格稳定信号增长速度
5. 冲突积累情况
6. provider 时延和失败率

同样是 `1000` 条推文，不同账号可能差异非常大：

- 有的人是高密干货流
- 有的人是大量转评、短句、互动碎片
- 有的人主题单一
- 有的人跨多个知识域与场景

因此不能只按条数切阶段。

### 2.2 扩容是边际收益问题

当新增语料继续带来：

- 新稳定主题
- 新人格边界
- 新行为模式
- 更高覆盖率

扩容就是有价值的。

当新增语料只带来：

- 重复表述
- 热点噪音
- 局部情绪
- provider 时间成本暴涨

扩容就不应该继续按原方式推进。

所以系统应围绕“边际信息收益”而不是“绝对规模”做决策。

## 3. 动态机制的核心原则

### 3.1 以证据价值驱动，不以文档数量驱动

每一批输入进入系统后，应该先回答：

1. 这批内容有多高质量
2. 这批内容有多少新信息
3. 这批内容是否稳定反映目标对象
4. 这批内容有多大风险
5. 这批内容是否值得占用训练预算

### 3.2 以状态切换驱动，不以规模切换驱动

系统的阶段切换不应由“到了多少条”触发，而应由观测指标触发。

### 3.3 以蒸馏后 seeds 驱动训练，不以原始语料驱动训练

当语料规模持续扩大时，训练必须只消费蒸馏结果，而不能继续直接消费大批原始文本。

### 3.4 以增量更新驱动扩容，不以全量重跑驱动扩容

系统规模越大，越应优先支持：

1. 增量引入
2. 局部刷新
3. 局部重跑
4. 版本冻结

## 4. 系统分层

建议后续正式采用七层结构。

### 4.1 Raw Source Layer

原始输入来源：

1. 推文
2. 文章
3. 聊天记录
4. 视频 transcript

### 4.2 Evidence Layer

统一转成 `EvidenceItem`。

这一层负责：

1. speaker attribution
2. scene labeling
3. context windowing
4. evidence normalization

### 4.3 Evidence Pack Layer

这是下一阶段建议新增的关键中间层。

`EvidencePack` 是：

- 大于单条 `EvidenceItem`
- 小于一个完整 `shard`

它是后续动态扩容、动态切 shard、增量刷新和 topic merge 的核心单元。

建议字段：

1. `pack_id`
2. `source_type`
3. `time_window`
4. `topic_signature`
5. `items[]`
6. `quality_score`
7. `novelty_score`
8. `stability_score`
9. `risk_score`
10. `target_relevance`
11. `estimated_token_cost`
12. `dedup_neighbors`
13. `merge_candidates`

### 4.4 Adaptive Shard Layer

多个 `EvidencePack` 组成一个运行期 `shard`。

但 shard 不再由固定文档数定义，而由：

1. token 预算
2. chunk 预算
3. 主题一致性
4. 时间连续性
5. 来源结构
6. provider 压力

共同决定。

### 4.5 Cross-Shard Merge Layer

对 shard 结果做：

1. signal merge
2. topic canonicalization
3. cross-shard stability merge
4. conflict isolation

### 4.6 Training Seed Layer

这一层负责生成训练实际消费的种子：

1. soul seeds
2. memory seeds
3. conflict seeds
4. question seeds

### 4.7 Adaptive Training Layer

训练根据当前状态切换不同模式，而不是固定按 rounds 一路跑到底。

## 5. 四个动态控制回路

本框架的核心不在某一个对象，而在四个控制回路。

### 5.1 Corpus Control Loop

负责判断：

1. 是否继续抓新语料
2. 新语料是否值得进入系统
3. 当前更该扩大规模，还是该先蒸馏

该回路关注：

1. `quality`
2. `novelty`
3. `stability`
4. `coverage_gain`
5. `duplication_pressure`
6. `risk`
7. `cost`

推荐抽象：

`evidence_value = quality + novelty + stability + coverage_gain - duplication - risk - cost`

这里不要求当前版本实现固定公式，但要求系统围绕这类价值函数组织输入调度。

### 5.2 Partition Control Loop

负责判断：

1. 该如何组成 pack
2. 该如何组成 shard
3. 当前 shard 应该扩大还是缩小

该回路关注：

1. token/chunk 预算
2. topic coherence
3. time coherence
4. source mix
5. runtime pressure
6. dedup pressure

### 5.3 Merge Control Loop

负责判断：

1. 哪些 signal 已经稳定
2. 哪些 topic 需要归并
3. 哪些 signal 只是噪音
4. 哪些 signal 应进 conflict lane

该回路关注：

1. cross-shard repetition
2. cross-source repetition
3. stability over time
4. semantic consistency
5. unresolved conflicts

### 5.4 Training Control Loop

负责判断：

1. 什么时候进入训练
2. 当前训练该优先对齐什么
3. 当前该更强调写入、巩固还是压力测试

该回路关注：

1. seed maturity
2. stable topic coverage
3. contradiction pressure
4. duplication pressure
5. boundary uncertainty

## 6. 关键状态指标

为了让系统真正动态切换，需要定义一组状态指标。

推荐至少引入以下指标。

### 6.1 `stable_topic_growth`

表示随着新语料进入，稳定主题是否还在明显增长。

如果持续增长，说明扩容仍有价值。

如果趋于平缓，说明应降低扩容优先级，转向 merge 或训练。

### 6.2 `marginal_coverage_gain`

表示新增语料带来的覆盖率增益。

它比“总覆盖率”更重要，因为它直接衡量新增数据的边际收益。

### 6.3 `duplication_pressure`

表示新旧语料之间的重复程度、主题挤压程度和语义重叠程度。

该指标上升时，应优先：

1. 更强 dedup
2. 更强 pack 压缩
3. 更强 topic merge

### 6.4 `conflict_pressure`

表示冲突信号是否正在积累。

该指标上升时，不应急着继续写 soul，而应优先扩 conflict lane。

### 6.5 `runtime_pressure`

表示当前运行成本是否已经被 provider 时延、超时和重试放大。

该指标上升时，应优先：

1. 减小单 shard 预算
2. 增加异步化
3. 做更细粒度 resume

### 6.6 `seed_maturity`

表示当前全局 seed 是否已经足够稳定，可以进入更重的训练阶段。

## 7. 动态状态机

建议把系统运行状态抽象为以下五类，而不是按语料规模硬分阶段。

### 7.1 `Explore`

目标：

- 扩充证据来源
- 发现新主题
- 拉高覆盖

触发条件倾向：

- `stable_topic_growth` 高
- `marginal_coverage_gain` 高
- `duplication_pressure` 低

### 7.2 `Compress`

目标：

- 强化 dedup
- 强化 pack 化
- 压缩冗余表达

触发条件倾向：

- `duplication_pressure` 上升
- 新主题增长放缓

### 7.3 `Stabilize`

目标：

- 让全局稳定信号收敛
- topic 归并
- conflict 分流

触发条件倾向：

- `seed_maturity` 上升
- `stable_topic_growth` 放缓
- `conflict_pressure` 可控

### 7.4 `Align`

目标：

- 让训练先对齐成熟 seeds
- 提升人格主干一致性

触发条件倾向：

- `seed_maturity` 达标
- coverage 足够
- contradiction 可控

### 7.5 `Stress`

目标：

- 做边界测试
- 做冲突回放
- 做人格稳态检查

触发条件倾向：

- 初始对齐已完成
- 但边界不确定性仍高

## 8. 动态分片机制

这里不建议用固定的“每 200 条一片”。

建议采用预算驱动的分片机制。

### 8.1 pack 形成规则

优先根据以下维度形成 `EvidencePack`：

1. 同来源类型
2. 同时间窗口
3. 高 topic coherence
4. 相近风险等级
5. 相近 target relevance

### 8.2 shard 形成规则

shard 由 pack 动态组成，直到逼近某个预算上限：

1. max estimated tokens
2. max estimated chunks
3. max runtime budget
4. max topical entropy

### 8.3 高密主题单独成组

对于极高密度主题，应允许形成独立 topic packs / topic shards，避免它污染整体人格。

## 9. 动态训练机制

训练也不应用固定 round 逻辑覆盖所有情况。

建议后续训练默认分三种模式：

### 9.1 `Seed Alignment`

目标：

- 对齐全局 stable seeds
- 先把人格主干打稳

### 9.2 `Behavior Consolidation`

目标：

- 把行为模式、价值取向、偏好结构巩固下来
- 有节制地引入 memory seeds

### 9.3 `Boundary Stress Test`

目标：

- 用边界和对抗问题测试人格稳定性
- 检测 contradiction 和 overfit

这三种模式的切换，应由状态指标驱动，而不是由语料条数驱动。

## 10. 增量更新规则

当规模继续扩大后，系统必须默认支持增量更新。

### 10.1 输入层增量

新增语料进入后：

1. 只新增 EvidenceItems
2. 只新增或更新相关 packs
3. 不全量重构所有历史证据

### 10.2 shard 层增量

仅重算：

1. 受影响 packs
2. 受影响 shards
3. 受影响 topic merges

### 10.3 seed 层增量

仅刷新：

1. 受影响 stable topics
2. 受影响 memory candidates
3. 受影响 conflict lanes

### 10.4 training 层增量

训练应优先消费新的或被刷新过的 seeds，而不是每次重新从零对齐全部历史语料。

## 11. 与当前 V1 的关系

本框架不是对 V1 的推翻，而是对 V1 的升级方向统一。

### 11.1 V1 中已具备的基础

当前已经具备：

1. `EvidenceItem`
2. `legacy / v2 routing`
3. `Corpus Snapshot`
4. `Shard Distillation`
5. `Global Merge`
6. `Training Seed`
7. 训练 loop 与 observability

### 11.2 本框架新增的关键点

后续新增重点是：

1. `EvidencePack`
2. 动态状态指标
3. 四个控制回路
4. 动态状态机
5. 增量更新与局部重跑优先机制

## 12. 推荐落地顺序

建议按照以下顺序落地，而不是一次改太多。

### Phase A：机制落地底座

1. 明确状态指标定义
2. 增加 pack 层 schema
3. 为现有资产补充 pack/merge 所需观测

对应实施文档：

- [Dynamic Scaling Phase A 实施方案](/Users/a77/Desktop/Neeko/docs/dynamic-scaling-phase-a-plan.md)

### Phase B：动态分片

1. pack builder
2. budget-based shard builder
3. topic-dense pack isolation

### Phase C：动态合并

1. topic canonicalization
2. cross-shard stability merge
3. conflict lane 强化

### Phase D：动态训练

1. seed maturity 评估
2. training mode 切换
3. seed-driven question planning

### Phase E：增量与恢复

1. 增量引入
2. 局部刷新
3. 显式 resume orchestration

## 13. 当前结论

从当前讨论和公开实践来看，最值得正式确定的不是某个阈值，而是以下机制性结论：

1. 不按规模段写死策略
2. 按状态与边际收益动态调度
3. 引入 `EvidencePack` 作为关键中间层
4. 训练只消费蒸馏后的 seeds
5. 扩容默认走增量、局部刷新和版本冻结

这套机制一旦成立，后续无论是从 `1000` 扩到 `5000`，还是到 `10000`、`50000`，系统都不需要推翻重来，只需要在同一框架内继续增强调度能力。
