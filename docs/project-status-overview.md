# 项目状态总览

更新时间：2026-04-13

## 1. 当前项目处于什么阶段

Neeko 当前已经从“培养链路打底”进入“客户端可用性 + 持续培养”阶段。

目前的主产品形态已经明确为：

- `桌面客户端（Tauri）`
- `CLI`
- `本地 workbench-server`

当前不再继续把新的 Web 页面作为主产品入口推进。

## 2. 当前主链路是什么

当前项目的主链路可以概括为：

1. 创建 persona
2. 为 persona 维护统一素材池
3. 把多源素材整理成统一证据对象
4. 运行训练循环，持续培养 persona
5. 在聊天中安全使用训练结果
6. 持续检查更新，做增量继续培养

对应的产品入口是：

- `聊天`
- `人格库`
- `设置`

## 3. 当前仓库的真实结构

### 3.1 桌面端

- `desktop/src/App.tsx`
  - 当前桌面主壳
- `desktop/src/stores/app.ts`
  - 全局壳层状态
- `desktop/src/stores/persona.ts`
  - 人格库状态
- `desktop/src/stores/chat.ts`
  - 聊天状态和发送编排
- `desktop/src/stores/cultivation.ts`
  - 培养中心状态
- `desktop/src/lib/api.ts`
  - 与 `workbench-server` 的 API 通信层
- `desktop/src/styles/globals.css`
  - 当前真实生效的全局样式入口

### 3.2 CLI 与服务层

- `src/cli/index.ts`
  - CLI 总入口
- `src/cli/commands/workbench-server.ts`
  - 本地 HTTP 服务入口
- `src/cli/commands/create.ts`
  - persona 创建
- `src/cli/commands/train.ts`
  - 训练入口
- `src/cli/commands/experiment.ts`
  - 实验入口
- `src/cli/commands/export.ts`
  - 导出入口

### 3.3 核心能力层

- `src/core/workbench/service.ts`
  - 本地工作台服务编排层
- `src/core/agents/`
  - Persona / Trainer / Evaluator / Director 等 agent
- `src/core/training/`
  - 训练循环、编排器、报告、checkpoint、失败恢复
- `src/core/pipeline/`
  - 素材标准化、evidence layer、routing、pack/shard/merge
- `src/core/memory/`
  - 向量记忆写入与检索
- `src/core/soul/`
  - Soul 提取与渲染

## 4. 当前已落地的能力

### 4.1 人格创建与管理

当前已经支持：

- 创建 persona
- 编辑 persona 配置
- 删除 persona
- 从旧 persona 迁移到 `sources[]` 素材池结构

素材池现在支持：

- `social`
- `chat_file`
- `video_file`
- `article`
- `youtube_video`
- `youtube_channel`
- `podcast_episode_page`
- `official_site`
- `interview/article_page`

### 4.2 自动发现与持续培养

当前已经有这些接口和流程：

- `discover-sources`
- `check-updates`
- `continue-cultivation`
- `cultivation-summary`

也就是说，系统已经不是“训练一次就结束”，而是支持：

- 发现新来源
- 把来源加入素材池
- 检查远程来源是否更新
- 对新增内容做增量继续培养

### 4.3 聊天编排

当前聊天不是简单把消息直接发给模型，而是经过 turn plan 编排。

当前聊天会先判断：

- `answer`
- `clarify`
- `refuse_internal`

当前已经做了这些治理：

- 隐藏 system prompt / hidden memory / training prep 等内部实现
- 根据附件构造本轮上下文
- 针对 Gemini 配额或高压失败自动切备用 provider
- 对 fallback 输出做基础去机械化处理

### 4.4 训练治理

当前训练能力已经具备：

- 训练前模型预检
- 双轨训练编排
- round-level observability
- checkpoint
- 自动恢复
- 失败分类
- 训练报告落盘

## 5. 当前“训练”到底是什么

当前训练不是模型参数微调。

当前训练做的是：

1. 从素材中抽取人格结构和记忆
2. 通过训练循环持续修正这些结构
3. 在聊天时把这些资产喂给底层模型使用

所以它更准确地说是：

- `资产蒸馏`
- `记忆写入与治理`
- `基于人格资产的对话编排`

而不是：

- `LoRA`
- `SFT`
- `继续预训练`

## 6. 当前一轮完整培养会产出什么

persona 目录下通常会出现这些关键资产：

- `persona.json`
- `soul.yaml`
- `training-context.json`
- `training-report.json`
- `checkpoint_index.json`
- `evidence-index.jsonl`
- `evidence-stats.json`
- `manifest.json`
- `error-ledger.json`

这些文件共同承担：

- 人格资产持久化
- 训练状态追踪
- 失败恢复
- 客户端培养中心展示
- 后续聊天与继续培养

## 7. 当前桌面端真实产品形态

桌面端当前只保留三个主入口：

- `聊天`
- `人格库`
- `设置`

其中：

- `聊天`
  - 当前 persona
  - 线程列表
  - 消息流
  - 输入框
  - 模型选择
  - 附件入口
- `人格库`
  - persona 列表
  - persona 编辑
  - 素材池编辑
  - 培养中心
- `设置`
  - API / provider / model 配置
  - 路径配置
  - 语言与服务连接配置

不再把这些内部概念作为产品主界面信息暴露：

- `Soul`
- `Memory`
- `Training prep`
- `Experiment`
- `Evidence internals`
- `Inspector`

## 8. 当前最关键的工程约束

### 8.1 会话层纪律

当前客户端会话过程中只允许稳定写：

- `conversation log`
- `session summary`
- `memory candidates`

当前不允许：

- 在客户端会话中直接写 `Soul`
- 绕过候选层直接写长期人格资产

### 8.2 写回安全层

当前存在的中间层包括：

- `promotion-ready`
- `handoff artifact`
- `training prep artifact`

这些层的意义是：

- 给训练和审计提供安全缓冲
- 防止聊天中的临时噪声直接污染正式人格资产

## 9. 当前项目最重要的问题已经变成什么

现在主要问题已经不再是“有没有训练链路”，而是：

1. 多源素材是否足够全、足够准
2. 增量继续培养是否稳定
3. 聊天是否足够像、足够稳、足够不泄漏内部实现
4. 客户端是否足够干净、克制、可直接给用户使用

## 10. 现在最值得先看的文档

- [README](/Users/a77/Desktop/Neeko/README.md)
- [快速开始](/Users/a77/Desktop/Neeko/docs/quickstart.md)
- [训练流程总览](/Users/a77/Desktop/Neeko/docs/training-runtime-overview.md)
- [架构设计](/Users/a77/Desktop/Neeko/docs/architecture.md)
- [输入架构阶段总结](/Users/a77/Desktop/Neeko/docs/input-architecture-status.md)
- [客户端工作台阶段总结](/Users/a77/Desktop/Neeko/docs/client-workbench-phase-summary-v1.md)

## 11. 一句话总结

当前 Neeko 已经不是“一个能抓推文的实验项目”，而是一套正在收口成产品的本地人格系统：桌面端负责用户交互，本地服务负责编排，CLI 负责深度调试与运维，训练与聊天共用同一套核心能力。
