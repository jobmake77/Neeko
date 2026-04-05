# 大语料稳定蒸馏实施方案

更新时间：2026-04-04

## 1. 目标

本方案面向 `1000+` 级别公开语料，目标不是“勉强跑通”，而是同时保证：

1. 稳定性：中途策略变化不污染当前运行，失败可恢复
2. 安全性：冲突、私密、短期情绪等内容不越权进入 soul
3. 整体性：推文、聊天、视频最终进入统一的证据蒸馏框架
4. 可扩展性：后续从 `300+` 扩到 `1000+ / 5000+` 时，不需要推翻当前架构

本方案先落地推文语料，但设计上会兼容聊天与视频输入。

---

## 2. 设计结论

大语料不应直接“全量进入训练”，而应走四段式链路：

1. `Corpus Snapshot`
2. `Run Manifest Freeze`
3. `Shard Distillation`
4. `Global Merge -> Final Training`

也就是说：

- 原始大语料只进入分区蒸馏
- 训练循环只消费全局 seed，而不是直接消费 1000+ 原始文本

---

## 3. 系统分层

### 3.1 Corpus Layer

职责：

- 输入获取
- 去重与快照
- 分区规划
- 运行计划冻结

资产：

- `corpus-snapshot.json`
- `shard-plan.json`
- `input-run-manifest.json`
- `shards/<id>/raw-docs.json`
- `shards/<id>/meta.json`

### 3.2 Evidence Distillation Layer

职责：

- shard 级 cleaner / chunker / routing
- shard 级 soul summary / memory summary
- shard 级 observability

资产：

- `shards/<id>/shard-soul-summary.json`
- `shards/<id>/shard-memory-summary.json`
- `shards/<id>/shard-observability.json`

### 3.3 Persona Training Layer

职责：

- global merge
- stable memory candidate selection
- final training seed build
- training loop

资产：

- `global-soul-seed.json`
- `global-memory-candidates.json`
- `global-conflicts.json`
- `training-seed.json`

---

## 4. Phase 划分

### Phase A：稳定性底座

必须先做：

1. `corpus snapshot`
2. `run manifest freeze`
3. `shard plan`
4. `shard raw corpus materialization`
5. `checkpoint / resume` 基础约束

### Phase B：大语料蒸馏

继续做：

1. shard 级蒸馏
2. shard 资产落盘
3. shard 失败可局部重跑

当前已落地的 scaffold：

- `shards/<id>/shard-soul-summary.json`
- `shards/<id>/shard-memory-summary.json`
- `shards/<id>/shard-observability.json`

当前仍未落地的部分：

- provider 驱动的 shard-level soul merge
- shard 失败后的显式 resume orchestration
- cross-shard stable merge

### Phase C：全局合并

继续做：

1. cross-shard stability merge
2. conflict set / quarantine lane
3. training seed build

当前已落地的 scaffold：

- `global-soul-seed.json`
- `global-memory-candidates.json`
- `global-conflicts.json`
- `training-seed.json`

当前仍未落地的部分：

- provider 驱动的 cross-shard semantic merge
- seed quality gate 与训练入口联动
- 基于 conflict lane 的自动回放/复核策略

### Phase D：自动化策略升级

样本足够后再做：

1. corpus-shape recommendation 自动接入
2. auto routing recommendation
3. auto shard sizing

---

## 5. 核心稳定性规则

### 5.1 运行计划冻结

每次正式运行前生成 `input-run-manifest.json`，冻结以下内容：

- corpus snapshot hash
- selected input routing strategy
- recommended input routing strategy
- selected kimi stability mode
- provider
- shard 规划
- 版本信息
  - routing version
  - extractor prompt version
  - shard plan version
  - merge rule version

规则：

- 一旦本轮开始，中途不允许改这些内容
- 新策略只能影响下一轮 run

### 5.2 失败恢复

必须支持：

- shard 级失败重跑
- merge 前失败恢复
- training 前失败恢复

恢复粒度：

- 不重做整个 corpus
- 只重做受影响 shard 或受影响阶段

### 5.3 provider 隔离

每个高成本阶段都应可隔离执行：

- extraction
- shard distillation
- training round

要求：

