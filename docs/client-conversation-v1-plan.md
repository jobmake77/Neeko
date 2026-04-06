# 客户端与交流层 V1 方案

更新时间：2026-04-06

关联文档：

- [培养阶段 V1 阶段总结](/Users/a77/Desktop/Neeko/docs/training-phase-summary-v1.md)
- [Neeko 系统 V1 正式定义](/Users/a77/Desktop/Neeko/docs/system-v1.md)
- [架构设计](/Users/a77/Desktop/Neeko/docs/architecture.md)

## 1. 问题定义

当培养阶段基本成立之后，真正的问题会变成：

1. 用户怎么和培养好的 persona 交流
2. 会话时系统该读哪些东西
3. 会话时系统该写哪些东西
4. 哪些内容可以写回，哪些绝不能直接写回

所以客户端阶段不只是“做个聊天页面”，而是要补齐一层新的系统：

`Conversation Layer`

## 2. 下一阶段的核心目标

客户端与交流层 V1 的目标不是一步做到“会成长的数字生命”，而是先把最关键的闭环建立起来。

并且本阶段有一个明确约束：

> 只做客户端和 CLI，不再继续推进新的 Web 页面方案。

在这个约束下，要先建立下面的闭环：

1. 用户能稳定和 persona 对话
2. persona 能正确读取 `Soul + Memory + 会话历史`
3. 客户端能展示引用来源和人格摘要
4. 会话中新产生的信息可以被安全地写入候选层
5. 写回不会直接污染 `Soul`

## 3. 客户端 V1 应该先做什么

### 3.1 产品目标

客户端 V1 建议只做三件事：

1. Persona 列表页
2. 单 Persona 对话页
3. 会话侧边信息面板

这里的“页”指客户端内部的界面结构，不指新的 Web 页面。

### 3.2 对话页最小闭环

对话页 V1 的最小闭环建议是：

1. 左侧或主区：会话消息流
2. 右侧：当前 Persona 的 `Soul` 摘要
3. 底部：输入框
4. 回复时显示：
   - 当前引用了哪些长期记忆
   - 当前回复偏向哪些人格维度
   - 当前是否触发写回候选

也就是说，客户端 V1 先做“可解释的对话”，而不是先做花哨 UI。

## 4. 交流层 V1 的标准架构

建议把交流层拆成下面几层：

`Desktop Client -> Local Conversation Service -> Session Orchestrator -> Prompt Compiler -> PersonaAgent -> Writeback Review`

### 4.1 Desktop Client

职责：

1. 展示消息
2. 展示引用记忆
3. 展示人格摘要
4. 收集用户反馈

### 4.2 Local Conversation Service

职责：

1. 接收客户端消息
2. 加载 persona
3. 组装会话上下文
4. 调用 `chat-once` 或本地编排入口
5. 返回回复与元信息

说明：

1. 这一层不要求先做成远程服务
2. V1 更推荐做“本地进程 + 本地接口”模式
3. 可以是桌面端直接调用 Node 子进程，也可以是本地 IPC / localhost service

### 4.3 Session Orchestrator

职责：

1. 维护会话历史
2. 控制短期上下文长度
3. 触发记忆检索
4. 决定是否生成会话摘要
5. 决定是否触发写回候选

### 4.4 Prompt Compiler

职责：

1. 拼接 `Soul`
2. 注入检索到的 `Memory`
3. 注入必要的会话历史
4. 注入会话模式说明

### 4.5 PersonaAgent

职责：

1. 生成最终回复
2. 保持人格一致性
3. 在可解释性元信息里返回“本次回答主要依赖了什么”

### 4.6 Writeback Review

职责：

1. 判断本轮对话是否产生了新的长期信息
2. 只写入 `session memory candidates`
3. 不直接写 `Soul`
4. 等待后续 review / reinforce / training 再决定是否晋升

## 5. 交流层最重要的“读写分离”

这是下一阶段最关键的规则。

### 5.1 会话时要读什么

客户端交流时建议读取四层信息：

1. `Soul`
2. `Memory`
3. 当前会话历史
4. 会话摘要

读取优先级建议：

1. `Soul` 决定“这个人是谁”
2. `Memory` 决定“这个人对当前话题记得什么”
3. `History` 决定“这轮正在聊什么”
4. `Summary` 决定“长对话里前面发生过什么”

### 5.2 会话时要写什么

客户端交流时建议只允许写三类内容：

1. `conversation log`
2. `session summary`
3. `memory candidates`

不建议直接写：

1. `Soul`
2. `global memory`
3. `training seed`

