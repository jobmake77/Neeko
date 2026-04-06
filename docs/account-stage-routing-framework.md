# 账号分型与阶段分型路由框架

更新时间：2026-04-06

关联文档：

- [输入架构阶段总结](/Users/a77/Desktop/Neeko/docs/input-architecture-status.md)
- [大语料扩展优化路线图](/Users/a77/Desktop/Neeko/docs/large-corpus-roadmap.md)
- [Neeko 系统 V1 正式定义](/Users/a77/Desktop/Neeko/docs/system-v1.md)
- [Dynamic Evidence Scaling Framework](/Users/a77/Desktop/Neeko/docs/dynamic-evidence-scaling-framework.md)

## 1. 为什么需要这份规则

当前真实实验已经证明一件事：

- `v2 + off` 不是对所有账号、所有语料规模都稳定更优
- `legacy + off` 也不是在所有大样本阶段都一定最好

代表性结果：

- `karpathy-4335-validation`
  - `legacy + off`：三轮均值 `0.9167 / 0.5340`
  - `v2 + off`：三轮均值 `0.9233 / 0.5347`
- `paulg-1296-validation`
  - `legacy + off`：三轮均值 `0.9033 / 0.5326`
  - `v2 + off`：三轮均值 `0.8967 / 0.5319`
- `paulg-1503-validation`
  - 四轮 clean 均值 `legacy + off = 0.888 / 0.548`
  - 四轮 clean 均值 `v2 + off = 0.895 / 0.541`
  - 四轮 clean 均值 `v2 + signals = 0.895 / 0.532`
  - `v2 + off` 第二轮曾出现 timeout 污染异常值 `0.15 / 0.3135`，现已在 aggregate 层自动隔离

因此系统不应该继续寻找“一个全局最优 routing 策略”，而应该升级为：

- 先判断账号类型
- 再判断当前语料阶段
- 最后选择合适的 routing 组合

## 2. 核心定义

### 2.1 账号分型

账号分型回答的问题是：

- 这个账号的公开语料，更像“稳定人格表达流”还是“混合评论流”？
- 长期稳定信号是否足够多？
- `Soul / Memory / Discard` 分层是否真的有价值？

### 2.2 阶段分型

阶段分型回答的问题是：

- 当前语料规模和信号成熟度处在什么阶段？
- 这个阶段适不适合加强 routing 选择性？
- 是该继续扩容，还是该先稳态蒸馏？

### 2.3 目标

这套框架的目标不是追求静态最优，而是让系统具备：

- 按账号类型动态选策略
- 按语料阶段动态选策略
- 把 provider/runtime 异常和策略真实退化分开

## 3. 账号类型

### 3.1 Type A：稳定人格表达型

特征：

- 长时间跨度内存在重复出现的稳定观点
- 价值判断、偏好、方法论表达较多
- 同主题跨 session 或跨时间重复出现
- `Soul / Memory / Discard` 分层后，`soul` 仍能保留足够密度

目前更接近这个类型的样本：

- `karpathy`

默认策略倾向：

- 安全默认仍可保留 `legacy + off`
- 灰度优先观察 `v2 + off`
- 如果大样本多轮下 `v2 + off` 均值持续领先，可在该账号类型内局部升级

### 3.2 Type B：高频混合评论型

特征：

- 高频评论、短期事件反应、转述、判断混杂
- 短文本密度高，但长期稳定人格信号未必高
- `v2` 分流后，可能把一部分“其实有用但不够稳定”的内容压到 `memory/discard`
- `legacy` 往往更稳，或者 `signals` 偶尔会更好

目前更接近这个类型的样本：

- `paulg`

默认策略倾向：

- 优先保持 `legacy + off`
- `v2 + off` 只作为灰度观察，不应直接升级
- 若 `signals` 在更大样本多轮下稳定优于 `legacy/off`，再考虑单独开分支验证

### 3.3 Type C：结构未定型账号

特征：

- 公开语料量还不够
- 稳定信号不足
- 多轮实验结果方差大
- 很难判断究竟是账号结构问题还是 provider 噪声问题

策略倾向：

- 保守使用 `legacy + off`
- 优先继续扩容
- 不急于启用更强选择性的 routing

## 4. 阶段类型

注意：阶段不是按固定条数硬切，而是按观测指标切。

### 4.1 Stage E：Early Explore

常见表现：

- 语料规模较小或刚进入中等规模
- stable signals 还在快速增长
- duplication/conflict/runtime 压力不高
- recommendation 稳定为 `explore -> continue_expand`

策略倾向：

- 优先继续扩容
- routing 以保守为主
- 不要因为早期单轮优势就改默认

