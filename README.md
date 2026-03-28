# Neeko — 数字孪生工厂

> 输入一个真实人物的公开数据，输出一个可工作的 AI 数字副本。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)

---

## 是什么

Neeko 是一个「数字孪生工厂」——你给它一个人的公开内容（推文、文章、视频），它通过 **Soul 提炼 + Memory 构建 + 培养循环**，输出一个能模拟该人物思维方式和说话风格的 AI Agent。

```
公开内容 → [Neeko] → 可对话的数字孪生 → 导出为 OpenClaw/LobeChat 配置
```

**核心特点：**
- 🆓 **双模数据采集** — OpenCLI 模式（复用 Chrome 登录，免 API Key）或 API 模式（Twitter 官方 API）
- 🧬 **五维 Soul 模型** — 语言风格 / 价值观 / 思维模式 / 行为特征 / 知识领域
- 🧠 **向量记忆库** — Qdrant 存储，支持时间衰减 + 强化权重的混合检索
- 🔄 **自动培养循环（v2）** — 课程化出题 + 双评审校准 + 记忆治理 + 指标驱动收敛
- 🤖 **多模型支持** — Claude、OpenAI、Kimi（月之暗面）、Gemini、DeepSeek 可自由切换
- 🖥️ **Web + CLI 双界面** — 现代化 Web UI + 命令行工具

---

## 两种创建路径

