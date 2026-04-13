# 训练流程总览

更新时间：2026-04-13

## 1. 先给结论

当前训练流程不是传统的模型微调流程，而是一条“素材治理 + 人格资产蒸馏 + 训练循环 + 失败恢复”的本地训练链路。

它训练的对象不是底层大模型参数，而是：

- `Soul`
- `Memory`
- `Skill`
- `训练报告与中间资产`

## 2. 训练入口

当前训练有两个真实入口：

### 2.1 CLI

文件：[`src/cli/commands/train.ts`](/Users/a77/Desktop/Neeko/src/cli/commands/train.ts)

常见命令：

```bash
node dist/cli/index.js train <slug> --mode full
node dist/cli/index.js train <slug> --mode quick
node dist/cli/index.js train <slug> --rounds 3 --training-profile full
```

### 2.2 workbench-server / 桌面端

文件：[`src/core/workbench/service.ts`](/Users/a77/Desktop/Neeko/src/core/workbench/service.ts)

桌面端并不是重写了一套训练逻辑，而是通过 `workbench-server` 调用本地 CLI 训练命令。

## 3. 训练前准备阶段

开始训练前，会先做这些检查和准备：

1. 读取人格资产
   - `persona.json`
   - `soul.yaml`
2. 解析训练参数
   - `rounds`
   - `profile`
   - `track`
   - `inputRouting`
   - `trainingSeedMode`
   - `kimiStabilityMode`
3. 检查 Qdrant
4. 执行模型预检
   - 当前训练模型必须能通过 structured output 预检
5. 写入 `training-context.json`

这一步主要是保证：

- 向量库可用
- 模型能力达标
- 当前 persona 处于可训练状态

## 4. 训练前的素材治理

如果 persona 目录下存在原始语料缓存，训练前还会生成一批输入中间资产：

- `corpus snapshot`
- `shard plan`
- `input run manifest`
- `evidence packs`
- `adaptive shard plan`
- `dynamic scaling recommendation`
- `shard distillation`
- `global merge`

这些资产的作用不是直接对话，而是：

- 固定本轮训练的素材边界
- 为大语料训练做分片与恢复
- 提前得到全局 seed 和冲突线索

## 5. 训练编排器

当前编排器在：

- [`src/core/training/orchestrator.ts`](/Users/a77/Desktop/Neeko/src/core/training/orchestrator.ts)

当前训练是“按 track 串行执行”的。

如果是 `full_serial`，实际会跑两个 track：

1. `persona_extract`
2. `work_execute`

简单理解：

- `persona_extract`
  - 更偏人格结构与表达方式抽取
- `work_execute`
  - 更偏工作/执行场景下的人格稳定性验证

## 6. 单个 track 内部怎么跑

单个 track 的核心循环在：

- [`src/core/training/loop.ts`](/Users/a77/Desktop/Neeko/src/core/training/loop.ts)

每一轮主要有 5 步。

### 6.1 Trainer 出题

`TrainerAgent` 会基于这些信息生成本轮问题：

- 当前 `Soul`
- 低置信维度
- 上一轮 observability
- skill gap
- training seed hints

当前 question policy 会混合这些策略：

- `blind_spot`
- `stress_test`
- `consistency`
- `scenario`

### 6.2 Persona 回答

`PersonaAgent` 会以当前 persona 身份回答问题，并带上：

- memory retrieval
- 当前 soul prompt
- 相关 skill context

这一步产生训练时的 persona 回答样本。

### 6.3 Evaluator 评估

`EvaluatorAgent` 会对每条问答打分并给出裁定。

常见裁定结果：

- `write`
- `reinforce`
- `discard`
- `flag_contradiction`

评估时会看：

- 一致性
- 真实性
- 深度
- 综合质量

### 6.4 记忆治理

如果评估结果允许写入，就会进入 memory governance。

治理结果可能是：

- `write`
- `reinforce`
- `quarantine`
- `discard`

这一步是为了控制：

- 重复写入
- 低质量写入
- 冲突性写入
- 高风险人格污染

### 6.5 Director 审查与收敛判断

每轮最后由 `DirectorAgent` 做全局审查：

- 更新 `coverage_score`
- 更新部分 soul 字段
- 判断是否继续下一轮

然后再做 convergence check：

- 如果达到收敛条件，就结束
- 否则继续下一轮

## 7. 当前每轮会记录哪些指标

每轮训练现在会记录完整 observability。

典型指标包括：

- `avg_quality_score`
- `contradiction_rate`
- `duplication_rate`
- `low_confidence_coverage`
- `nodes_written`
- `nodes_reinforced`
- `new_high_value_memories`
- `quarantined_memories`
- `gap_focused_questions`
- `skill_trigger_precision`
- `skill_method_adherence`
- `skill_boundary_violation_rate`
- `skill_transfer_success_rate`
- `skill_set_change_rate`

这些会最终汇总到训练报告。

## 8. 训练结束后会写哪些资产

当前训练结束后最关键的落盘资产是：

- `training-context.json`
- `training-report.json`
- `checkpoint_index.json`
- `manifest.json`
- `error-ledger.json`
- `soul.yaml`
- `persona.json`

作用分别是：

- `training-context.json`
  - 当前训练状态与轮次进度
- `training-report.json`
  - round-level 指标与 summary
- `checkpoint_index.json`
  - 恢复训练的断点索引
- `manifest.json`
  - 当前训练编排的 track 运行记录
- `error-ledger.json`
  - 错误分类与恢复记录
- `soul.yaml`
  - 人格结构资产
- `persona.json`
  - persona 运行状态与摘要

## 9. 当前失败恢复怎么做

失败分类逻辑在：

- [`src/core/training/failure-loop.ts`](/Users/a77/Desktop/Neeko/src/core/training/failure-loop.ts)

会分类这些典型问题：

- `structured_output_failure`
- `generation_timeout`
- `transport_error`
- `evaluation_instability`
- `lock_stale`
- `data_conflict`
- `unknown`

恢复动作包括：

- `soft_retry`
- `heartbeat_renew`
- `stage_skip_with_flag`
- `resume_from_checkpoint`

workbench-service 还会根据日志尾部自动规划恢复：

- 自动延长超时
- 自动放宽 schema 模式
- 自动从 `latest checkpoint` 恢复

## 10. 当前客户端看到的培养进度从哪来

客户端培养中心展示的数据不是前端伪造的，而是从这些真实资产和配置推导出来：

- `persona.json`
- `training-context.json`
- `training-report.json`
- `skill summary`
- `evidence import` 统计
- `PersonaConfig.sources[]`

当前客户端培养中心展示的是用户可理解信息：

- 当前状态
- 进度百分比
- 当前轮次 / 总轮次
- 技能摘要
- 素材摘要
- 最近更新检查结果

## 11. 这条训练链路的边界

当前链路已经相当完整，但仍有明确边界：

### 11.1 它擅长什么

- 可恢复
- 可审计
- 可持续培养
- 可增量更新
- 适合多源素材治理
- 适合本地客户端 + CLI 共用

### 11.2 它不是什么

- 不是底层模型参数微调
- 不是一次性训练完就永久记住
- 不是完全摆脱外部资产的“真模型人格化”

## 12. 一句话总结

当前训练流程的本质是：

> 先把多源素材治理成统一证据和中间资产，再通过双轨训练循环持续更新 Soul 与 Memory，并用 checkpoint、失败治理和训练报告把整个过程变成可恢复、可审计、可继续培养的本地人格训练系统。
