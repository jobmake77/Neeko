# 大语料扩展优化路线图

更新时间：2026-04-06

关联文档：

- [Neeko 系统 V1 正式定义](/Users/a77/Desktop/Neeko/docs/system-v1.md)
- [输入架构阶段总结](/Users/a77/Desktop/Neeko/docs/input-architecture-status.md)
- [大语料稳定蒸馏实施方案](/Users/a77/Desktop/Neeko/docs/large-corpus-implementation-plan.md)
- [Dynamic Evidence Scaling Framework](/Users/a77/Desktop/Neeko/docs/dynamic-evidence-scaling-framework.md)
- [Dynamic Scaling Phase A 实施方案](/Users/a77/Desktop/Neeko/docs/dynamic-scaling-phase-a-plan.md)
- [账号分型与阶段分型路由框架](/Users/a77/Desktop/Neeko/docs/account-stage-routing-framework.md)

## 1. 路线图目标

当前 V1 已经验证：

1. `100 ~ 900+` 量级语料可进入同一培养框架
2. `legacy` 与 `v2` 可以在同一 persona 上做稳定对照
3. `Corpus Snapshot -> Shard Distillation -> Global Merge -> Training` 的主骨架成立
4. `890 / 909 / 1048` 三组真实样本当前都仍处在 `explore -> continue_expand`
5. `1126 / 1188 / 1227 / 1250 / 1350 / 1400 / 1500 / 1600 / 1800 / 2000 / 2406 / 3002 / 3501 / 4000 / 4335` 十五个本地阶梯快照仍未触发 `stabilize` 或 `compress`

## 1.1 最新阶段判断

基于 2026-04-05 的真实样本：

- [890 报告](/Users/a77/Desktop/Neeko/artifacts/experiment-karpathy-890-dynamic-report-lite/experiment-karpathy-890-main-validation-2026-04-05T13-45-39-284Z.json)
- [909 报告](/Users/a77/Desktop/Neeko/artifacts/experiment-karpathy-909-dynamic-report-lite/experiment-karpathy-909-main-validation-2026-04-05T13-50-38-915Z.json)
- [1048 报告](/Users/a77/Desktop/Neeko/artifacts/experiment-karpathy-1048-dynamic-report-lite/experiment-karpathy-1044-validation-2026-04-05T13-59-57-720Z.json)

当前可以先确认四件事：

1. `1000+` 并没有自动触发“应立即压缩或收敛”的信号
2. 当前更合理的动作仍然是继续扩容，并持续观察 `stable_topic_growth / duplication_pressure / runtime_pressure`
3. 真正的阶段切换点，至少还没有在 `1048` 这个位置出现
4. 即使扩到 `1126 / 1188 / 1227 / 1250 / 1350 / 1400 / 1500 / 1600 / 1800 / 2000 / 2406 / 3002 / 3501 / 4000 / 4335`，系统也仍然判断应继续扩容，但已经稳定暴露出“边际收益监控期”的特征

本轮还通过阶梯报告做了更细粒度确认：

- [Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-1044-scaling-ladder.json)
- 检查点：`250 / 500 / 750 / 1000 / 1048`
- 结果：五个检查点全部保持 `explore -> continue_expand`

后续继续扩容后的本地快照结果：

- [1126 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-1126-scaling-ladder.json)
- [1188 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-1188-scaling-ladder.json)
- [1227 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-1227-scaling-ladder.json)
- [1250 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-1250-scaling-ladder.json)
- [1350 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-1350-scaling-ladder.json)
- [1400 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-1400-scaling-ladder.json)
- [1500 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-1500-scaling-ladder.json)
- [1600 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-1600-scaling-ladder.json)
- [1800 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-1800-scaling-ladder.json)
- [2000 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-2000-scaling-ladder.json)
- [2400 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-2400-scaling-ladder.json)
- [3000 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-3000-scaling-ladder.json)
- [3500 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-3500-scaling-ladder.json)
- [4000 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-4000-scaling-ladder.json)
- [4335 Scaling Ladder 报告](/Users/a77/Desktop/Neeko/artifacts/karpathy-4335-scaling-ladder.json)
- `1126`、`1188`、`1227`、`1250`、`1350`、`1400`、`1500`、`1600`、`1800`、`2000`、`2406`、`3002`、`3501`、`4000` 与 `4335` 的最终 recommendation 仍然都是 `explore -> continue_expand`
- `4335` 最终关键指标：
  - `stable_topic_growth = 0.752723`
  - `marginal_coverage_gain = 0.919168`
  - `duplication_pressure = 0.131387`
  - `runtime_pressure = 0.312936`
  - `seed_maturity = 0.767259`
