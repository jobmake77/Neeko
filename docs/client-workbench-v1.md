# 客户端工作台 V1

更新时间：2026-04-07

关联文档：

- [客户端工作台 V1 阶段总结](/Users/a77/Desktop/Neeko/docs/client-workbench-phase-summary-v1.md)
- [培养阶段 V1 阶段总结](/Users/a77/Desktop/Neeko/docs/training-phase-summary-v1.md)
- [Neeko 系统 V1 正式定义](/Users/a77/Desktop/Neeko/docs/system-v1.md)

## 1. 目标

这一版把产品主入口正式切到：

`Tauri Desktop -> workbench-server -> Node core/CLI`

目标不是只做聊天壳，而是先把下面五类能力跑通：

1. Persona 浏览
2. 单 Persona 线程聊天
3. 会话写回候选
4. 训练 / 实验 / 导出入口
5. 本地状态与运行结果查看
6. 聊天 / 证据 / 训练 / 实验的一致性工作流指导

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
8. 线程栏搜索与状态筛选（all / active / idle / archived）
9. thread 卡片展示最近消息预览与线程状态
10. 聊天主区显式展示 session summary 与 summary 新鲜度
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
25. Train 面板支持 `Run Smoke`，可用安全默认参数做一次低成本训练链路验证
26. Chat 区可以直接查看 Evidence Intake 的 `speaker_role / scene / stable items` 指标
27. Chat / Writeback / Train / Experiment / Create 都有统一的 guidance card，显示当前阶段和建议下一步
28. 聊天消息卡会展示 persona dimensions、citation 数量、memory 命中数量与 citation 摘要
29. Evidence Intake 导入前支持路径/manifest 本地预检查，服务端也有硬校验
30. 用户侧不再展示原始技术错误；客户端和 workbench API 都会返回安全文案
31. 全局 `run status banner` 可跨页面提示当前运行状态，并展开最近运行列表
32. 聊天消息的 citation / memory 来源支持展开查看与复制 memory id

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
6. 线程状态目前仍是轻量本地状态，不包含多人协作、标签体系或服务端同步
7. run center 目前已经支持基础搜索、状态筛选、类型筛选和状态汇总，并且训练面板能看到第一层 run detail drill-down；但还没有完整的长期历史与深层详情页
8. source drill-down 已经支持 candidate / handoff / run prep 的第一层来源回看，但 citation 到正式 memory source 的链路仍然偏浅
9. guidance card 是启发式产品层，不替代正式实验结果与训练报告判断

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
9. Train 面板支持 `Run Smoke`，默认走 `quick + 1 round + persona_extract`
10. 聊天头部会显示 thread status、candidate 数量与 summary 新鲜度
11. 消息卡会显示 persona dimensions / citation / memory 命中摘要
12. 线程栏支持 search + status filter，适合 thread 数量增多后的日常使用
13. `Use For Training` 已打通 `evidence intake -> train` 与 `training prep -> train`
14. 消息卡里的 signal 区现在支持展开 / 收起，避免长对话里信息过载
15. citation 与 retrieved memory id 已经可以在消息卡中直观看到和复制

### 6.4 工作台 Guidance 层

当前客户端已经补出一层统一的产品引导，不再只是给裸参数和裸按钮：

1. `Create Guidance`
2. `Train Guidance`
3. `Experiment Guidance`
4. `Pipeline Status`
5. `Suggested Next Step`
6. `Run Status Banner`

这层的职责是：

1. 告诉用户当前所处阶段
2. 告诉用户下一步更适合做什么
3. 把 “attach context / run smoke / expand corpus / create handoff / build prep / ready for PK” 这类动作前置
4. 让 workbench 在日常使用上更接近真正的工作台，而不是若干独立入口的拼接
5. 在不暴露底层技术细节的前提下，让用户始终知道系统当前在做什么

## 6.5 Smoke 与 Provider 治理

为了让 workbench 能更稳定地做“先验证链路，再决定是否正式训练”，当前新增了两层保护：

1. `Run Smoke`
2. provider-aware preflight

`Run Smoke` 的目标是：

1. 用最低成本验证 train launch、prep context、日志与 report 链路
2. 尽量避免直接触发长轮数训练
3. 为客户端保留一个可重复的健康检查入口

当前 smoke 默认：

1. `mode=quick`
2. `rounds=1`
3. `track=persona_extract`
4. 保留 `prep_context`

当前 preflight 治理：

1. preflight 仍然会识别 provider 差异，但治理口径不再绑定某个模型名
2. failure 会按培养能力分型记录，例如：
3. `generation_timeout`
4. `structured_output_failure`
5. `transport_error`
6. `capability_mismatch`
7. 第二次 structured probe 会自动切到更轻量的 schema，减少结构化输出误杀

## 6.6 用户可见结果与内部恢复

工作台对用户的默认策略是：

1. 不直接暴露底层模型报错、schema 报错、timeout 明细
2. 优先由系统内部自动重试、放宽预算、启用断点/已保存进度恢复
3. 用户侧只看到直接结果，例如：
4. `running`
5. `recovering`
6. `completed`
7. `paused, progress saved`
8. API report 不再向客户端主界面暴露 `log tail`

也就是说：

1. 错误分类仍然保留，用于系统内部治理
2. 但客户端主界面优先显示“是否已自动恢复”和“当前能否继续”
3. 避免把不具可操作性的底层错误直接甩给用户

## 7. 下一步

1. 验证 `workbench-server` 与桌面前端联调
2. 视本地环境补齐 Tauri 构建链路
3. 把 `training prep` 往后接成真正的训练整理流和审核流，而不影响现有培养主线
