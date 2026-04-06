# 输入架构与训练优化阶段总结

更新时间：2026-04-06

关联文档：

- [Neeko 系统 V1 正式定义](/Users/a77/Desktop/Neeko/docs/system-v1.md)
- [大语料稳定蒸馏实施方案](/Users/a77/Desktop/Neeko/docs/large-corpus-implementation-plan.md)
- [大语料扩展优化路线图](/Users/a77/Desktop/Neeko/docs/large-corpus-roadmap.md)
- [Dynamic Evidence Scaling Framework](/Users/a77/Desktop/Neeko/docs/dynamic-evidence-scaling-framework.md)
- [账号分型与阶段分型路由框架](/Users/a77/Desktop/Neeko/docs/account-stage-routing-framework.md)

## 1. 当前阶段结论

当前项目不是只在做单一方向的优化，而是在并行推进两条线：

1. `V2 input routing`：针对大规模推文语料，优化 `Soul / Memory / Discard` 分流质量，减少噪音直接进入 soul。
2. `Evidence Layer V1`：把推文、聊天、视频统一提升为可归因、可分段、可评分的 `EvidenceItem`，为后续多模态培养打底。

这两条线的关系不是替代，而是分层：

- `Evidence Layer` 解决“输入如何标准化、怎么保留上下文和归因”。
- `V2 routing` 解决“标准化输入进入培养前，哪些该进 soul、哪些只该进 memory、哪些该丢弃”。

当前判断：这个方向是成立的，不需要回退到旧架构；但在真正扩大到更大语料前，需要先把稳定性和观测继续收紧。

补充收口结论：

- 安全默认仍保持 `legacy + off`
- 当前推荐灰度实验线收口为 `v2 + off`
- `v2 + topics` 暂未稳定优于 `off`
- `v2 + signals` 已接入 readiness gate，不达标时会自动降到 `topics`
- `890 / 909 / 1048` 三组真实样本当前都给出同一条动态扩容建议：`explore -> continue_expand`
- `1126 / 1188 / 1227 / 1250 / 1350 / 1400 / 1500 / 1600 / 1800 / 2000 / 2406 / 3002 / 3501 / 4000 / 4335` 十五个本地阶梯快照仍然保持 `explore -> continue_expand`
- [karpathy-2406-validation 两轮 PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-2406-pk-aggregate.json) 说明当前最佳结论仍是“双轨并存”：`legacy + off` 更稳，`v2 + off` 覆盖更高，`signals` 继续 gated
- [karpathy-3002-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-3002-pk-aggregate.json) 进一步说明：`v2 + off` 在 `3000+` 规模上仍成立，但需要更宽松的实验 timeout 治理
- [karpathy-4000-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-4000-pk-aggregate.json) 说明：`v2 + off` 已在单轮干净运行中给出最强质量，但 `legacy` 仍受 provider 噪声影响，需要多轮解释
- [karpathy-4335-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-4335-pk-aggregate.json) 说明：在当前 provider 可达的大样本边界附近，`v2 + off` 首次以干净单轮结果同时领先质量与覆盖
- [paulg-1296-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/paulg-1296-pk-aggregate.json) 说明：第二高密度账号并没有稳定复现 `v2 + off` 优势，`legacy + off` 仍略占上风
- [paulg-1503-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/paulg-1503-pk-aggregate.json) 说明：扩大到 `1503` 后，第二账号仍未支持 `v2 + off` 普适升级；并且出现过一次需要隔离的 timeout 异常值
- 这项治理现在已经正式进入代码，而不是继续依赖手工环境变量：
  - [experiment.ts](/Users/a77/Desktop/Neeko/src/cli/commands/experiment.ts)

## 1.1 2026-04-05 阶段性真实验证结论

本轮新增了三组真实样本，目的是确认：

1. `v2 + off` 是否仍然是当前最稳灰度路径
2. `dynamic scaling recommendation` 在 `900+ -> 1000+` 语料段是否保持稳定
3. provider 抖动下，轻量 experiment 是否仍能稳定产出正式报告

代表性结果如下：

| Persona | Docs | 结果 | 说明 |
|---|---:|---|---|
| `karpathy-890-main-validation` | 890 | `v2 + off`；`explore -> continue_expand` | 轻量 experiment 成功，出现 1 次 director fallback |
| `karpathy-909-main-validation` | 909 | `v2 + off`；`explore -> continue_expand` | 轻量 experiment 成功，无 director fallback |
| `karpathy-1044-validation` | 1048 | `v2 + off`；`explore -> continue_expand` | 由 `909 + pre2024` 补档合并得到的第一份 `1000+` 验证样本 |
| `karpathy-2406-validation` | 2406 | 安全默认 `legacy + off`；推荐灰度 `v2 + off` | 两轮真实 PK 显示 `v2 + off` 覆盖更高，但质量方差仍大于 `legacy + off` |
| `karpathy-3002-validation` | 3002 | 安全默认 `legacy + off`；推荐灰度 `v2 + off` | `v2 + off` 在默认 `180000ms` timeout 下超时，放宽到 `300000ms` 后跑出 `92.0% / 53.4%` |
| `karpathy-4000-validation` | 4000 | 安全默认 `legacy + off`；推荐灰度 `v2 + off` | `v2 + off` 在干净单轮中拿到 `94.0% / 53.6%`，`legacy` 有一轮被 provider fallback 污染到 `0.66` |
| `karpathy-4335-validation` | 4335 | 安全默认 `legacy + off`；推荐灰度 `v2 + off` | 三轮干净真实 PK：`legacy + off` 均值 `0.9167 / 0.5340`，`v2 + off` 均值 `0.9233 / 0.5347`，`signals` 继续无优势 |
| `paulg-1296-validation` | 1296 | 安全默认 `legacy + off`；推荐灰度 `v2 + off` | 三轮真实 PK 显示 `legacy + off` 与 `signals` 持平，`v2 + off` 略弱，说明第二账号尚未复现 `karpathy` 的优势趋势 |
| `paulg-1503-validation` | 1503 | 安全默认 `legacy + off`；推荐灰度 `v2 + off` | 当前首轮与隔离异常后的重跑显示 `legacy/off` 与 `v2/off` 基本接近，但还没有出现明确的 `v2` 普适优势 |