- timeout 后能真正终止子任务
- provider failure 与 strategy failure 分开记录

---

## 6. 核心安全规则

### 6.1 不稳定信号不能直接写入 soul

以下内容默认不直接进入全局 soul：

- 单 shard 独有且未复现的信号
- 纯短期情绪
- 强冲突未决信号
- intimate / conflict 场景内容

### 6.2 conflict 进入隔离通道

冲突信号进入：

- `global-conflicts.json`
- `quarantine lane`

而不是直接覆盖已有人格主干。

### 6.3 private / intimate 输入边界

当前规则保持：

- `public/work`：可进入 soul / memory
- `private`：默认 memory
- `intimate/conflict`：默认不直接进入 soul

---

## 7. 大语料分区策略

### 7.1 为什么必须分区

如果 1000+ 推文直接统一进入训练，会带来：

- token 压力过大
- provider 时延失控
- 重复主题污染
- 局部失败全局作废

### 7.2 默认切分规则

推文默认按：

- 时间连续性
- 文档数量上限
- 估算 token / chunk 负载

综合切分。

默认参数建议：

- `target_docs_per_shard = 200~250`
- `max_docs_per_shard = 300`
- `target_window_days = 30~60`
- `max_estimated_chunks_per_shard` 设上限

### 7.3 shard 规划目标

不同 shard 应尽量满足：

- 时间上局部连续
- 负载尽量均衡
- 失败可独立重跑

---

## 8. 合并策略

### 8.1 shard -> global merge 原则

全局 soul 只吸纳：

- cross-shard stable
- confidence 达标
- 非冲突
- 非短期态

### 8.2 合并中的升权与降权

升权：

- 跨 shard 重复出现
- 长时间跨度重复出现
- 在高质量 shard 中稳定出现

降权：

- 只出现在单 shard
- 只在短期热点窗口出现
- 场景风险高

### 8.3 保留边缘信号

不能把 merge 做成“只留主流信号”，否则会丢 nuance。

因此要保留：

- `stable_core`
- `nuanced_edge`
- `conflict_set`

三条并行资产线。

---

## 9. 推荐器策略

当前已落地：

- `recommendInputRoutingStrategy()`

定位：

- 先推荐
- 不自动切换默认策略

当前已经验证的两个语料形态：

1. `dense_noisy_stream`
   - 更偏向 `v2`
2. `high_signal_archive`
   - 更偏向 `legacy`

后续当样本足够，再考虑升级为自动切换。

---

## 10. 主要风险与对策

### 风险 1：时间偏置

问题：

- 最近两个月高频发文可能覆盖掉长期稳定人格

对策：

- time bucket weighting
- recent burst cap
- 历史窗口平衡

### 风险 2：重复主题污染

问题：

- 单个主题高频出现会扭曲 soul 权重

对策：

- topic clustering
- near-duplicate collapse
- per-topic contribution cap

### 风险 3：provider 抖动误导实验判断

问题：

- timeout / connection error 会让策略看起来退化

对策：

- isolated runs
- provider failure tagging
- repeated rerun on winner path

### 风险 4：缓存污染

问题：

- 老缓存可能混入新实验

对策：

- cache version pinning
- corpus hash pinning

### 风险 5：策略中途漂移

问题：

- 中途切换 routing/runtime 会污染当前 run

对策：

- input run manifest freeze
- only next run may adopt new strategy

---

## 11. 当前实施顺序

### Step 1

- `corpus-snapshot.json`
- `shard-plan.json`
- `input-run-manifest.json`

### Step 2

- shard 级蒸馏 worker
- shard 级资产落盘

### Step 3

- global merge
- training seed build

### Step 4

- recommendation 写入正式 report
- recommendation 与真实效果做长期校准

---

## 12. 当前验收标准

### 稳定性

- 同一 snapshot 重跑口径一致
- 中途策略修改不影响当前 run
- shard 失败可局部恢复

### 安全性

- conflict 不直接进入 soul
- private/intimate/conflict 不越权
- rollback path 清晰

### 整体性

- 推文链路与聊天/视频未来兼容
- shard / merge / training seed 资产边界清晰

### 性能

- 1000+ 推文可完成 snapshot 与 shard plan
- 不依赖一次性把全量文本塞进训练
