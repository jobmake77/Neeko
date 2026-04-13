# Neeko

<p align="center">
  <img src="./docs/assets/neeko-logo.png" alt="Neeko Logo" width="220" />
</p>

> 面向真实人物培养的本地化人格系统：桌面客户端、CLI、本地服务共用同一套核心能力。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)

## 项目定位

Neeko 当前的主产品方向已经切到：

- `桌面客户端（Tauri）`
- `CLI`
- `本地 workbench-server`

当前不再继续把新的 `Web` 页面作为主产品面推进。仓库里仍保留 `web/` 目录和部分历史原型，但当前真正维护和推进的是桌面端与 CLI。

Neeko 解决的问题不是“做一个普通聊天壳”，而是：

1. 采集和治理一个真实人物的多源素材
2. 把素材整理成可持续更新的人格资产
3. 通过训练循环持续培养 persona
4. 在聊天中稳定使用这些资产，同时隐藏内部训练细节

一句话概括：

`多源素材 -> 统一证据层 -> 人格资产 -> 持续培养 -> 用户聊天`

## 当前真实能力

截至当前代码，项目里已经跑通的主链路包括：

- `人格库`：创建、编辑、删除 persona
- `素材池`：支持 `social / chat_file / video_file / article` 等来源
- `自动发现候选来源`：发现官网、YouTube、文章、播客页等候选来源，再由用户确认入池
- `持续培养`：支持 `check-updates` 与 `continue-cultivation`
- `聊天主链路`：单线程单 persona，对话中隐藏内部术语
- `聊天编排`：支持 `answer / clarify / refuse_internal`
- `聊天 provider failover`：主模型失败时自动切到备用聊天 provider
- `训练运行治理`：checkpoint、自动恢复、失败分类、round-level report
- `桌面端中文化`：主导航、枚举词、设置与状态文案优先中文

## 这套系统不是在做什么

当前训练不是底层模型微调，不会改 Gemini / OpenAI / Kimi / Claude 的模型参数。

当前训练更接近：

- `资产蒸馏`
- `Soul + Memory 构建`
- `基于外部人格资产的持续培养`

也就是把人物素材训练成一套可更新、可审计、可恢复的人格外部系统，而不是把人格直接写进底模权重。

## 核心架构

```text
Desktop (Tauri)
  -> workbench-server (HTTP API)
    -> Node core / CLI
      -> ingestion / evidence / training / chat / export
```

### 运行层分工

- `desktop/`
  - Tauri 桌面客户端
  - 当前一级导航：`聊天 / 人格库 / 设置`
- `src/cli/`
  - CLI 命令入口
  - `create / train / chat / experiment / export / workbench-server`
- `src/core/`
  - 项目核心能力
  - 包括 `agents / training / pipeline / workbench / memory / soul`
- `docs/`
  - 项目设计、阶段总结、训练与输入架构文档

### 当前产品信息架构

桌面端当前只保留 3 个一级入口：

- `聊天`
- `人格库`
- `设置`

内部训练概念仍然存在，但默认不在聊天主界面暴露：

- `Soul`
- `Memory`
- `Evidence`
- `Training prep`
- `Experiment`
- `Export`

这些能力更多存在于后台服务、CLI 和内部文档层，而不是用户聊天主视图。

## 一次完整培养的真实链路

当前训练主线可以概括为：

1. 创建 persona 配置
2. 收集多源素材
3. 标准化为 `RawDocument`
4. 进入 evidence layer
5. 生成 snapshot / shard / pack / merge 等中间资产
6. 进入双轨训练编排器
7. 每轮执行：出题 -> 回答 -> 评估 -> 记忆治理 -> director 审查 -> 收敛判断
8. 写入 `training-report.json`、`training-context.json`、`checkpoint_index.json`
9. 在客户端培养中心显示状态、轮次、素材摘要和技能摘要

更详细的说明见：

- [项目状态总览](/Users/a77/Desktop/Neeko/docs/project-status-overview.md)
- [训练流程总览](/Users/a77/Desktop/Neeko/docs/training-runtime-overview.md)
- [架构设计](/Users/a77/Desktop/Neeko/docs/architecture.md)
- [培养阶段 V1 总结](/Users/a77/Desktop/Neeko/docs/training-phase-summary-v1.md)

## 快速开始

### 1. 环境要求