对应报告：

- [890 动态报告](/Users/a77/Desktop/Neeko/artifacts/experiment-karpathy-890-dynamic-report-lite/experiment-karpathy-890-main-validation-2026-04-05T13-45-39-284Z.json)
- [909 动态报告](/Users/a77/Desktop/Neeko/artifacts/experiment-karpathy-909-dynamic-report-lite/experiment-karpathy-909-main-validation-2026-04-05T13-50-38-915Z.json)
- [1048 动态报告](/Users/a77/Desktop/Neeko/artifacts/experiment-karpathy-1048-dynamic-report-lite/experiment-karpathy-1044-validation-2026-04-05T13-59-57-720Z.json)

当前阶段性判断：

1. `900+ -> 1000+` 这一步还没有进入 `stabilize` 或 `compress`
2. 当前更像是“仍有明显新增覆盖，但 provider 时延治理还要继续做”
3. 所以下一阶段的重点不是回退架构，而是继续把语料扩容到更大规模，再观察何时从 `explore` 切到 `stabilize`
4. `1000+` 之后已经出现稳定的平台期信号，但还没有出现足以要求全局收敛的压力信号

补充说明：

- 本轮还新增了一份阶梯验证报告：[karpathy-1044-scaling-ladder.json](/Users/a77/Desktop/Neeko/artifacts/karpathy-1044-scaling-ladder.json)
- 使用 `250 / 500 / 750 / 1000 / 1048` 五个检查点做纯本地 recommendation 验证
- 五个检查点全部返回 `explore -> continue_expand`
- 随后又补跑了 [karpathy-1126-scaling-ladder.json](/Users/a77/Desktop/Neeko/artifacts/karpathy-1126-scaling-ladder.json)、[karpathy-1188-scaling-ladder.json](/Users/a77/Desktop/Neeko/artifacts/karpathy-1188-scaling-ladder.json)、[karpathy-1227-scaling-ladder.json](/Users/a77/Desktop/Neeko/artifacts/karpathy-1227-scaling-ladder.json)、[karpathy-1250-scaling-ladder.json](/Users/a77/Desktop/Neeko/artifacts/karpathy-1250-scaling-ladder.json)、[karpathy-1350-scaling-ladder.json](/Users/a77/Desktop/Neeko/artifacts/karpathy-1350-scaling-ladder.json)、[karpathy-1400-scaling-ladder.json](/Users/a77/Desktop/Neeko/artifacts/karpathy-1400-scaling-ladder.json)、[karpathy-1500-scaling-ladder.json](/Users/a77/Desktop/Neeko/artifacts/karpathy-1500-scaling-ladder.json)、[karpathy-1600-scaling-ladder.json](/Users/a77/Desktop/Neeko/artifacts/karpathy-1600-scaling-ladder.json)、[karpathy-1800-scaling-ladder.json](/Users/a77/Desktop/Neeko/artifacts/karpathy-1800-scaling-ladder.json)、[karpathy-2000-scaling-ladder.json](/Users/a77/Desktop/Neeko/artifacts/karpathy-2000-scaling-ladder.json) 和 [karpathy-2400-scaling-ladder.json](/Users/a77/Desktop/Neeko/artifacts/karpathy-2400-scaling-ladder.json)
- `2406` 仍返回 `explore -> continue_expand`，且 `duplication_pressure = 0.113839`、`runtime_pressure = 0.323591`，尚未触发需要压缩的压力区间
- `3002` 仍返回 `explore -> continue_expand`，且 `duplication_pressure = 0.129055`、`runtime_pressure = 0.340999`，尚未触发需要压缩的压力区间
- `4000` 仍返回 `explore -> continue_expand`，且 `duplication_pressure = 0.131363`、`runtime_pressure = 0.314133`，没有进入需要压缩的高压区
- `4335` 仍返回 `explore -> continue_expand`，且 `duplication_pressure = 0.131387`、`runtime_pressure = 0.312936`，说明本地 recommendation 仍不支持“因为条数大就直接收敛”
- 这说明在当前可用真实语料范围内，系统还没有出现“应该立即压缩或收敛”的阶段切换信号
- 这也说明 `4500` 这档没有达到目标数，不是因为 routing 或 provider 崩掉，而是当前 provider 可抓到的 `karpathy` 历史大约止于 `2015-01-07`

但监控也已经暴露出第一批扩容问题：

1. `500` 左右开始出现 `shard_granularity_tight`
2. `750` 左右开始出现 `stable_signal_growth_plateau`
3. `1000+` 开始出现 `no_new_stable_signals`
4. 到 `3002` 为止，`no_new_stable_signals` 仍然持续，说明接下来的扩容判断必须更多依赖边际收益与压力组合，而不能只看总条数

这组信号的含义不是“该回退”，而是：

- 当前推荐仍然是继续扩容
- 但从 `750+` 开始，应该重点观察“新增语料是否真的继续产出新的 stable signals”
- 后续扩容阶段要优先盯住边际收益，而不是只盯总条数

补充本轮抓取治理结论：

