# 输入架构与训练优化阶段总结

更新时间：2026-04-03

## 1. 当前阶段结论

当前项目不是只在做单一方向的优化，而是在并行推进两条线：

1. `V2 input routing`：针对大规模推文语料，优化 `Soul / Memory / Discard` 分流质量，减少噪音直接进入 soul。
2. `Evidence Layer V1`：把推文、聊天、视频统一提升为可归因、可分段、可评分的 `EvidenceItem`，为后续多模态培养打底。

这两条线的关系不是替代，而是分层：

- `Evidence Layer` 解决“输入如何标准化、怎么保留上下文和归因”。
- `V2 routing` 解决“标准化输入进入培养前，哪些该进 soul、哪些只该进 memory、哪些该丢弃”。

当前判断：这个方向是成立的，不需要回退到旧架构；但在真正扩大到更大语料前，需要先把稳定性和观测继续收紧。

## 2. 已经完成的步骤

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