| 路径 | 命令 | 场景 |
|------|------|------|
| **A：单人蒸馏** | `node dist/cli/index.js create @elonmusk` | 有明确标杆人物，数据量充足 |
| **B：能力融合** | `node dist/cli/index.js create --skill "全栈工程师"` | 无明确标杆，组合多位专家 |

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- Chrome 浏览器（已登录 X.com，OpenCLI 模式需要）
- [opencli](https://github.com/jackwener/opencli)：`npm install -g @jackwener/opencli`（OpenCLI 模式）
- 至少一个 LLM API Key（Claude / OpenAI / Kimi / Gemini / DeepSeek，在 Web UI 设置页配置）
- Qdrant（向量数据库）：`docker run -p 6333:6333 qdrant/qdrant`

### 安装

```bash
git clone https://github.com/jobmake77/Neeko.git
cd Neeko

# 安装 CLI 依赖
npm install
npm run build

# 启动 Web UI
cd web && npm install && npm run dev
```

### Web UI

访问 [http://localhost:3000](http://localhost:3000)

首次使用请进入**设置页**配置：
- **数据摄取方式**：OpenCLI 模式（免 API）或 API 模式（需 Twitter API Key）
- **模型**：填入任意一个或多个 LLM 的 API Key，然后点选"当前使用模型"
- **Qdrant 地址**：默认 `http://localhost:6333`

### CLI

```bash
# 配置 API Key
node dist/cli/index.js config

# 设置默认训练档位（create 未显式传参时生效）
node dist/cli/index.js config --training-profile full

# 创建 Persona（Path A：单人蒸馏）
node dist/cli/index.js create @elonmusk

# 创建 Persona（指定训练优化档位）
node dist/cli/index.js create @elonmusk --rounds 10 --training-profile full

# 快速培养（3轮，先出结果）
node dist/cli/index.js create @elonmusk --rounds 3 --training-profile full

# 已创建后继续培养（可多次追加）
node dist/cli/index.js train elonmusk --mode quick
node dist/cli/index.js train elonmusk --mode full
# 如模型偶发格式错误，可增加自动重试次数
node dist/cli/index.js train elonmusk --mode quick --retries 3

# 创建 Persona（Path B：能力融合）
node dist/cli/index.js create --skill "产品经理"

# 与 Persona 对话
node dist/cli/index.js chat elonmusk

# 查看所有 Persona
node dist/cli/index.js list

# 导出为 OpenClaw 格式
node dist/cli/index.js export elonmusk --to openclaw

# A/B 对照实验（baseline / A1 / A2 / A3 / A4）
node dist/cli/index.js experiment elonmusk --rounds 10

# A/B 对照实验并导出 JSON/CSV 报告
node dist/cli/index.js experiment elonmusk --rounds 10 --output-dir ./reports

# 启用质量门禁（full 对比 baseline，退化时返回非 0）
node dist/cli/index.js experiment elonmusk --rounds 6 --gate
```

`--training-profile` 可选值：
- `baseline`：旧训练流程基线
- `a1`：课程化训练（Curriculum）
- `a2`：A1 + 评估器标尺校准 + 双评审
- `a3`：A2 + 记忆写入治理（去重/冲突隔离）
- `a4`：A3 + 收敛策略升级
- `full`：完整优化（默认）

---

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│                    Neeko 系统                        │
│                                                     │
│  输入层          炼化层              输出层           │
│  ──────          ──────              ──────          │
│  Twitter/X  →   Soul 提炼    →   对话 Persona        │
│  (opencli)      Memory 构建      OpenClaw 导出       │
│  文章/视频       培养循环          LobeChat 格式       │
│  聊天记录        收敛判断                             │
└─────────────────────────────────────────────────────┘
```

### 数据流

```
原始内容
  → Source Adapter（twitter/article/video/chat）
  → Data Cleaner（去重 + 过滤）
  → Semantic Chunker（分块）
  → Soul Extractor（LLM 并行提取 5 维度）
  → Soul Aggregator（聚合 + 置信度过滤）
  → Memory Store（Qdrant 向量存储）
  → Training Loop（培养循环）
  → 收敛 → 导出
```

### 四个核心 Agent

| Agent | 模型 | 职责 |
|-------|------|------|
| **PersonaAgent** | 按配置动态选择 | 基于 Soul + RAG 扮演目标人物 |
| **TrainerAgent** | 按配置动态选择 | 课程化生成 4 种策略训练问题 |
| **EvaluatorAgent** | 按配置动态选择 | 独立裁判，支持标尺校准与双评审 |
| **DirectorAgent** | 按配置动态选择 | 掌控全局，结合观测指标决策收敛 |

---

## Soul 模型

Soul 是 Persona 的「灵魂」，以 YAML 结构化存储，运行时渲染为 System Prompt。

```yaml
version: 3
target_name: "Elon Musk"
overall_confidence: 0.84

language_style:
  formality_level: 0.3        # 0=随意, 1=正式
  avg_sentence_length: short
  frequent_phrases: ["First principles", "Ideally", ...]

values:
  core_beliefs:
    - belief: "人类应该成为多星球文明"
      confidence: 0.95
      stance: strong

thinking_patterns:
  first_principles_tendency: 0.92
  analogy_usage: frequent

knowledge_domains:
  expert: [航天, 电动汽车, AI, 能源]
  familiar: [物理, 工程, 经济]
  blind_spots: [艺术, 传统政治]
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| **语言** | TypeScript 5.x |
| **Web UI** | Next.js 15 + shadcn/ui + Tailwind CSS |
| **CLI** | Commander + @clack/prompts + Chalk |
| **AI SDK** | Vercel AI SDK（统一接口，支持多模型） |
| **LLM** | Anthropic Claude / OpenAI / Kimi（月之暗面）/ Gemini（Google）/ DeepSeek |
| **推文采集** | opencli（复用浏览器状态，免 API） |
| **向量数据库** | Qdrant + text-embedding-3-small |
| **音视频转录** | OpenAI Whisper API |
| **打包** | tsup（基于 esbuild） |
| **模板引擎** | Nunjucks（Soul → System Prompt） |

---

## 成本估算

| 操作 | 模型 | 估算费用 |
|------|------|---------|
| Soul 提炼（100 chunks） | claude-sonnet-4-6 | ~$0.3 |
| 培养循环（10 轮） | haiku-4-5 + sonnet-4-6 | ~$1.5 |
| 日常对话 | claude-haiku-4-5 | ~$0.01/次 |
| **完整 Persona 构建** | 合计 | **~$2–5** |
| 推文采集 | opencli（免费） | **$0** |

---

## 导出格式

```
neeko-export-elonmusk/
├── SOUL.md        # 人格档案（可读）
├── IDENTITY.md    # Persona 元数据
├── MEMORY.md      # 记忆索引
├── soul.yaml      # 原始 Soul 数据
└── agent.json     # OpenClaw/LobeChat Agent 配置
```

导入命令：
```bash
openclaw agents import ./neeko-export-elonmusk/
```

---

## 项目结构

```
Neeko/
├── src/                          # CLI + 核心逻辑
│   ├── cli/
│   │   ├── index.ts              # CLI 入口
│   │   └── commands/             # create / chat / chat-once / list / export / config / experiment
│   ├── core/
│   │   ├── models/               # Soul / Memory / Persona 类型定义
│   │   ├── pipeline/
│   │   │   └── ingestion/        # Twitter(opencli) / Article / Video / Chat 适配器
│   │   ├── soul/                 # 提炼 / 聚合 / 渲染
│   │   ├── memory/               # Qdrant 存储 + 混合检索
│   │   ├── agents/               # 四个核心 Agent
│   │   ├── training/             # 培养循环 + 收敛判断
│   │   └── recommender/          # 数据源推荐引擎（Path B）
│   ├── exporters/
│   │   └── openclaw.ts           # OpenClaw 导出器
│   └── config/
│       └── settings.ts           # 全局配置
├── web/                          # Next.js Web UI
│   ├── app/
│   │   ├── page.tsx              # Persona 列表
│   │   ├── create/               # 新建向导
│   │   ├── chat/[slug]/          # 对话页
│   │   ├── training/             # 培养中心
│   │   ├── settings/             # 设置（数据摄取 / 多模型 / Qdrant）
│   │   └── api/                  # API Routes
│   │       ├── personas/         # Persona CRUD
│   │       └── settings/         # 配置读写（共享 ~/.config/neeko）
│   └── components/
│       ├── sidebar.tsx
│       └── persona-card.tsx      # 含 ⋯ 下拉菜单（导出 / 删除）
├── package.json                  # CLI 依赖
└── tsup.config.ts                # 打包配置
```

---

## 收敛条件

培养循环在**全部满足**以下条件时停止：

1. 连续 3 轮新写入记忆节点 < 3 条
2. Soul 整体置信度 > 80%
3. 覆盖率评分 > 85%
4. 矛盾率（contradiction rate）低于阈值（默认 15%）
5. 最近 3 轮高价值新记忆增长趋稳（平均值不高于阈值）
6. 安全上限：最多 20 轮

---

## 训练优化实践（已落地）

### 1) 训练课程化（Curriculum Training）
- 策略顺序：`consistency -> scenario -> stress_test -> blind_spot`
- 每轮按 Soul 低置信维度动态分配题量

### 2) 评估器标尺校准（Evaluator Calibration）
- 固化评分 rubric（consistency / authenticity / depth）
- 引入 calibration set，减少评分漂移
- 支持双评审：仅在分歧较大时触发融合裁决

### 3) 记忆写入治理（Memory Governance）
- 写入前执行：置信度阈值、去重、冲突检测
- 冲突候选进入隔离队列，交由 Director 后续裁决

### 4) 训练可观测性（Training Observability）
- 每轮记录：评分分布、低置信维度覆盖率、矛盾率、重复率、高价值记忆增长
- 观测指标反向驱动下一轮出题策略

### 5) A/B 对照实验
- 内置 `experiment` 命令，批量运行 `baseline/a1/a2/a3/a4`
- 输出质量与风险指标，并给出推荐默认档位
- 支持导出 JSON/CSV 报告用于长期追踪
- 支持质量门禁（`--gate`）：当 `full` 相比 `baseline` 质量下降或风险上升超过阈值时返回非 0（可接 CI）

### 6) 培养中心（Web）
- 支持查看单个 Persona 的每轮回放明细与质量/矛盾率趋势图
- 支持下载训练报告（JSON/CSV）
- 支持查看实验历史、展开 profile 对比表并一键设为默认训练档位

### 7) 锁与恢复机制（v2）
- 训练任务采用单实例串行队列（同一 persona 同时只允许 1 个训练/刷新任务）
- 使用租约锁（Lease Lock）：`owner_id / pid / fencing_token / expires_at / last_heartbeat_at`
- Worker 定时心跳续约；锁过期或进程失活时允许抢占恢复，防止“死锁文件”永久卡住
- 训练中每轮增量落盘 checkpoint（`persona.json / soul.yaml / training-report.json / training-context.json`）
- 训练中断后可基于 `training-context.json` 自动或手动续训，不需要从第 1 轮重跑

---

## 免责声明

Neeko 创建的是基于公开数据的 AI 模拟，**不代表真实人物**。请在专业场合明确告知对方这是 AI 模拟。仅处理公开内容，请遵守相关平台服务条款。

---

## License

MIT