- `4000` 最终关键指标：
  - `stable_topic_growth = 0.763761`
  - `marginal_coverage_gain = 0.919182`
  - `duplication_pressure = 0.131363`
  - `runtime_pressure = 0.314133`
  - `seed_maturity = 0.768758`
- `3002` 最终关键指标：
  - `stable_topic_growth = 0.783699`
  - `marginal_coverage_gain = 0.920567`
  - `duplication_pressure = 0.129055`
  - `runtime_pressure = 0.340999`
  - `seed_maturity = 0.772622`
- `2406` 最终关键指标：
  - `stable_topic_growth = 0.851852`
  - `marginal_coverage_gain = 0.929697`
  - `duplication_pressure = 0.113839`
  - `runtime_pressure = 0.323591`
  - `seed_maturity = 0.785071`
- `2000` 最终关键指标：
  - `stable_topic_growth = 0.885375`
  - `marginal_coverage_gain = 0.931379`
  - `duplication_pressure = 0.111035`
  - `runtime_pressure = 0.330292`
  - `seed_maturity = 0.790360`
- `1800` 最终关键指标：
  - `stable_topic_growth = 0.900000`
  - `marginal_coverage_gain = 0.930379`
  - `duplication_pressure = 0.112702`
  - `runtime_pressure = 0.335690`
  - `seed_maturity = 0.792964`
- `1600` 最终关键指标：
  - `stable_topic_growth = 0.922897`
  - `marginal_coverage_gain = 0.930772`
  - `duplication_pressure = 0.112047`
  - `runtime_pressure = 0.336755`
  - `seed_maturity = 0.796485`
- `1500` 最终关键指标：
  - `stable_topic_growth = 0.924390`
  - `marginal_coverage_gain = 0.931155`
  - `duplication_pressure = 0.111408`
  - `runtime_pressure = 0.338460`
  - `seed_maturity = 0.796594`
- `1400` 最终关键指标：
  - `stable_topic_growth = 0.920918`
  - `marginal_coverage_gain = 0.932205`
  - `duplication_pressure = 0.109659`
  - `runtime_pressure = 0.340186`
  - `seed_maturity = 0.796708`
- `1350` 最终关键指标：
  - `stable_topic_growth = 0.937173`
  - `marginal_coverage_gain = 0.934223`
  - `duplication_pressure = 0.106295`
  - `runtime_pressure = 0.341169`
  - `seed_maturity = 0.799956`
- `1250` 最终关键指标：
  - `stable_topic_growth = 0.941989`
  - `marginal_coverage_gain = 0.934423`
  - `duplication_pressure = 0.105962`
  - `runtime_pressure = 0.344453`
  - `seed_maturity = 0.800642`
- `1227` 最终关键指标：
  - `stable_topic_growth = 0.952247`
  - `marginal_coverage_gain = 0.934699`
  - `duplication_pressure = 0.105501`
  - `runtime_pressure = 0.344937`
  - `seed_maturity = 0.802518`
- `1188` 最终关键指标：
  - `stable_topic_growth = 0.951149`
  - `marginal_coverage_gain = 0.934498`
  - `duplication_pressure = 0.105837`
  - `runtime_pressure = 0.346384`
  - `seed_maturity = 0.802505`

同时，监控层已经开始暴露出真实的扩容问题，而不是只给 recommendation：

1. `500` 附近出现 `shard_granularity_tight`
2. `750` 附近出现 `stable_signal_growth_plateau`
3. `1000+` 出现 `no_new_stable_signals`
4. 到 `4335` 为止，`no_new_stable_signals` 仍在持续，但 `duplication_pressure` 与 `runtime_pressure` 还没有同步升高到需要强制收敛
5. 当前还没有出现：
   - `runtime_pressure_high`
   - `duplication_pressure_high`
   - `conflict_pressure_high`

这意味着当前真正值得观察的，不是“有没有过 1000”，而是：

1. 继续扩容后 `stable_topic_growth` 什么时候开始明显放缓
2. `duplication_pressure` 和 `runtime_pressure` 什么时候开始同步上升
3. recommendation 什么时候第一次从 `explore` 切到 `stabilize` 或 `compress`