- `1188` 的短暂停滞并不是公开语料天然上限
- 真正的问题在抓取层：重复窗口被当成有效进展，失效 `snscrape` fallback 又持续拖慢窗口推进
- 收紧这两个点之后，live corpus 已继续扩到 `2000+`
- 继续把查询治理改成“短超时 + 小批次 + 多轮补档”之后，`karpathy-2400-live.json` 最终稳定推进到了 `2406`

补充边界观察：

- 在达到 `1800` 之后继续外推到 `2400` 目标时，系统最终不是停在 `1836/2113`，而是完整补到了 `2406`
- 最新 live corpus 时间范围已经从 `2026-04-03` 回填到了 `2020-07-16`
- 这说明当前的真实瓶颈并不是固定条数上限，而是深历史窗口的抓取效率与 provider 时延治理

最新追加观察：

- [karpathy-2406-validation 两轮 PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-2406-pk-aggregate.json)
- 两轮轻量 PK 的均值表现：
  - `legacy + off`：`quality = 0.92`，`coverage = 0.53435`
  - `v2 + off`：`quality = 0.91`，`coverage = 0.55070`
  - `v2 + signals`：`quality = 0.90`，`coverage = 0.53225`
- 当前阶段更准确的解释是：
  - `legacy + off` 仍是更稳的安全默认
  - `v2 + off` 在大语料上已经证明“覆盖补全能力更强，且没有引入 contradiction / duplication 回归”
  - `v2 + signals` 仍未证明稳定增益
- 到 `3002` 这一档，新的关键信号是：
  - `v2 + off` 首次不是质量回归，而是先撞上了 `180000ms` 的 runtime timeout
  - 在代码里接入动态 comparison timeout 治理后，`3002` 的默认实验路径已经可以直接跑通 `v2 + off`
  - 当前 `3002` 汇总结果显示：
    - `legacy + off`：2 次均值 `quality = 0.91`，`coverage = 0.5333`
    - `v2 + off`：4 次均值 `quality = 0.9075`，`coverage = 0.5506625`
    - `v2 + signals`：2 次均值 `quality = 0.90`，`coverage = 0.549875`
  - 这说明 `3000+` 阶段要优先治理 runtime 上限，而不是错误地把 timeout 当成 routing 退化
- 到 `4335` 这一档，新的关键信号是：
  - 当前抓取边界已经从 `2026-04-03` 回填到 `2015-01-07`
  - `4500` 目标没有完成，不是流程性失败，而是当前 provider 下已接近账号可达历史边界
  - [karpathy-4335-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/karpathy-4335-pk-aggregate.json) 显示三轮干净结果：
    - `legacy + off`：均值 `quality = 0.9167`，`coverage = 0.5340`
    - `v2 + off`：均值 `quality = 0.9233`，`coverage = 0.5347`
    - `v2 + signals`：均值 `quality = 0.9033`，`coverage = 0.5326`
  - 这说明在当前更大的真实样本边界上，`v2 + off` 已经开始形成稳定均值优势，但幅度还没有大到足以直接替换全局安全默认
  - [paulg-1296-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/paulg-1296-pk-aggregate.json) 显示三轮结果：
    - `legacy + off`：均值 `quality = 0.9033`，`coverage = 0.5326`
    - `v2 + off`：均值 `quality = 0.8967`，`coverage = 0.5319`
    - `v2 + signals`：均值 `quality = 0.9033`，`coverage = 0.5326`
  - [paulg-1503-validation PK 汇总](/Users/a77/Desktop/Neeko/artifacts/experiments/paulg-1503-pk-aggregate.json) 在当前 aggregate 口径下显示：
    - `legacy + off`：四轮 clean 均值 `quality = 0.888`，`coverage = 0.548`
    - `v2 + off`：四轮 clean 均值 `quality = 0.895`，`coverage = 0.541`
    - `v2 + signals`：四轮 clean 均值 `quality = 0.895`，`coverage = 0.532`
    - `v2 + off` 的一次 `persona respond timeout after 36000ms` 污染异常值 `0.15 / 0.3135` 已被 aggregate 层正确隔离
  - 这说明当前更准确的阶段判断是：
    - `v2 + off` 在 `karpathy` 上有稳定增强信号
    - 但在第二高密度账号 `paulg` 上，这个优势还没有稳定复现
    - `v2 + off` 和 `signals` 都能在 `paulg-1503` 上拿到局部质量优势，但覆盖仍落后于 `legacy/off`
    - 因此这类账号更接近“局部最优随 provider/runtime 摆动”的状态，而不是可以直接做全局默认切换
    - 因此更合理的策略不是全局切默认，而是继续维持“安全默认 legacy、灰度观察 v2”的双轨结构

## 2. 已经完成的步骤

### 2.0 正式实施方案已建立

本轮已把“大语料稳定蒸馏”从讨论稿升级为正式实施文档：

- `docs/large-corpus-implementation-plan.md`

并开始落地 `Phase A`：

- `corpus-snapshot.json`
- `shard-plan.json`
- `input-run-manifest.json`
- `shards/<id>/raw-docs.json`
- `shards/<id>/meta.json`

当前这一阶段的定位是：

- 先把输入侧稳定性底座做好
- 暂不直接改训练核心
- 为后续 shard distillation / global merge 预留稳定接口

补充说明：

- `create` / `train` 在生成 corpus planning 资产时，已经会同步把每个 shard 的原始语料与 shard 元信息落盘
- 这意味着 `Phase A` 已经不只是“计划文件生成”，而是具备后续 `Phase B` 直接消费的 shard 输入底座

### 2.0.1 Phase B scaffold 已接入

在不改训练核心的前提下，当前已经把 shard distillation 的第一版骨架接进输入侧：

