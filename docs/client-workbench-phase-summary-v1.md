# 客户端工作台 V1 阶段总结

更新时间：2026-04-07

关联文档：

- [客户端工作台 V1](/Users/a77/Desktop/Neeko/docs/client-workbench-v1.md)
- [培养阶段 V1 阶段总结](/Users/a77/Desktop/Neeko/docs/training-phase-summary-v1.md)
- [Neeko 系统 V1 正式定义](/Users/a77/Desktop/Neeko/docs/system-v1.md)

## 1. 这份文档的目标

这份文档用于给当前“客户端工作台 V1”做一次正式收口。

它主要回答五个问题：

1. 当前客户端已经完成到了什么程度
2. 当前工作台已经具备哪些稳定能力
3. 这一版的主要产品价值是什么
4. 当前边界和不足在哪里
5. 下一阶段最值得继续补什么

## 2. 当前阶段已经完成的事情

### 2.1 产品主入口已经完成切换

当前产品主入口已经不再以 Web 页面为主，而是正式切到：

`Desktop Workbench -> workbench-server -> Node core/CLI`

这意味着当前客户端不是一个孤立壳层，而是：

1. 复用现有 Node 核心能力
2. 复用现有 CLI 调度能力
3. 用本地结构化 API 承接 UI 调用
4. 把“培养、训练、实验、导出、交流”统一到一个工作台里

### 2.2 工作台主壳层已经完成极简重排

当前桌面工作台已经不再维持“控制台式六面并列”，而是切成三层主结构：

1. `Chat`：单人格多线程对话
2. `Personas`：人格库 + 培养中心（Tab 切换）
3. `Settings`：API 连接、外观、模型配置

其中：

1. `Chat` 成为默认产品入口，只保留线程列表、消息流、输入框
2. `Personas` 负责人格的浏览、创建、编辑、删除，以及训练状态追踪（培养中心）
3. `Settings` 统一收纳 API 连接、主题/语言切换、AI 模型配置
4. 左侧为可折叠/可拖拽宽度的侧边栏，包含导航、最近对话列表、底部语言/主题切换
5. 人格创建改为屏幕中心三步弹窗（名称 → 数据来源 → 培养深度），创建成功后直接触发训练
6. 人格卡片去掉"开始对话"按钮，点击卡片主体即切到对应人格的聊天视图
7. 桌面端现在会在本地 URL 下自动恢复 `workbench-server`
8. 桌面端现在允许显式配置本地 `repo root`，并把 bootstrap readiness 作为状态卡展示出来
9. 打包态 app 现在会优先使用 bundle 内置 runtime，而不是依赖源码仓库路径
10. 打包态 app 现在会优先使用 bundle 内置 `bin/node`，不再要求用户机器预装 Node 才能启动本地 service
11. 聊天输入区左侧已补充附件按钮（当前仅 UI），并支持 `Cmd/Ctrl+Enter` 发送

### 2.3 工作台 guidance 层已经补齐

当前这一版最重要的进展之一，是把工作台从“裸入口集合”推进成了“默认克制、按需展开”的工作台。

目前已经存在的 guidance / workflow 提示包括：

1. `Create Guidance`
2. `Train Guidance`
3. `Experiment Guidance`
4. `Pipeline Status`
5. `Suggested Next Step`
6. `Inspector Drawer`

这层产品语义已经能回答：

1. 当前主任务是什么
2. 哪些信息值得现在看
3. 哪些复杂能力应该收进下一层
4. 现在是不是应该先 `Run Smoke`
5. 是不是已经 `ready for PK`

### 2.4 工作流主闭环已经打通

当前 workbench 内部已经能连成下面这条安全主链：

`chat / evidence intake -> memory candidates -> promotion-ready queue -> handoff artifact -> training prep artifact -> train`

并且已经补了两条关键桥接：

1. `evidence intake -> Use For Training`
2. `training prep -> Use For Training`

也就是说，当前用户已经不需要在不同面板之间手动搬路径和 id，工作台本身已经开始承接上下文传递。

### 2.5 运行态治理已经开始产品化

当前客户端已经具备：

1. 全局 `run status banner`
2. 轻量 `run center`
3. `running / recovering / completed / paused, progress saved` 的产品态表达
4. 自动恢复后的 attempt 展示
5. 本地 service 自动检测、自动拉起、自动重连
6. 本地 core 定位状态可解释：repo root / Node / dist readiness / desktop managed service
7. macOS bundle 已验证能从 app 资源中的 staged runtime 启动本地 service
8. macOS bundle 已验证能从 app 资源中的 `bin/node` 启动本地 service
9. Evidence Intake 结果现在可在客户端内直接审查结构化 evidence sample，而不只是看 aggregate 指标

这件事的意义在于：

1. 用户不需要理解底层模型报错
2. 客户端能持续告诉用户系统当前在做什么
3. 训练 / 实验不再只是“点了之后等结果”，而是可观察的运行过程

## 3. 当前已经具备的稳定能力

### 3.1 交流与线程层

当前已稳定具备：

1. 单 Persona 单线程聊天
2. 线程创建、重命名、删除
3. 侧边栏展示最近线程列表，支持悬停删除
4. 会话状态展示
5. 聊天输入支持 `Cmd/Ctrl+Enter` 发送，左侧已补充附件按钮（仅 UI，待后端接口接入）
6. AI 思考状态带 Unicode 动画 spinner

### 3.2 证据与写回层