- Node.js `18+`
- npm
- Qdrant
- 至少一个聊天/训练模型的 API Key
- 如果需要桌面端：Rust + Tauri 依赖

推荐额外准备：

- `opencli`：用于浏览器态抓取
- `yt-dlp`：用于远程视频抓取与转写前处理

### 2. 安装

```bash
git clone https://github.com/jobmake77/Neeko.git
cd Neeko
npm install
npm run build
```

### 3. 启动本地服务

```bash
node dist/cli/index.js workbench-server
```

默认服务地址：

- `http://127.0.0.1:4310`

### 4. 启动桌面前端开发环境

```bash
npm --prefix desktop install
npm --prefix desktop run dev
```

如果要启动 Tauri 桌面壳：

```bash
npm --prefix desktop run tauri:dev
```

### 5. 纯 CLI 使用

```bash
# 配置运行时
node dist/cli/index.js config

# 创建 persona
node dist/cli/index.js create @elonmusk --rounds 3 --training-profile full

# 继续培养
node dist/cli/index.js train elonmusk --mode full

# 对话
node dist/cli/index.js chat elonmusk

# 导出
node dist/cli/index.js export elonmusk --to openclaw
```

## 当前推荐的启动方式

### 桌面端开发

1. 启动 Qdrant
2. 启动 `workbench-server`
3. 启动 `desktop` 前端或 Tauri dev
4. 在设置页配置模型 API Key 与路径
5. 在 `人格库` 中创建 persona
6. 在 `聊天` 页选择 persona 并开始对话

### CLI 调试

适合做这些事：

- 单步创建 persona
- 单独跑训练
- 看实验报告
- 做导出
- 跑回归测试与 smoke/drift 测试

## 当前模型配置语义

当前项目已经把 `聊天模型` 和 `培养模型` 的概念分开：

- 可以共用一套 provider / model
- 也可以拆成 chat / training 两套默认配置
- 聊天页还支持临时切换聊天模型
- 当聊天主路由遇到 `429 / quota / overload / resource exhausted` 时，会自动尝试备用聊天 provider

相关接口：

- `GET /api/runtime/model-config`
- `PUT /api/runtime/model-config`

## 当前目录重点

```text
src/
  cli/
    commands/
  core/
    agents/
    memory/
    pipeline/
    soul/
    training/
    workbench/
desktop/
  src/
  src-tauri/
docs/
  project-status-overview.md
  training-runtime-overview.md
  architecture.md
  quickstart.md
```

## 关键命令

```bash
# 构建
npm run build

# 启动本地服务
node dist/cli/index.js workbench-server

# 创建 persona
node dist/cli/index.js create @handle --rounds 3 --training-profile full

# 继续培养
node dist/cli/index.js train handle --mode full

# 与 persona 对话
node dist/cli/index.js chat handle

# 运行实验
node dist/cli/index.js experiment handle --rounds 6

# 桌面端前端开发
npm --prefix desktop run dev

# Tauri 开发
npm --prefix desktop run tauri:dev
```

## 当前重要文档

- [项目状态总览](/Users/a77/Desktop/Neeko/docs/project-status-overview.md)
- [训练流程总览](/Users/a77/Desktop/Neeko/docs/training-runtime-overview.md)
- [快速开始](/Users/a77/Desktop/Neeko/docs/quickstart.md)
- [架构设计](/Users/a77/Desktop/Neeko/docs/architecture.md)
- [系统 V1 定义](/Users/a77/Desktop/Neeko/docs/system-v1.md)
- [培养阶段 V1 总结](/Users/a77/Desktop/Neeko/docs/training-phase-summary-v1.md)
- [输入架构阶段总结](/Users/a77/Desktop/Neeko/docs/input-architecture-status.md)
- [客户端工作台阶段总结](/Users/a77/Desktop/Neeko/docs/client-workbench-phase-summary-v1.md)
- [大语料路线图](/Users/a77/Desktop/Neeko/docs/large-corpus-roadmap.md)

## 当前阶段结论

当前项目已经从“能不能训练出 persona”转向“如何让 persona 在客户端里稳定可用”。

现在最重要的不是继续堆更多页面，而是持续把这三件事做好：

1. 多源素材获取与持续培养
2. 聊天链路稳定性与隐藏内部实现
3. 桌面客户端的真实可用体验