- `src/core/pipeline/shard-distillation.ts`
- `shards/<id>/shard-soul-summary.json`
- `shards/<id>/shard-memory-summary.json`
- `shards/<id>/shard-observability.json`

当前这版的定位是：

- 先把 shard 级 cleaner / chunker / routing 的结果沉淀成稳定资产
- 让后续 `global merge` 有可消费输入
- 暂时不把 provider 驱动的 shard-level merge 引入主训练链路

### 2.0.2 Phase C scaffold 已接入

在 shard 资产之上，当前已经补上第一版全局合并层：

- `src/core/pipeline/global-merge.ts`
- `global-soul-seed.json`
- `global-memory-candidates.json`
- `global-conflicts.json`
- `training-seed.json`

当前这版的定位是：

- 先用规则层把跨 shard 的稳定信号、memory 候选、conflict lane 和 training seed 沉淀出来
- 让 `1000+` 语料验证可以先看见全局资产长什么样
- 暂时不把 cross-shard LLM merge 直接接进正式训练主链路

### 2.0.3 真实 corpus 验证脚本已补上

为了避免每次都手写临时 node 片段，当前已经补上可复用脚本：

- `scripts/build-twitter-corpus-assets.mjs`

这条脚本会把已抓取的 Twitter corpus 直接转成：

- `Corpus Snapshot`
- `Shard Distillation`
- `Global Merge`

并输出：

- `validation-summary.json`
- `global-soul-seed.json`
- `global-memory-candidates.json`
- `global-conflicts.json`
- `training-seed.json`

### 2.1 输入策略灰度开关

已经引入独立的输入策略维度：

- `legacy`
- `v2`

当前约束：

- 现有 `baseline / a1 / a2 / a3 / a4 / full` 训练档位语义保持不变。
- `create` / `train` 默认仍走保守路径，不强制切到 `v2`。
- `experiment` 已支持在同一 persona、同一 profile 下比较 `legacy` 和 `v2`。

这一步的价值是：我们可以验证新输入架构，而不污染现有培养主流程。

### 2.2 V2 证据路由升级

`src/core/pipeline/evidence-routing.ts` 已经从“按文本长度和基础质量做筛选”，升级为“面向证据语义做分流”。

当前已经落地的能力包括：

- 支持 `routeEvidenceItems(...)`
- 支持从 `EvidenceItem -> RawDocument-like input` 的兼容转换
- 引入证据感知评分因子：
  - `speaker_role`
  - `scene`
  - `stability_hints`
- 引入短文本 soul signal 支持，避免推文语料天然吃亏
- 引入语料级 gating，只有在“短文本主导”的 corpus 上才放宽短文本晋升规则

当前设计原则：

- `legacy` 保持“清洗后全部进 soul” 的保守语义
- `v2` 才做分流
- 新策略只动输入前处理，不侵入训练核心循环

### 2.3 Evidence Layer V1

已经新增统一证据层：

- `src/core/models/evidence.ts`
- `src/core/pipeline/evidence-layer.ts`
- `src/core/pipeline/ingestion/chat-stream.ts`

当前已经支持：

- `TargetManifest`
- `EvidenceItem`
- `EvidenceBatch`
- `SpeakerResolver`
- `SceneClassifier`
- 聊天流式预处理
- target-centered window 构建
- 视频 transcript evidence 兼容入口
- 中间资产落盘

V1 的真实定位不是“完整多模态理解”，而是先把复杂输入变成统一、可观测、可回溯的证据层。

补充进展：

- `EvidenceStats` 已经补上 `speaker_role_counts / scene_counts / modality_counts / source_type_counts`
- 这意味着聊天与视频输入在不改训练核心的前提下，已经可以先从“观测层”看清：
  - 目标说话占比
  - 场景分布
  - transcript 占比
  - 不同 source type 的混合情况

### 2.4 训练时运行时治理

已经补上针对真实实验暴露出来的 provider/runtime 问题的收紧：

- `src/core/training/runtime-tuning.ts`
- `src/core/training/strategy-resolver.ts`

当前已经做到：

- 把训练 runtime 变成明确的 preset，而不是隐式行为
- `robust` 路径提高了 persona / evaluator 的 timeout 与 retries
- 让策略解析器根据语料规模和 routing 策略，决定：
  - `runtimePreset`
  - `optimizationMode`
  - `evaluatorLayered`
  - `extractorConcurrency`
  - `extractionTimeout / retries`

这一步的意义很大：我们现在已经不是只比较 prompt 本身，而是在比较“输入策略 + 运行时治理”的整体效果。

### 2.5 实验与观测补强

已经扩展实验链路，支持把输入策略维度纳入对照：

- `src/testing/input-routing-ab-entry.ts`

当前新增了两层观测：

1. 输入观测
   - `raw_docs`
   - `clean_docs`
   - `chunks`
   - `soul_docs / memory_docs / discard_docs`
   - `promotion_candidates`
   - `filtered_low_quality_docs`

2. 运行时观测
   - `runtime_preset`
   - `optimization_mode`
   - `corpus_segment`
   - `trainerFallbacks`
   - `directorFallbacks`

这一步直接解决了之前一个大问题：过去我们只看到结果分数，现在开始能区分“策略本身退化”和“provider/runtime 波动”。

### 2.6 已修复的关键问题

已经确认并修复的关键问题包括：

1. A/B runner 的 persona slug 冲突
   - 之前并行实验时会撞 Qdrant collection
   - 现已通过随机后缀隔离

2. director fallback 提前终止训练
   - 早期 round 中 fallback 可能过早结束 loop
   - 已加入更保守的继续条件

3. chunker 对超长单段文本处理不够细
   - 已增强为按句子/字符预算进一步切分
   - 减少了 extractor 阶段的超时和卡顿