因此目前最准确的阶段判断是：

- 还没到“容量上限”
- 已经稳定进入“边际收益监控期”
- 接下来每次扩容，都应该同时看：
  - recommendation 是否切换
  - stable signals 是否继续增长
  - shard granularity 是否继续收紧

补充一个新的工程判断：

- 当前不应该把 `1000`、`5000`、`10000` 这些点写死成固定策略边界
- 更合理的是让 recommendation 与监控信号动态决定何时继续扩、何时稳态蒸馏、何时开始压缩
- `1188 -> 1227 -> 1250 -> 1350 -> 1400 -> 1500 -> 1600 -> 1800 -> 2000` 这段修复后继续扩出的新语料进一步证明：条数继续增长，并不自动等于应该收敛；真正关键的是边际新增稳定信号是否还在增长，以及压力指标是否开始同步抬升

补充一个新的抓取工程结论：

- 本轮 `1188` 一度卡住，并不等于公开语料已经到头
- 问题主要出在抓取层的重复窗口判断与失效 fallback，而不是动态扩容 recommendation 本身
- 修复抓取层后，live corpus 已从 `1188` 继续推到了 `2000+`

补充一个新的边界观察：

- 抵达 `1800` 目标后，继续把抓取目标向 `2400` 外推时，系统并没有卡死，而是在“短超时 + 小批次 + 多轮补档”治理下把 live corpus 推到了 `2406`
- 最终抓取从 `2026-04-03` 回填到了 `2020-07-16`
- `opencli` 在这一轮里没有出现 `provider_unhealthy`，说明先前的瓶颈主要是单批次治理方式过重，而不是公开历史已经到头
- 这说明当前系统的真实边界不是固定条数，而是“公开历史深层窗口的抓取效率”

最新观察补充：

- [2406 PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-2406-pk-aggregate.json)
- [3002 PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-3002-pk-aggregate.json)
- [4000 PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-4000-pk-aggregate.json)
- [4335 PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-4335-pk-aggregate.json)
- [paulg-1296 PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/paulg-1296-pk-aggregate.json)
- [paulg-1503 PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/paulg-1503-pk-aggregate.json)
- 在 `karpathy-2406-validation` 上补跑了两轮轻量真实 PK：
  - `legacy + off` 两轮均值：`quality = 0.92`，`coverage = 0.53435`
  - `v2 + off` 两轮均值：`quality = 0.91`，`coverage = 0.55070`
  - `v2 + signals` 两轮均值：`quality = 0.90`，`coverage = 0.53225`
- 在 `karpathy-3002-validation` 上做了新一轮真实 PK：
  - `legacy + off`：`quality = 0.91`，`coverage = 0.5333`
  - `v2 + off`：早期在 `180000ms` timeout 下先超时；接入动态 comparison timeout 治理后，4 次有效结果均值为 `quality = 0.9075`，`coverage = 0.5506625`
  - `v2 + signals`：2 次有效结果均值为 `quality = 0.90`，`coverage = 0.549875`
- 在 `karpathy-4000-validation` 上，`v2 + off` 给出了当前最强的单轮干净质量 `0.94`，但 `legacy + off` 有一轮被 provider fallback 污染到 `0.66`，因此该档位需要多轮解释
- 在 `karpathy-4335-validation` 上，新的边界验证结果为：
  - 当前抓取已从 `2026-04-03` 回填到 `2015-01-07`
  - `4500` 目标未达成不是因为流程故障，而是当前 provider 下 `karpathy` 的可达公开历史基本在这里见底
  - 三轮干净 PK 均值：
    - `legacy + off`：`quality = 0.9167`，`coverage = 0.5340`
    - `v2 + off`：`quality = 0.9233`，`coverage = 0.5347`
    - `v2 + signals`：`quality = 0.9033`，`coverage = 0.5326`
  - 这说明 `v2 + off` 在当前更大的真实样本边界上已经开始形成稳定均值优势，但优势幅度仍需第二账号复现
- 在 `paulg-1296-validation` 上，第二账号复现实验结果为：
  - 三轮均值：
    - `legacy + off`：`quality = 0.9033`，`coverage = 0.5326`
    - `v2 + off`：`quality = 0.8967`，`coverage = 0.5319`
    - `v2 + signals`：`quality = 0.9033`，`coverage = 0.5326`
  - 这说明 `v2 + off` 的收益还不是跨账号稳定复现的
