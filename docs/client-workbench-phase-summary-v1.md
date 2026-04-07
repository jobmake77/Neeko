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

### 2.2 工作台六个主工作面已经成型

当前桌面工作台已经形成稳定的六个主工作面：

1. `Chat`
2. `Create`
3. `Train`
4. `Experiment`
5. `Export`
6. `Settings`

其中：

1. `Chat` 负责线程交流、Evidence Intake、消息信号查看
2. `Create` 负责 persona 初始创建
3. `Train` 负责训练发起、Smoke、上下文挂载
4. `Experiment` 负责 profile / routing / seed 对照
5. `Export` 负责导出
6. `Settings` 负责本地服务与连接状态

### 2.3 工作台 guidance 层已经补齐

当前这一版最重要的进展之一，是把工作台从“裸入口集合”推进成了“会指导动作的工作台”。

目前已经存在的 guidance / workflow 提示包括：

1. `Create Guidance`
2. `Train Guidance`
3. `Experiment Guidance`
4. `Pipeline Status`
5. `Suggested Next Step`
6. `Run Status Banner`

这层产品语义已经能回答：

1. 当前在哪一阶段
2. 下一步更适合做什么
3. 现在是不是应该先 `Run Smoke`
4. 现在是不是应该先 `expand corpus`
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

这件事的意义在于：

1. 用户不需要理解底层模型报错
2. 客户端能持续告诉用户系统当前在做什么
3. 训练 / 实验不再只是“点了之后等结果”，而是可观察的运行过程

## 3. 当前已经具备的稳定能力

### 3.1 交流与线程层

当前已稳定具备：

1. 单 Persona 单线程聊天
2. 线程创建、重命名、删除
3. 线程搜索
4. 线程状态筛选：`all / active / idle / archived`
5. 会话 summary 刷新
6. 会话状态与 summary 新鲜度展示

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

1. train launch
2. train prep / evidence intake 上下文挂载
3. `Run Smoke`
4. experiment launch
5. recent runs 查看
6. run report 与 context 联动查看
7. 轻量 run center

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

1. run center 已经升级到 V2 的第一步，支持最近 run 的搜索、状态筛选、类型筛选和汇总 badge，但详情 drill-down 仍然偏轻量
2. 线程还没有标签体系、分组体系和更强的历史管理
3. citation / memory source 已经进入第一层下钻，但 retrieved memory 到正式来源资产的链路还不够深
4. handoff / prep 仍然主要是单线程内部链路，还没有更强的跨线程整理体验
5. 还没有针对桌面端做完整的 Rust 打包验证，因为当前环境没有 `cargo`

## 6. 下一阶段最值得继续补什么

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
