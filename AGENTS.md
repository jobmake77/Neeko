# Repository Rules

更新时间：2026-04-06

## 提交纪律

1. 只要本轮工作新增了文件，结束本轮前必须完成一次 Git 提交并推送到 GitHub。
2. 提交时只提交代码、文档和项目所需资产，不提交过程性大数据、临时实验垃圾和无关缓存。
3. 新增的流程规则、阶段约束和产品方向变化，需要同步更新到本文件。

## 当前阶段方向

1. 当前培养主线已经进入阶段性收口，后续继续保留实验能力，但不再把“继续扩容”作为唯一主线。
2. 下一阶段主产品方向切换为“客户端 + CLI”。
3. 当前不再继续推进新的 Web 页面方案；如果需要 UI，优先做客户端桌面端体验。
4. 客户端工作台 V1 采用 `Tauri + 本地 workbench-server + 复用 Node core/CLI` 的分层结构推进。
5. 第一版工作台坚持“单线程单 Persona、自动生成 memory candidates、不直接写 Soul”。
6. 当前客户端写回链路新增 `promotion-ready -> handoff artifact` 中间层，但仍不允许直接写正式 `Soul` 或正式长期记忆。
7. 当前工作台允许把 `handoff` 转成 `training prep artifact`，但它仍然只是安全适配层，不等于正式训练写回。

## 交流层纪律

1. 会话层默认只允许写 `conversation log`、`session summary`、`memory candidates`。
2. 不允许在客户端会话过程中直接写 `Soul`。
3. 任何自动写回规则上线前，都必须先有可解释的候选层和回退路径。
4. `promotion-ready` 候选只允许汇总成 handoff artifact，供后续训练/人工整理使用，不能绕过审核层直接落正式资产。
5. `training prep artifact` 只允许作为训练输入准备层存在，不能绕过治理和审核直接改正式人格资产。