## 3. 当前已经验证到什么程度

基于最近几轮多回合 A/B，对当前代码的判断如下：

### 3.1 已验证成立的结论

1. `v2` 不是明显劣化路径
   - 在多个账号和多轮实验里，`v2` 总体具备竞争力，且多次优于 `legacy`

2. `v2` 的优势主要来自输入层质量控制
   - 它能把更稳定、归因更强的证据优先送入 soul
   - 同时把上下文性或短期性内容留在 memory

3. 单次回归不能直接视为架构失败
   - 部分回归已被证明更接近 provider/runtime 噪音，而非 `v2` 路由崩溃

4. 轻量 prompt / 轻量 feedback 目前不适合作为默认主路径
   - 它们在少数场景下更快，但在质量上不够稳
   - 目前应保留为实验分支，不进入默认 `robust` 路径

### 3.2 已有代表性结果

已有代表性实验结果显示：

- `karpathy` 3 轮：`v2` 高于 `legacy`
- `elonmusk` 3 轮：多次重复后，`v2` 均值具备竞争力，单次回撤与 fallback 噪音相关
- `turingou` 3 轮：`v2` 明显优于 `legacy`

因此当前不能得出“V2 不适合当前项目”的结论。更准确的说法是：

> V2 已经具备价值，但还没有完成“大语料规模下的稳定收敛验证”。

### 3.3 2026-04-03 最新 Phase A-C 结果

本轮新增了三个重要验证结果：

1. `Phase A`：实验通道已经被真正打通
   - Node 运行环境已恢复
   - A/B runner 已补上 extraction 阶段超时边界
   - A/B runner 已补上“单策略失败不拖垮整轮实验”的容错

2. `Phase B`：Twitter 语料扩展能力已增强
   - `scripts/fetch-twitter-corpus.mjs` 已支持 checkpoint / resume
   - 已成功抓到：
     - `karpathy` 65 条 corpus
     - `karpathy` 122 条 corpus

3. `Phase C`：中规模语料下出现了更清晰的 `v2` 优势
   - 在 `karpathy` 65 条、`DeepSeek + robust`、2 轮条件下：
     - `legacy = 0.90`
     - `v2 = 0.875`
     - 结论：中等偏小语料时，两者差距还不稳定
   - 在 `karpathy` 122 条、`DeepSeek + robust`、2 轮条件下：
     - `legacy = 0.875`
     - `v2 = 0.91`
     - contradiction / duplication 均为 `0`
     - coverage 相同，均为 `0.4`
     - 结论：当语料跨过 `medium corpus` 边界后，`v2` 开始展现更明确的优势

这说明一个很关键的趋势：

> `v2` 的价值更可能在中等及以上规模语料上释放，而不是在很小的 corpus 上就稳定领先。

### 3.5 2026-04-03 最新 Kimi 默认路径结果

在继续收紧 `Kimi` 的 extraction/runtime 策略后，又补充了两组更贴近默认路径的结果：

1. `karpathy`，122 条，`Kimi + robust + full + 1 round`
   - `legacy = 0.86`
   - `v2 = 0.93`
   - 结果文件：
     - `/tmp/ab_karpathy_122_kimi_1round.json`

2. `op7418`，337 条，`Kimi + robust + full + 1 round`
   - `legacy = 0.81`
   - `v2 = 0.91`
   - contradiction / duplication 仍然为 `0`
   - 结果文件：
     - `/tmp/ab_op7418_337_kimi_1round.json`

同时也验证到一个中间态：

- `op7418`，121 条，在旧的 Kimi extraction 策略下会在 extraction 阶段超时
- 在收紧 extraction 并发、chunk 数、prompt 长度和总超时估算后，同一账号的大语料版本已可以正常完成对照

这说明当前这轮 Kimi 治理是有效的，至少已经把：

- “大语料下 extraction 先卡死”

推进到了：

- “大语料下可以稳定跑出可比较结果”

### 3.7 最新 2 round 观察

继续把同一路径推到 `2 round` 后，观察到一个新的阶段性现象：

1. `op7418`，337 条，`Kimi + robust + full + 2 rounds`
   - `legacy` 在 `300000ms` 总超时内未完成

### 3.8 2026-04-04 真实 corpus 资产验证

本轮第一次把新输入架构直接跑在真实 `karpathy` corpus 上做资产验证，而不是只跑合成测试。

真实抓取结果：

- corpus 文件：`artifacts/karpathy-120.json`
- 实际抓取量：`121` 条推文
- 时间范围：`2025-02-12` 到 `2025-03-31`
- shard 数：`2`

先观察到的一个真实问题：

- 第一版 `global merge` 的稳定关键词会被通用词污染，出现 `and / the / for / but`

随后已经做了三轮治理：

 - 扩充 stopwords
 - 过滤纯数字/年份
 - 对英文短 token 增加更严格过滤，只保留必要的短领域词，如 `llm / api / gpu`
 - 增加 phrase anchor merge，让长短语先收敛成可跨 shard 复用的主题锚点
 - 把 global conflict 从“变体出现次数”改为“独立证据单元”计数，减少冲突噪声
 - 在 stable signals 之上新增 `topic cluster` 层，把同一主题的 phrase / keyword 合并成一个稳定 topic

治理后的真实结果：

1. `v2`
   - `stable_signal_count = 4`
   - `topic_cluster_count = 1`
   - `memory_candidate_count = 12`
   - `conflict_count = 4`
   - `stable_keywords = [llm attention, llm, attention, human]`
   - `stable_topics = [llm attention]`
   - 输出目录：`artifacts/real-validation-karpathy-v2`