### 4.2 Stage M：Mixed Growth

常见表现：

- stable signals 继续增长，但增长开始放缓
- `stable_signal_growth_plateau` 开始出现
- `Soul / Memory / Discard` 分层价值开始显现，但还不稳定
- 不同 routing 组合开始分化

策略倾向：

- 这是最适合做 `legacy vs v2` PK 的阶段
- 可以开始引入账号分型
- 仍不建议全局切默认

### 4.3 Stage D：Dense Large-Corpus

常见表现：

- 大样本语料已形成较强人格密度
- 多轮 PK 有能力给出均值趋势
- recommendation 仍可能是 `explore -> continue_expand`
- 但 provider/runtime 污染开始更值得关注

策略倾向：

- 优先看多轮均值，不看单轮最优
- 必须隔离 timeout/fallback 污染 run
- 允许按账号类型做局部策略分化

### 4.4 Stage N：Noise-Limited

常见表现：

- 不是语料价值不够，而是 provider/runtime 波动开始污染结论
- 出现异常值，例如：
  - timeout
  - fallback contamination
  - 明显异常低分

策略倾向：

- 先隔离异常 run
- 再看 clean runs mean
- 不把异常值直接当作 routing 退化

## 5. 决策输入

这套框架建议使用以下输入做决策：

- `stable_signal_count`
- `topic_cluster_count`
- `memory_candidate_count`
- `conflict_count`
- `Soul / Memory / Discard` 分布
- `stable_topic_growth`
- `marginal_coverage_gain`
- `duplication_pressure`
- `conflict_pressure`
- `runtime_pressure`
- `seed_maturity`
- 多轮 PK 的 `quality / coverage`
- 是否存在 timeout/fallback 污染 run

## 6. 当前决策规则

### 6.1 全局规则

- 安全默认：`legacy + off`
- 推荐灰度线：`v2 + off`
- `signals`：继续 gated

### 6.2 账号类型规则

如果账号更接近 `Type A`：

- 优先观察 `v2 + off`
- 当大样本多轮 clean mean 持续领先时，可局部升级

如果账号更接近 `Type B`：

- 保守保持 `legacy + off`
- `v2 + off` 仅作灰度
- 必须等待更大样本或更多轮次再判断

如果账号仍是 `Type C`：

- 继续扩容
- 暂不做强结论

### 6.3 阶段规则

如果还在 `Stage E / Stage M`：

- 不改默认
- 先扩容，再做 A/B

如果进入 `Stage D`：

- 重点看多轮均值
- 允许局部策略分化

如果进入 `Stage N`：

- 先隔离异常 run
- 再判断 routing

## 7. 当前项目中的解释

截至目前，更准确的解释是：

- `karpathy`
  - 更接近 `Type A + Stage D`
  - `v2 + off` 已有增强信号
- `paulg`
  - 更接近 `Type B + Stage M/D`
  - `v2 + off` 尚未稳定复现优势
  - 在 `1503` 档还出现了 provider/runtime 污染，需要异常隔离

因此当前系统最合理的状态是：

- 全局仍保留 `legacy + off` 作为安全默认
- `v2 + off` 保留为灰度观察线
- 但内部判断已经升级为：
  - `v2 + off` 可能是账号分型和阶段分型相关的局部最优
  - 不是现在就能全局替换的默认最优

## 8. 实施建议

下一阶段建议把这套规则落成显式模块，而不是只写在文档里。

建议输出一个 `routing decision record`，至少包含：

- `account_type`
- `stage_type`
- `recommended_routing`
- `recommended_seed_mode`
- `confidence`
- `clean_run_count`
- `excluded_runs`
- `excluded_run_reasons`

### 8.1 异常隔离规则

以下情况建议直接标记为异常 run，不进入策略均值：

- 明确 timeout
- 明确 fallback contamination
- 明显脱离同档位其他结果的异常值
- 已通过同配置重跑恢复正常

### 8.2 升级条件

只有当以下条件成立时，才考虑把某条策略从灰度升级为更强推荐：

- 至少两个高密度账号支持同一结论
- 或同一账号在更大样本下多轮 clean mean 持续领先
- contradiction/duplication 不回归
- 没有被 provider/runtime 污染误导

## 9. 当前结论

这套框架当前给出的正式结论是：

- 现在不应该寻找全局唯一最优 routing
- 更应该建立“账号分型 + 阶段分型 + 异常隔离”的动态决策机制
- 当前仍然维持：
  - 安全默认：`legacy + off`
  - 灰度观察：`v2 + off`
  - `signals`：继续 gated