- 在 `paulg-1503-validation` 上，更大样本首轮与隔离重跑结果为：
  - 当前抓取从 `2026-03-31` 回填到 `2025-07-10`
  - ladder 仍然给出 `explore -> continue_expand`
  - 当前新的 aggregate 口径显示：
    - `legacy + off`：四轮 clean 均值 `0.888 / 0.548`
    - `v2 + off`：四轮 clean 均值 `0.895 / 0.541`
    - `v2 + signals`：四轮 clean 均值 `0.895 / 0.532`
  - 第二轮中 `v2 + off` 出现 `persona respond timeout after 36000ms` 污染后的异常值 `0.15 / 0.3135`
  - 该异常值现在已经由 aggregate 层自动隔离，不再污染 clean mean
  - 这说明大样本第二账号上的主要风险，已经开始从“抓不动”转移到“provider/runtime 污染如何从策略表现中隔离”，同时也说明这类账号更可能呈现“局部最优随 provider 状态摆动”的特征
- 这说明在 `2406` 级语料上，`v2 + off` 已经证明“覆盖更高且不增加 contradiction / duplication”，但质量方差仍高于 `legacy + off`
- 这也说明到了 `3000+` 级语料，`v2 + off` 的首要治理点已经变成“实验 timeout 治理”和“provider 噪声隔离”，而不是 routing 本身失效
- 结合 `paulg` 两档结果，当前更准确的工程结论是：
  - `v2 + off` 不是无条件普适升级
  - 账号密度、语料结构和 provider/runtime 稳定性都会影响它的表现
  - 因此下一阶段应优先推进“账号分型/阶段分型”的治理，而不是直接全局切默认
- 现在这项治理已经正式落入代码：[experiment.ts](/Users/a77/Desktop/Neeko/src/cli/commands/experiment.ts)
- 因此当前阶段结论不变：
  - 安全默认仍保持 `legacy + off`
  - 推荐灰度线仍保持 `v2 + off`
  - `signals` 继续保留为 gated 能力，不进入默认灰度线

因此下一阶段的工作重点应是：

1. 把样本继续推到更高语料量级
2. 不盯死条数阈值，而是观察 recommendation 何时从 `explore` 转到 `stabilize` 或 `compress`
3. 在聊天和视频 Evidence Layer 上继续补观测与分层，而不是急着把它们直接写进 soul 主干

下一阶段的目标，不是简单把文档数做大，而是把系统能力边界正式推进到：

1. `1000 -> 5000`
2. `5000 -> 10000`
3. 从公开推文扩展到聊天与视频 transcript
4. 从单次培养扩展到可重复、可恢复、可长期更新的增量培养

## 2. 下一阶段总原则

### 2.1 不追求全局一次性最优

更大规模语料下，不应该假设存在单一全局最优策略。

应采用：

- 不同阶段使用不同策略
- 不同类型语料使用不同分层规则
- 训练只消费蒸馏后的全局 seed，而不是直接消费全量原始文本

进一步的正式机制定义见：

- [Dynamic Evidence Scaling Framework](/Users/a77/Desktop/Neeko/docs/dynamic-evidence-scaling-framework.md)

### 2.2 规模扩展优先级高于模型堆料

接下来最重要的不是把 prompt 再写长，而是把以下四件事做扎实：

1. 分片
2. 分区
3. 合并
4. 训练节奏控制

### 2.3 稳定性优先于局部提分

任何新优化，如果会破坏以下任一项，就不应直接进默认主线：

1. 默认行为兼容
2. 失败可恢复
3. 结果可解释
4. 资产可审计
5. 敏感场景隔离

## 3. 当前问题定义

当语料从 `1000` 扩展到 `5000 / 10000` 时，系统将面临的真实问题包括：

1. 原始输入过多，无法直接全量进入 extractor 或 training
2. 主题重复度更高，容易造成 soul 污染
3. 短期话题、情绪性内容、互动噪音会急剧增加
4. provider 的时延和超时问题会被放大
5. 某一个 shard 失败不能拖垮整个培养流程
6. 不同来源语料之间会出现风格差异、时间差异、场景差异
7. 新增语料不能每次都要求全量重跑

## 4. 下一阶段的总体架构

建议把后续架构理解为五层：