2. `legacy`
   - `stable_signal_count = 1`
   - `topic_cluster_count = 1`
   - `memory_candidate_count = 0`
   - `conflict_count = 1`
   - `stable_keywords = [agree]`
   - `stable_topics = [agree]`
   - 输出目录：`artifacts/real-validation-karpathy-legacy`

当前判断：

- `v2` 在真实 corpus 上，已经比 `legacy` 更接近“可解释的局部稳定信号”，并且已经开始形成真正的 topic cluster
- 当前的 cluster 还偏轻量规则聚合，不是最终的 semantic topic merge，因此下一步仍不该急着把 `training-seed` 接进正式训练

### 3.9 2026-04-04 扩展到 258 条真实 corpus 的 topic cluster 结果

为了避免继续等待稀疏抓取，本轮直接复用了历史抓取混合料 `/tmp/karpathy-320-adaptive.json`，过滤出：

- `karpathy = 258` 条
- 时间范围：`2024-04-07` 到 `2026-03-31`
- 输出 corpus：`artifacts/karpathy-258.json`

在这组更大的真实 corpus 上，`topic cluster` 的差异开始更明显：

1. `v2`
   - 输出目录：`artifacts/real-validation-karpathy-258-v2`
   - `docs = 258`
   - `shards = 6`
   - `stable_signal_count = 15`
   - `topic_cluster_count = 3`
   - `memory_candidate_count = 35`
   - `conflict_count = 8`
   - `stable_topics = [llm training, model, prompt]`

   代表性 cluster：

   - `llm training`
   - `model`
   - `prompt`

2. `legacy`
   - 输出目录：`artifacts/real-validation-karpathy-258-legacy`
   - `docs = 258`
   - `shards = 6`
   - `stable_signal_count = 13`
   - `topic_cluster_count = 2`
   - `memory_candidate_count = 0`
   - `conflict_count = 11`
   - `stable_topics = [llm training, data]`

当前判断：

- 当 corpus 从 `121` 扩到 `258` 后，`v2` 开始稳定长出多主题结构，而不再只是单个 topic
- `legacy` 也能形成 cluster，但更容易把训练/数据类内容糊成更粗糙的集合
- `v2` 的 topic cluster 已经初步体现出“主题分层能力”，这说明输入路由与全局合并的协同正在起作用
   - `v2` 可以完成，但 `avg_quality = 0.49`
   - 结果文件：
     - `/tmp/ab_op7418_337_kimi_2rounds.json`

2. `karpathy`，325 条，`Kimi + robust + full + 2 rounds`
   - 在 `300000ms` 下：
     - `legacy` 可完成，`avg_quality = 0.91`
     - `v2` 超时
     - 结果文件：
       - `/tmp/ab_karpathy_276_kimi_2rounds.json`
   - 在 `420000ms` 下再次复验：
     - `legacy` 与 `v2` 都未在上限内完成
     - 结果文件：
       - `/tmp/ab_karpathy_325_kimi_2rounds_420s.json`

当前解释更偏向于：

- `1 round`：当前 `Kimi + v2` 已经具备可比较、且多次占优的能力
- `2 round`：在 `300+` 级别语料上，默认 `Kimi` 仍存在显著的时延和稳定性边界

也就是说，当前这轮优化已经把问题从：

- “大语料直接跑不通”

推进到：

- “大语料 1 round 可稳定比较，2 round 开始暴露 provider/runtime 边界”

### 3.8 Kimi 2 round 稳定性治理复验

在确认 `2 round` 的核心问题更像是 provider/runtime 边界后，本轮进一步把治理策略拆成了可对照模式：

- `standard`
- `tight_runtime`
- `sparse_director`
- `hybrid`

其中：

- `tight_runtime`：收紧 trainer / evaluator / director prompt 与 timeout，并关闭 evaluator dual-review
- `sparse_director`：只在最终 round 做完整 director 审查，前面 round 走 heuristic skip
- `hybrid`：同时应用 `tight_runtime + sparse_director`

为了避免“前一个超时模式还在后台继续跑，污染后一个模式”的问题，本轮额外新增了**隔离实验器**：

- `src/testing/kimi-stability-entry.ts`
- `src/testing/kimi-stability-suite-entry.ts`

其中 suite 版本会为每个 mode 单独起进程，避免 timeout 后的幽灵任务继续占用 provider 配额。

隔离复验结果如下：

1. `op7418`，337 条，`Kimi + v2 + full + 2 rounds + 180000ms`
   - `standard`
     - 超时
   - `tight_runtime`
     - 超时
   - `sparse_director`
     - 超时
   - `hybrid`
     - 完成
     - `elapsed_ms = 149201`
     - `avg_quality = 0.628`
     - `coverage = 0.400`
   - 结果文件：
     - `/tmp/kimi_stability_op7418_v2_standard_hybrid_isolated.json`
     - `/tmp/kimi_stability_op7418_v2_tight_sparse_isolated.json`

2. `karpathy`，325 条，`Kimi + v2 + full + 2 rounds + 180000ms`
   - `standard`
     - 超时
   - `hybrid`
     - 完成
     - `elapsed_ms = 163341`
     - `avg_quality = 0.785`
     - `coverage = 0.400`
   - 结果文件：
     - `/tmp/kimi_stability_karpathy_v2_standard_hybrid_isolated.json`

当前可以更有把握地说：

- `standard`：在 `300+` 级别公开推文语料上，`Kimi + v2 + 2 round` 仍然很容易撞上时延上限
- `tight_runtime`：单独收紧 prompt / timeout 和关闭 dual-review 还不够
- `sparse_director`：单独减少 director 频率也还不够
- `hybrid`：已经在两个不同风格账号上都把 `2 round` 拉回到了可完成区间
- 当前最值得保留的治理方向，不是单独收紧某个点，而是：
  - evaluator 降成本
  - director 降频
  - 允许必要 fallback
  三者组合

