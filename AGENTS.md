# Repository Rules

更新时间：2026-04-18

## 提交纪律

1. 需要正式入库的新增文件，最终负责集成的主 Agent 必须在本轮结束前完成一次 Git 提交并推送到 GitHub。
2. 提交时只提交代码、文档和项目所需资产，不提交过程性大数据、临时实验垃圾和无关缓存。
3. 新增的流程规则、阶段约束和产品方向变化，需要同步更新到本文件。
4. 多 Agent / forked workspace 场景下，子 Agent 默认先交付可审阅改动与 handoff，由主 Agent 统一决定 cherry-pick、提交与推送。

## 多 Agent 协作纪律

1. 默认按“多人类开发者 + 多 Agent 并行”处理仓库，不假设工作树干净，也不假设当前文件只被自己修改。
2. 每个 Agent 开工前必须先确认本轮角色、目标和允许修改的文件或模块；任务里写明的编辑范围属于硬边界，不得顺手扩写到范围外文件。
3. 未经明确授权，不得回滚、覆盖、整理或格式化他人正在修改的内容；如果同文件已有未理解的改动，优先避开，必要时交接给主 Agent 决策。
4. 多 Agent 产出以“最小可审阅增量”为优先，避免无关 rename、大范围重排、统一格式化和顺手修复。
5. 子 Agent 交付时必须明确列出 `changed files`、每个文件新增或修改的 section / 要点、未执行的验证，以及需要主 Agent 后续集成或复核的事项。
6. 若任务被限定为 docs、评审、实现、测试等特定角色，该角色只在授权范围内产出结果；跨角色改动需要主 Agent 明确重新分派。

## 当前阶段方向

1. 当前培养主线已经进入阶段性收口，后续继续保留实验能力，但不再把“继续扩容”作为唯一主线。
2. 下一阶段主产品方向切换为“客户端 + CLI”。
3. 当前不再继续推进新的浏览器产品界面方案；如果需要 UI，优先做客户端桌面端体验。
4. 客户端工作台 V1 采用 `Tauri + 本地 workbench-server + 复用 Node core/CLI` 的分层结构推进。
5. 第一版工作台坚持“单线程单 Persona、自动生成 memory candidates、不直接写 Soul”。
6. 当前客户端写回链路新增 `promotion-ready -> handoff artifact` 中间层，但仍不允许直接写正式 `Soul` 或正式长期记忆。
7. 当前工作台允许把 `handoff` 转成 `training prep artifact`，但它仍然只是安全适配层，不等于正式训练写回。
8. 当前工作台允许把 `training prep / evidence import` 作为 train launch 的 `prep context` 附加到运行上下文里，但它只用于追踪与审计，不改变训练核心逻辑。
9. 当前桌面客户端产品形态已切到 `客户端极简重构 V2`：一级视图只保留 `聊天 / 人格库 / 设置`。
10. 当前客户端不再向用户暴露 `Soul / Memory / Training / Experiment / Export / Evidence / Inspector` 等内部术语、流程与日志。
11. 当前 `人格库` 采用 `左侧列表 + 右侧详情编辑` 结构；Persona 创建必须走两步向导，Persona 编辑保存后自动触发后台重建。
12. 当前聊天页只允许展示 `当前 Persona / 线程列表 / 消息流 / 输入框`；不允许继续回流证据导入、训练上下文、写回状态、摘要卡等内部面板。
13. 当前设置页只保留基础设置：`API 地址 / 本地服务连接 / 语言 / 数据目录或仓库根目录`；不再继续承载训练、实验、导出表单。
14. 当前桌面客户端默认语言为中文，同时保留中英文切换；新增面向用户的枚举词和状态文案必须优先给出中文语义。
15. 当前桌面客户端默认接管本地 `workbench-server` 连接恢复：当使用本地 URL 时，客户端应优先自动检测、自动拉起、自动重连，而不是把底层启动失败直接抛给用户。
16. 当前 Persona 删除语义固定为本地硬删除：删除 persona 目录、会话、候选、handoff、evidence import、training prep、runs 以及关联索引资产，不保留归档模式。
17. 当前桌面打包链路需要自动准备 `desktop/runtime/neeko-runtime`，并把它作为 app bundle 资源带入客户端；这类 staging 目录必须忽略提交，不能进 Git。
18. 当前桌面打包链路中的 `neeko-runtime` 需要同时携带 `dist`、生产依赖和 `bin/node`，保证打包 app 优先使用内置 Node runtime，而不是依赖用户本机预装。
19. 当前桌面打包链路中的 `neeko-runtime` 还必须携带运行时必需的 `scripts/` 目录；凡是服务端在运行时通过相对仓库路径调用的脚本，都不能只存在于源码仓库而漏进 app bundle。

## 交流层纪律

1. 会话层默认只允许写 `conversation log`、`session summary`、`memory candidates`。
2. 不允许在客户端会话过程中直接写 `Soul`。
3. 任何自动写回规则上线前，都必须先有可解释的候选层和回退路径。
4. `promotion-ready` 候选只允许汇总成 handoff artifact，供后续训练/人工整理使用，不能绕过审核层直接落正式资产。
5. `training prep artifact` 只允许作为训练输入准备层存在，不能绕过治理和审核直接改正式人格资产。
6. train launch 上附带的 `prep context` 只允许写入运行上下文和追踪文件，不能被当作直接写正式资产的捷径。