1. `Corpus Intake Layer`
2. `Evidence Distillation Layer`
3. `Cross-Shard Merge Layer`
4. `Training Seed Layer`
5. `Adaptive Training Layer`

数据总流建议固定为：

`Raw Sources -> EvidenceItems -> Shards -> Distilled Signals -> Global Topics/Conflicts -> Training Seeds -> Multi-Stage Training`

## 5. 1000 到 10000 的分片、分区、分组策略

### 5.1 分片目标

分片不是为了平均切块，而是为了控制三个问题：

1. 单 shard 的 token / chunk 负载
2. 单 shard 的主题密度
3. 单 shard 的失败恢复成本

### 5.2 一级分区：按来源类型

首先按来源类型做一级分区：

1. `twitter/public posts`
2. `article/blog`
3. `chat`
4. `video transcript`

原因：

不同来源的证据密度、上下文结构、可靠性和场景风险完全不同，不适合一开始就混在一起蒸馏。

### 5.3 二级分区：按时间窗口

每类来源内部，再按时间做二级分区。

建议窗口：

1. 高频公开短文本：`30 ~ 60 天`
2. 长文或 transcript：`主题优先，可放宽到 60 ~ 120 天`
3. 聊天：优先按 `session block` 聚合，不强制固定天数

原因：

- 时间相近的语料更容易共享主题与背景
- 更有利于检测“跨 session 稳定信号”
- 更有利于增量更新

### 5.4 三级分组：按主题密度与 token 预算

在时间分区内，再按以下约束组成实际 shard：

1. `target_docs_per_shard`
2. `max_docs_per_shard`
3. `estimated_chunks_per_shard`
4. `estimated_tokens_per_shard`
5. `source_mix_ratio`

建议默认值：

1. `target_docs_per_shard = 200 ~ 250`
2. `max_docs_per_shard = 300`
3. `max_estimated_chunks_per_shard = 120 ~ 180`
4. 单 shard 最终只保留 top soul chunks 与 top memory candidates

### 5.5 四级分组：高密主题单独成组

当某个主题在大语料中出现过于高频，例如：

- AI
- GPU
- 训练
- 创业
- 组织管理

应允许“高密主题单独成组”，避免它污染其他主题。

建议策略：

1. 先在 shard 内做 topic density 检测
2. 对超高频主题生成独立 `topic shard`
3. 全局合并时再与普通 shard 的稳定信号做汇合

## 6. 更大规模语料下的蒸馏策略

### 6.1 不直接把原文送进训练

当语料达到 `1000+` 后，应彻底固定这个原则：

训练循环只消费：

1. `global soul seed`
2. `global memory candidates`
3. `stable topics`
4. `conflict lane`

而不是直接消费 1000+ 原文。

### 6.2 shard 内蒸馏要做“局部最优”

每个 shard 的目标不是生成完整人格，而是回答：

1. 该 shard 中最稳定的人格信号是什么
2. 哪些内容只是上下文 memory
3. 哪些内容应隔离或丢弃

所以 shard 层应该追求“局部最优”，而不是全局人格总结。

### 6.3 global merge 要做“跨 shard 稳定性”

全局合并的核心不是关键词投票，而是判断：

1. 哪些信号跨 shard 重复出现
2. 哪些主题跨时间持续稳定
3. 哪些表达只是一时热点
4. 哪些冲突需要单独隔离

后续建议新增三类合并能力：

1. `topic canonicalization`
2. `cross-shard semantic merge`
3. `stability over time`

## 7. 训练策略的下一阶段设计

### 7.1 建议拆成三段训练

对于 `1000+ / 5000+ / 10000+` 语料，训练不应再是一种节奏跑到底。

建议拆成：

1. `Seed Alignment`
2. `Behavior Consolidation`
3. `Boundary Stress Test`

#### A. Seed Alignment

目标：

- 让 persona 先对齐全局 soul seed
- 不急于写大量 memory

策略：

- 低轮数
- 高质量 evaluator
- 更保守的 write threshold

#### B. Behavior Consolidation

目标：

- 把稳定的行为模式和偏好结构写实
- 适度引入 memory candidates

策略：

- 引入 topic-based questions
- 对高稳定领域增加覆盖
- 控制 duplication

#### C. Boundary Stress Test

目标：

- 用边界问题和对抗性问题测试人格稳态
- 检查 contradiction、overfit、hallucination