也就是说，本轮结论已经从：

- “2 round 会不稳定”

推进到：

- “2 round 在 Kimi 上不是完全跑不通，而是需要专门的 cadence 治理；当前 `hybrid` 是最有希望的候选路径”

### 3.9 `hybrid` 下的 `legacy vs v2` 复验

在把 `hybrid` 接进正式训练执行设置后，本轮继续做了一个更细的对照：

- 不再比较治理模式
- 固定 `hybrid`
- 只比较 `legacy` 和 `v2` 在不同账号上的表现

结果如下：

1. `op7418`，337 条，`Kimi + hybrid + full + 2 rounds + 180000ms`
   - `legacy`
     - 超时
     - 结果文件：
       - `/tmp/kimi_hybrid_op7418_legacy_2round.json`
   - `v2`
     - 一次重跑中遭遇 provider `Connection error`
     - 再次重跑后完成
     - `elapsed_ms = 145787`
     - `avg_quality = 0.684`
     - `coverage = 0.400`
     - 结果文件：
       - `/tmp/kimi_hybrid_op7418_v2_2round_rerun.json`
       - `/tmp/kimi_hybrid_op7418_v2_2round_rerun2.json`

2. `karpathy`，325 条，`Kimi + hybrid + full + 2 rounds + 180000ms`
   - `legacy`
     - 完成
     - `elapsed_ms = 168464`
     - `avg_quality = 0.830`
     - `coverage = 0.400`
     - 结果文件：
       - `/tmp/kimi_hybrid_karpathy_legacy_2round.json`
   - `v2`
     - 完成
     - `elapsed_ms = 163341`
     - `avg_quality = 0.785`
     - `coverage = 0.400`
     - 结果文件：
       - `/tmp/kimi_stability_karpathy_v2_standard_hybrid_isolated.json`

这轮结果非常说明问题：

- `hybrid` 不是“无脑让 v2 永远赢”
- `op7418` 这种高密度语料账号：
  - `v2 + hybrid` 更容易被拉回可完成区间
  - `legacy + hybrid` 仍然偏重，容易超时
- `karpathy` 这种高质量但更稀疏的账号：
  - `legacy + hybrid` 和 `v2 + hybrid` 都可完成
  - 且这轮 `legacy` 的质量分数更高

这意味着当前更合理的理解是：

- **治理层最优**：当前 `hybrid` 是 Kimi 二 round 的最佳候选
- **输入策略最优**：还不是全局唯一答案，更像“按语料形态选择局部最优”

也就是说，下一阶段不该追求：

- “所有账号都默认切到同一条输入策略”

而应该继续逼近：

- “什么类型的 corpus 更适合 `legacy + hybrid`”
- “什么类型的 corpus 更适合 `v2 + hybrid`”

### 3.10 Corpus Shape 推荐器

基于上面的结果，本轮进一步把“局部最优”抽成了一个显式推荐器：

- `recommendInputRoutingStrategy()`
- 位置：
  - `src/core/training/strategy-resolver.ts`

当前不是直接自动切路由，而是先输出：

- `recommendedStrategy`
- `shape`
- `confidence`
- 可解释 metrics

当前启发式主要看：

- `v2SoulRetention`
- `v2MemoryRetention`
- `v2DiscardRatio`
- `v2ChunkCompression`
- `legacyChunkLoad / v2ChunkLoad`

在真实语料上的验证结果：

1. `op7418`
   - 推荐：`v2`
   - shape：`dense_noisy_stream`
   - confidence：`0.86`
   - 原因：
     - `v2` 对 chunk 负载压缩非常明显
     - `v2` 丢掉了大量低信号内容
     - 与真实实验里 `op7418` 更适合 `v2 + hybrid` 的结论一致

2. `karpathy`
   - 推荐：`legacy`
   - shape：`high_signal_archive`
   - confidence：`0.80`
   - 原因：
     - `v2` 实际保留了大多数内容
     - 说明 corpus 本身已经比较高信号
     - 与真实实验里 `karpathy` 上 `legacy + hybrid` 质量更高的现象一致

这意味着：

- 当前已经不只是“观察上觉得像局部最优”
- 而是已经有了一个可以继续迭代的数据驱动推荐入口

下一步可以继续做两件事：

1. 在 `experiment --compare-input-routing` 中把 recommendation 长期记录到报告里
2. 当样本足够多后，再决定是否让 recommendation 进入自动路由选择

### 3.6 大语料采集当前边界

本轮继续扩语料时，也观察到两个事实：

1. `op7418` 已成功扩到 `337` 条，适合作为当前的高密度大语料验证账号
2. `karpathy` 已扩到 `256` 条，但继续往更早时间窗口推进时，公开可见内容明显稀疏

这意味着：

- `karpathy` 更像“高质量但历史可见性有限”的账号
- `op7418` 更像“高密度、适合做大语料压力验证”的账号
- 当前要继续冲 `300+`，需要接受“并不是所有目标账号都能单靠公开检索稳定打满”

### 3.4 当前 provider 结论

本轮还顺带验证了 provider 状态：

- `Kimi`：可用，但在 extraction / training 阶段仍有明显抖动
- `Claude`：当前 key 无效，只能依赖 fallback，不能作为干净实验基线
- `OpenAI`：当前 key 无效，且 embedding 也会回退
- `DeepSeek`：当前最适合作为本地实验基线 provider

当前建议：

- 后续 A/B 优先使用 `DeepSeek` 做实验基线
- `Kimi` 继续保留为主产品路径候选，但不要作为当前阶段唯一实验通道