### 5.3 为什么不能直接写 Soul

因为对话是高噪声的。

用户可能会：

1. 引导
2. 误导
3. 挑衅
4. 测试
5. 让 persona 临时扮演别的风格

如果会话一结束就直接写 `Soul`，那系统很快会被会话污染。

所以客户端阶段必须坚持：

> 会话只产生候选写回，不直接改人格核心资产。

## 6. 客户端 V1 建议落地的写回策略

### 6.1 写回层级

建议分成三层：

1. `Session Log`
2. `Session Summary`
3. `Memory Candidate`

### 6.2 晋升规则

建议晋升路径：

`Session Log -> Session Summary -> Memory Candidate -> Reinforced Memory -> Soul candidate`

这意味着：

1. 一次会话先记日志
2. 多轮后压成摘要
3. 只有稳定、重复、与人格相关的内容才进入 memory candidate
4. 只有跨 session 复现后，才可能进入 Soul candidate

### 6.3 V1 默认策略

客户端 V1 默认建议：

1. 开启 `conversation log`
2. 开启 `session summary`
3. 开启 `memory candidate`
4. 关闭 `auto soul writeback`

## 7. 客户端 V1 的最小数据对象

建议下一阶段最少引入这几类对象：

### 7.1 `Conversation`

字段建议：

1. `id`
2. `persona_slug`
3. `created_at`
4. `updated_at`
5. `status`
6. `message_count`
7. `last_summary_id?`

### 7.2 `ConversationMessage`

字段建议：

1. `id`
2. `conversation_id`
3. `role`
4. `content`
5. `created_at`
6. `retrieved_memory_ids[]`
7. `persona_dimensions[]`
8. `writeback_candidate_ids[]`

### 7.3 `SessionSummary`

字段建议：

1. `id`
2. `conversation_id`
3. `summary`
4. `covered_message_ids[]`
5. `created_at`

### 7.4 `MemoryCandidate`

字段建议：

1. `id`
2. `conversation_id`
3. `source_message_ids[]`
4. `candidate_type`
5. `content`
6. `confidence`
7. `status`

## 8. 客户端 V1 的接口建议

下一阶段建议优先补齐这些本地接口：

1. `GET /api/personas`
2. `GET /api/personas/:slug`
3. `GET /api/conversations/:id`
4. `POST /api/conversations`
5. `POST /api/conversations/:id/messages`
6. `GET /api/conversations/:id/writeback-candidates`

其中：

1. `POST /messages` 先复用 `chat-once`
2. 写回逻辑先做同步候选生成
3. 真正的候选审核可先落文件或本地存储，不急着上复杂后台

## 9.5 客户端技术方向建议

在“不做 Web 页面”的前提下，当前更推荐的方向是：

1. 桌面客户端外壳
2. 本地 Node/TypeScript 会话服务
3. CLI 继续作为调试与运维入口

当前建议优先比较这两种客户端路线：

1. `Tauri + 本地 Node sidecar`
   - 包体更轻
   - 更适合“客户端 + 本地服务 + CLI 共存”
2. `Electron + Node 主进程`
   - 集成更直接
   - 但包体更大

如果以当前仓库的技术栈延续性为优先，V1 更建议：

1. `Tauri` 负责桌面壳与客户端 UI
2. 当前 Node/TypeScript 代码继续承担 persona、memory、training、chat orchestration
3. CLI 与客户端共用同一套核心服务层

## 10. 下一阶段的开发顺序

建议开发顺序：

1. 先做客户端对话页 MVP
2. 复用现有 `chat-once`
3. 把 `Soul + Memory + History` 的读取元信息展示出来
4. 增加 `conversation log`
5. 增加 `session summary`
6. 增加 `memory candidate` 写回
7. 最后再做更复杂的在线成长机制

## 11. 当前最推荐的阶段目标

如果把下一阶段只压成一句话：

> 不要急着让 persona “自动成长”，先让 persona “稳定交流，并且交流过程可读、可解释、可安全写回”。

## 12. 我们下一阶段到底该做什么

当前最推荐的下一阶段任务不是继续大规模训练，而是下面三个里选一个主轴：

1. `客户端 MVP`
2. `交流层读写分离`
3. `会话写回治理`

如果只选一个最优先，建议是：

1. 先做 `客户端 MVP`

原因：

1. 没有客户端，就很难验证培养成果到底好不好用
2. 没有真实交流场景，写回治理也很难设计正确
3. 客户端一旦跑起来，后续会话写回和在线成长才能有真实反馈
