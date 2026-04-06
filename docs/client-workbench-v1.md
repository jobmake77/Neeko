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
8. thread 卡片最近消息预览
9. 聊天主区显式展示 session summary
10. run report 附带 log tail，可在客户端内直接查看最近运行输出
11. 线程基础管理：rename / delete / refresh summary
12. workbench 表单默认值本地持久化
13. 聊天区线程详情卡：created / updated / message_count / summary_updated
14. Create / Train / Experiment / Export 参数面板扩展，已覆盖更多 CLI 真实参数
15. Settings 支持手动刷新 service 健康状态并展示本地启动命令
16. Writeback review：memory candidates 支持 accept / reject / reset 状态管理
17. Writeback panel 支持 candidate 状态筛选与排序（时间 / 置信度）
18. accepted candidate 可进入 `promotion-ready queue`，但仍不直接写正式 memory
19. `promotion-ready queue` 可生成 `promotion handoff artifact`，作为后续训练/人工整理的结构化交接包
20. handoff 支持 `drafted / queued / archived` 状态，不会直接写入正式 `Soul` 或正式长期记忆
21. handoff 可在客户端内展开查看候选明细，并复制导出为 `Markdown / JSON`
22. workbench 现已支持聊天日志与视频 transcript 的本地 Evidence Intake
23. `handoff -> training prep` 已作为安全适配层接入，只产出训练输入包，不写正式资产
24. Train 面板现在可以把 `training prep / evidence intake` 作为启动上下文带入训练，并写入 `training-context.json` 供后续追踪

### 3.2 默认写回规则

1. 自动写 `conversation log`
2. 自动写 `session summary`
3. 自动生成 `memory candidates`
4. 不直接写 `Soul`
5. 不自动晋升为正式长期记忆
6. `promotion-ready` 只生成 handoff artifact，不自动提升为正式记忆
7. `training prep` 只生成 workbench 内部训练输入包，不直接进入正式训练写回

### 3.3 当前限制

1. Tauri 壳已建好，但当前环境没有 `cargo`，所以还没法在本机完成 Rust 打包验证
2. 会话候选生成目前先用轻量启发式，不额外增加一层昂贵 LLM 审核
3. create/train/experiment/export 仍由现有 CLI 执行，本地 server 负责结构化调度与状态持久化
4. handoff 目前仍是本地交接层，不包含正式审核流与一键写入能力
5. 视频原始媒体文件仍依赖转写能力；但 transcript-first 文件已经可以直接接入 workbench

## 5. 当前工作台新增交接层

### 5.1 Promotion-ready Queue

1. 只有 `accepted` candidate 才能进入 `promotion-ready queue`
2. 队列目标是把“看起来可保留”的候选从普通候选池中提纯出来
3. 队列本身仍是安全缓冲层，不直接触达正式资产

### 5.2 Promotion Handoff Artifact

当线程里的 `promotion-ready` 候选足够稳定后，工作台可以生成一个结构化 handoff：

1. `persona_slug`
2. `conversation_id`
3. `candidate_ids[]`
4. `items[]`
5. `summary`
6. `session_summary`
7. `status: drafted | queued | archived`

这个对象的定位是：

1. 给后续训练或人工整理提供“可复看、可回溯”的中间资产
2. 把 ready queue 里的候选组织成一个更稳定的交接包
3. 继续保持和正式 `Soul / Memory` 的隔离

### 5.3 本地 API 扩展

当前新增：

1. `GET /api/personas/:slug/promotion-handoffs`
2. `POST /api/conversations/:id/promotion-handoffs`
3. `PATCH /api/promotion-handoffs/:id`
4. `GET /api/promotion-handoffs/:id`
5. `GET /api/promotion-handoffs/:id/export?format=markdown|json`
6. `GET /api/personas/:slug/evidence-imports`
7. `POST /api/personas/:slug/evidence-imports`
8. `GET /api/personas/:slug/training-preps`
9. `POST /api/promotion-handoffs/:id/training-preps`
10. `GET /api/training-preps/:id`
11. `GET /api/training-preps/:id/export?format=markdown|json`

## 6. 当前新增工作流

### 6.1 Evidence Intake

工作台聊天页现在支持：

1. 导入聊天记录文件
2. 导入视频 transcript 文件
3. 绑定 `target manifest`
4. 把 Evidence Layer 产物落到 workbench 本地资产目录

当前视频入口有两条路：

1. `transcript-first`：`.txt/.md/.json/.jsonl` transcript 直接导入
2. 原始媒体文件：仍走转写能力

### 6.2 Training Prep Adapter

当前写回安全链路已经延长为：

`memory candidates -> promotion-ready queue -> handoff artifact -> training prep artifact`

`training prep artifact` 的职责是：

1. 把 handoff 候选转成可训练输入包
2. 生成 `documents.json`
3. 生成 `evidence-index.jsonl`
4. 继续和正式 `Soul / Memory` 隔离
5. 可以导出为 `Markdown / JSON` 交接内容，供训练整理或人工审核使用

训练发起时，workbench 现在允许把这些资产作为 `prep context` 挂到训练运行上：

1. `prep_documents_path`
2. `prep_evidence_path`
3. `prep_artifact_id`
4. `evidence_import_id`

这一层的定位仍然是：

1. 让训练运行知道“这次是基于哪份整理资产发起的”
2. 把来源写进 `training-context.json` 和 checkpoint 上下文，便于审计和回溯
3. 不改变现有 TrainingLoop、TrainerAgent、EvaluatorAgent、DirectorAgent 的核心行为
4. 不允许绕过 workbench 安全链路直接改正式人格资产

### 6.3 Chat UX 收尾

聊天工作区已补：

1. `Cmd/Ctrl + Enter` 快速发送
2. 单条消息复制
3. notice 提示
4. 聊天页内直接做 Evidence Intake
5. 导入结果快速回看
6. Train 面板直接展示最近的 `training prep / evidence intake` 资产路径，支持一键带入训练表单
7. Train launch 支持清空 prep context，避免不同资产之间误串
8. 右侧 `Training` 面板会同时显示 `training-report` 与 `training-context`，可直接审计 `prep_context`

## 7. 下一步

1. 验证 `workbench-server` 与桌面前端联调
2. 视本地环境补齐 Tauri 构建链路
3. 把 `training prep` 往后接成真正的训练整理流和审核流，而不影响现有培养主线