## 4. 当前真正的瓶颈

现在最值得正视的，不是 schema 够不够漂亮，而是下面几个工程瓶颈。

### 4.1 Provider / runtime 波动仍然会污染实验判断

虽然已经补了 fallback 观测，但真实训练仍会受到：

- 模型偶发超时
- 结构化输出不稳定
- 评估器长度/格式漂移
- director fallback 波动

影响。

这意味着：

- 单次实验结果不能作为最终结论
- 必须以多次重复实验的均值和波动带来判断策略优劣

本轮还额外确认了一个更隐蔽的问题：

- 如果实验器只是在当前进程里用 `Promise.race` 做 timeout，而不真正隔离模式运行
- 那么超时模式底层的训练任务可能仍然继续占用 provider 资源
- 进而污染后续 mode 的时延与 fallback 统计

所以现在实验编排也需要被当成“结果可信度”的一部分来治理，而不是只看训练逻辑本身。

### 4.2 真正的大语料还没有稳定拿到

当前我们已经开始往更大语料推进，并新增了自适应抓取脚本：

- `scripts/fetch-twitter-corpus.mjs`

但目前瓶颈仍在采集侧：

- 大窗口查询容易被截断
- 某些账号历史内容可见性有限
- 实际拿到的条数可能低于目标条数

这意味着：

- 当前很多“1000 条级验证”的难点，未必出在训练架构，而可能先卡在语料获取

### 4.3 大语料下的最优策略不是全局单一策略

当前越来越清楚的一点是：

- 小语料
- 中语料
- 大语料

适合的局部最优策略并不完全相同。

比较可能的阶段差异：

1. 小语料：更怕误杀，策略宜保守
2. 中语料：适合开始做清晰的 soul / memory 分层
3. 大语料：必须强化路由、抽取限流、优先级排序和运行时治理

所以后续不应追求“一个万能参数打天下”，而应追求“分阶段策略解析”。

## 5. 当前优化方向

下面是当前建议继续推进的方向，按优先级排序。

### 5.1 方向一：先稳住 V2 默认最佳路径

当前主路径建议保持：

- 输入策略：`v2`
- 运行时：`robust`
- `1 round`：继续保持当前主路径
- `2 round + Kimi`：优先走 `hybrid` 治理候选，而不是继续硬顶 `standard`

接下来要做的不是继续大改 prompt，而是继续收紧：

- fallback 波动
- 提取超时
- 大 chunk 压力
- 大语料下的 soul slice 优先级
- `2 round` 下的 evaluator / director cadence

目标是把 `v2` 的“平均更好”尽量变成“更稳定地更好”。

### 5.2 方向二：扩大真实语料规模

下一阶段实验的关键，不是继续只拿 8~12 条推文做判断，而是尽量逼近：

- 300 条
- 1000 条
- 更高规模

这里的工作重点应放在：

- 自适应抓取
- 分时间窗口回填
- 可恢复抓取
- 对抓取覆盖率做显式统计

因为如果原始 corpus 不足，后面的路由和训练比较会被误导。

### 5.3 方向三：把“阶段性最优”做成显式策略

当前 `strategy-resolver` 已经是雏形，后续可以继续演进为：

- 按 corpus scale 选 runtime
- 按 routing 结果决定 extractor 并发和 chunk 优先级
- 按证据分布决定是否启用更强评估模式

也就是说，优化方向不是“所有场景统一变复杂”，而是：

> 在需要的阶段启用合适的复杂度。

### 5.4 方向四：让 Evidence Layer 成为未来多输入的统一底座

这条线暂时不应该抢主节奏，但必须持续推进，因为它决定未来上限。

当前定位建议：

1. 推文：继续作为短文本公开语料主入口
2. 聊天：优先支持 GB 级流式预处理和 target-centered 窗口
3. 视频：先停留在 transcript + diarization-ready，不急着做完整视觉理解

这意味着：

- 近期主验证仍以 Twitter 为主
- Evidence Layer 继续向前做，但先以“兼容未来输入”为目标，不急着在本周完成所有高级能力

## 6. 当前不建议做的事情

为了避免再次把判断做乱，当前阶段不建议：

1. 直接把 `v2` 改成所有命令默认
2. 在没有更大语料前，就频繁重写训练核心架构
3. 因为单次回归就否定 `v2`
4. 把轻量 prompt 方案直接合入默认路径
5. 一边扩输入类型，一边大改训练核心，导致变量同时变化

## 7. 建议的下一步执行顺序

### Phase A：收紧现有最优路径

目标：

- 继续稳定 `v2 + robust`
- 让 fallback 和超时噪音进一步下降

输出：

- 一组更稳定的多次重复实验结果

### Phase B：扩大语料获取能力

目标：

- 拿到更接近真实上限的 Twitter corpus
- 至少验证到 `300~1000` 级别

输出：

- 可复用的更大 corpus
- 覆盖率说明

### Phase C：在大语料上重跑 A/B

目标：

- 比较 `legacy` vs `v2`
- 比较不同 runtime / optimization 组合
- 判断哪些能力该进入默认路径

输出：

- 更可信的 A/B 报告
- 面向大语料的默认策略建议

### Phase D：继续推进 Evidence Layer

目标：

- 让聊天和视频输入能力继续变强
- 但不影响当前 Twitter 主实验线

输出：

- 多输入统一底座继续成熟

## 8. 当前统一判断

如果只用一句话概括当前阶段：

> 架构方向没有跑偏，V2 和 Evidence Layer 都值得保留；现在更关键的是先把稳定性、观测和大语料验证做扎实，再决定哪些策略进入默认路径。

这也是接下来继续实验和优化时的统一依据。