当前已稳定具备：

1. 本地聊天记录导入
2. transcript-first 视频证据导入
3. intake 前置校验
4. 服务端 intake 硬校验
5. memory candidates 生成
6. accepted / rejected / pending 管理
7. promotion-ready queue
8. handoff artifact
9. training prep artifact

### 3.3 训练与实验层

当前已稳定具备：

1. 人格创建后可直接通过 `/api/runs/train` 启动训练
2. 人格库内嵌「培养中心」子 Tab，展示 `pending / building / ready / error` 状态与进度
3. 创建人格时可选 Quick（3轮）/ Full（10轮）培养模式
4. train prep / evidence intake 上下文挂载
5. `Run Smoke`
6. experiment launch
7. recent runs 查看
8. run report 与 context 联动查看
9. 轻量 run center

### 3.4 消息可解释性

当前聊天消息已经不是只看文本结果。

当前已支持直接看到：

1. persona dimensions 命中数
2. citation 数量
3. retrieved memory 数量
4. citation 摘要卡
5. memory source id 展开与复制

这意味着“回复为什么是这样”已经开始可见，而不是完全黑盒。

## 4. 这一版最核心的产品价值

如果只看这一阶段最重要的价值，不是“按钮更多了”，而是下面三件事：

### 4.1 从功能集合变成工作台

之前更像：

1. 一组功能入口
2. 一组参数表单
3. 一组底层能力映射

现在已经更像：

1. 一个有阶段感的工作台
2. 一个知道上下文怎么流动的工作台
3. 一个能告诉用户当前该做什么的工作台

### 4.2 从技术暴露变成产品表达

当前客户端不再强调：

1. schema 错误
2. timeout 细节
3. provider 底层异常
4. 原始 log 输出

而是强调：

1. `recovering`
2. `paused, progress saved`
3. `start with smoke`
4. `expand corpus first`
5. `ready for PK`

这说明产品层已经开始独立于底层技术细节工作。

### 4.3 从手工搬运变成上下文桥接

这一版真正减少了很多“人为操作负担”：

1. intake 可以直接进 train
2. prep 可以直接进 train
3. run 可以从全局 banner 进入 run center
4. citation / memory source 可以在消息里直接展开看

这类桥接是客户端真正变得可用的关键。

## 5. 当前边界与不足

虽然这一版已经很完整，但它还不是最终产品形态。

当前主要边界包括：

1. 桌面端 UI 已完成重构为 Chat / Personas / Settings 三视图极简结构，但旧版中的右侧 Inspector Drawer（Soul / Memory / Citations / Evidence / Training）、Evidence Intake 面板、Run Center V2 等高级功能尚未在新 UI 中恢复，后续需要按需重新接入
2. run center 已经升级到 V2 的第一步，支持最近 run 的搜索、状态筛选、类型筛选和汇总 badge，但详情 drill-down 仍然偏轻量
3. 线程还没有标签体系、分组体系和更强的历史管理
4. citation / memory source 已经进入第一层下钻，但 retrieved memory 到正式来源资产的链路还不够深
5. handoff / prep 仍然主要是单线程内部链路，还没有更强的跨线程整理体验
6. 桌面端已经能完成本机 Rust 编译与原生启动验证，也能通过 app bundle 内置 runtime 和 bundled Node 完成本地 service 启动；当前剩余边界主要转向 runtime 体积、架构兼容和更新策略

## 6. 下一阶段最值得继续补什么

当前这一轮补完后，下一阶段更值得继续补的是：

1. 继续优化桌面 runtime 体积、架构兼容和更新策略
2. 把聊天和视频的 Evidence Layer 能力正式接进 workbench 主工作流
3. 继续收紧 Chat 区的消息体验、引用展示和写回候选整理体验

当前最自然的下一阶段，不是重做架构，而是在现有 V1 上补两个方向：

### 6.1 Run Center V2

当前已经完成：

1. run 搜索
2. run 状态过滤
3. run 类型过滤
4. 最近运行状态汇总 badge

建议继续补：

1. run 详情 drill-down
2. 更清晰的 create/train/experiment/export 汇总视图
3. 更长时间范围的 run 历史浏览

### 6.2 Source Drill-down

当前已经完成：

1. writeback candidate 可以回看到 source message 片段
2. handoff item 可以回看到 source message 片段
3. training run 可以看到关联的 prep / evidence import / context path / report path
4. chat message 可以看到 writeback candidate id
5. citation / memory 现在可以进一步展开到 memory node detail，查看 summary / original_text / source_type / source_url / tags / relations
6. memory node 现在会解析统一的 source assets，优先接住 web url / local file / evidence import / training prep / promotion handoff / synthetic source
7. source asset 现在可以直接显示 preview，优先展示本地文件、documents、evidence index 或 handoff 内容摘要

建议继续补：

1. citation 到 memory/source 的更深展开
2. retrieved memory 到来源资产的更清晰跳转
3. intake / prep / handoff / run 之间的来源链路串联

### 6.3 会话管理体验

建议继续补：

1. 线程标签
2. 线程分组
3. 长线程整理
4. 更明确的 archived 线程管理

## 7. 一句话总结

如果用一句话总结当前客户端阶段：

> 客户端工作台 V1 已经从“能力入口拼装”进入“可被真实使用的工作台阶段”，下一阶段最值得做的不是重写，而是继续把运行中心、来源可解释性和线程管理做深。
