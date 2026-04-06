# 客户端工作台 V1

更新时间：2026-04-06

## 1. 目标

这一版把产品主入口正式切到：

`Tauri Desktop -> workbench-server -> Node core/CLI`

目标不是只做聊天壳，而是先把下面五类能力跑通：

1. Persona 浏览
2. 单 Persona 线程聊天
3. 会话写回候选
4. 训练 / 实验 / 导出入口
5. 本地状态与运行结果查看

## 2. 当前落地结构

### 2.1 Core

新增：

1. `src/core/models/workbench.ts`
2. `src/core/workbench/store.ts`
3. `src/core/workbench/service.ts`

职责：

1. 定义 `Conversation / ConversationMessage / MemoryCandidate / WorkbenchRun`
2. 本地持久化 conversation、summary、candidate、run
3. 统一封装 persona 读取、聊天调用、训练/实验/导出调度

### 2.2 CLI Server

新增：

1. `nico workbench-server`
2. `src/cli/commands/workbench-server.ts`

提供结构化本地 API：

1. `/api/personas`
2. `/api/personas/:slug`
3. `/api/personas/:slug/conversations`
4. `/api/conversations/:id`
5. `/api/conversations/:id/messages`
6. `/api/conversations/:id/writeback-candidates`
7. `/api/runs/train`
8. `/api/runs/experiment`
9. `/api/runs/export`
10. `/api/runs/:id`
11. `/api/runs/:id/report`

### 2.3 Desktop

新增：

1. `desktop/` React + Vite 前端
2. `desktop/src-tauri/` Tauri 壳工程

工作台布局采用：

1. 全局导航栏
2. Persona 栏
3. 线程栏
4. 中间工作区
5. 右侧信息面板

## 3. 当前行为边界

### 3.1 已支持

1. Persona 列表读取
2. 线程创建与持久化
3. 单线程聊天闭环
4. 回复返回 citation / persona dimension / writeback candidate 元信息
5. create / train / experiment / export 的结构化触发与状态轮询
6. recent runs 列表查看与历史 report 回看
7. 工作台状态本地恢复：active view、active tab、selected persona、selected thread

### 3.2 默认写回规则

1. 自动写 `conversation log`
2. 自动写 `session summary`
3. 自动生成 `memory candidates`
4. 不直接写 `Soul`
5. 不自动晋升为正式长期记忆

### 3.3 当前限制

1. Tauri 壳已建好，但当前环境没有 `cargo`，所以还没法在本机完成 Rust 打包验证
2. 会话候选生成目前先用轻量启发式，不额外增加一层昂贵 LLM 审核
3. create/train/experiment/export 仍由现有 CLI 执行，本地 server 负责结构化调度与状态持久化

## 4. 下一步

1. 验证 `workbench-server` 与桌面前端联调
2. 视本地环境补齐 Tauri 构建链路
3. 继续把聊天 / 视频证据层接入这套工作台，而不影响现有培养主线