策略：

- Director 更强介入
- 强制冲突复盘
- 输出边界报告

### 7.2 训练问题生成要从“随机问”升级为“种子驱动问”

后续问题集建议优先来源于：

1. stable topics
2. cross-shard repeated values
3. behavioral patterns
4. conflict lane unresolved items

这样才能把大语料的蒸馏结果真正反馈到训练阶段。

## 8. 聊天和视频扩展的推进方式

### 8.1 聊天语料

对于聊天，建议作为下一个优先级最高的扩展对象。

核心原则：

1. 显式 `target manifest`
2. 单目标培养
3. 只围绕 target 构建证据窗口
4. `private` 与 `intimate/conflict` 默认不直接进 soul

大文件处理建议：

1. 流式读取
2. 中间索引落盘
3. session 级 checkpoint
4. 可断点恢复

### 8.2 视频语料

视频在下一阶段建议继续坚持：

1. `transcript-first`
2. `diarization-ready`
3. `visual understanding later`

也就是说：

- 先把视频当成分段 transcript 证据
- 说话人分离和非语言信号先预留 schema
- 不在当前阶段直接做复杂视觉理解

## 9. 必须补强的工程能力

### 9.1 增量更新

当语料达到 `5000+` 后，每次全量重跑成本过高。

必须支持：

1. 新语料增量进入 snapshot
2. 只重算受影响 shard
3. 只重算受影响 topic merge
4. 只刷新受影响 training seed

### 9.2 显式 resume orchestration

接下来要把“能重跑”升级成“系统性 resume”。

要求：

1. shard 级失败可重跑
2. merge 前失败可恢复
3. training stage 失败可从 checkpoint 继续

### 9.3 provider 隔离与异步化

大语料下必须控制 provider 侧不稳定性。

建议继续推进：

1. shard 级任务异步执行
2. provider timeout 真正中断
3. provider failure 和 strategy failure 分账
4. 限流与退避
5. 单 provider 异常时允许局部降级而不是全局失败

### 9.4 更强的 observability

下一阶段至少增加以下观测：

1. 各来源类型的保留率
2. 各 shard 的 stable signal growth
3. topic merge 前后压缩率
4. conflict lane 增长率
5. seed 被训练实际命中的比例
6. 各阶段 token/time 成本

## 10. 推荐实施顺序

建议按下面顺序推进，而不是同时铺太多面。

### Phase 1：V1 稳定收口

目标：

1. 固化 V1 文档
2. 保持 `legacy` 默认
3. 继续把 `v2` 的 runtime 稳定性收紧

### Phase 2：1000 -> 5000 扩容

目标：

1. shard 规则正式化
2. 高密主题单独分组
3. 增量更新与 resume 接入
4. training seed 与训练阶段联动更紧

### Phase 3：聊天能力正式接入

目标：

1. 聊天输入流式化
2. speaker/session/window 稳定化
3. scene gating 更严格

### Phase 4：视频 transcript 规模化接入

目标：

1. transcript segments 标准化
2. diarization-ready 全面接入
3. 与文本/聊天统一进 evidence routing

### Phase 5：5000 -> 10000 与多阶段训练

目标：

1. multi-stage training
2. cross-shard semantic merge
3. seed-driven question planning
4. 边界压力测试自动化

## 11. 需要持续防范的问题

在扩容过程中，以下问题必须提前纳入方案，而不是出事后再补：

1. 热点话题污染人格主干
2. 过度依赖高频短文本导致人格变平
3. 私密或冲突内容越权进入 soul
4. 某一个主题占据过多训练轮次
5. provider 波动被误判成架构失败
6. 增量更新导致旧 seed 与新 seed 语义不一致
7. 更大规模语料下 conflict lane 爆炸
8. 缺乏 resume 导致失败成本过高

## 12. 当前建议结论

如果把下一阶段压缩成一句话，就是：

不要把 5000 或 10000 语料当成“更大的输入文件”，而要把它当成“更大的证据系统”。

因此后续优化的主线应该是：

1. 更稳的 Evidence Layer
2. 更强的 shard 和 topic 组织能力
3. 更明确的 global merge 与 seed 机制
4. 更分阶段的训练策略
5. 更完整的增量、恢复和观测能力

这条路线成立后，系统才有条件把能力边界从 `1000` 推到 `5000`，再推到 `10000`。
