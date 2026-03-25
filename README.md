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
- 🆓 **无需 Twitter API Key** — 通过 [opencli](https://github.com/jackwener/opencli) 复用 Chrome 浏览器登录状态免费抓取推文
- 🧬 **五维 Soul 模型** — 语言风格 / 价值观 / 思维模式 / 行为特征 / 知识领域
- 🧠 **向量记忆库** — Qdrant 存储，支持时间衰减 + 强化权重的混合检索
- 🔄 **自动培养循环** — Trainer → Persona → Evaluator → Director，最多 20 轮收敛
- 🖥️ **Web + CLI 双界面** — 现代化 Web UI + 命令行工具

---

## 两种创建路径

| 路径 | 命令 | 场景 |
|------|------|------|
| **A：单人蒸馏** | `neeko create @elonmusk` | 有明确标杆人物，数据量充足 |
| **B：能力融合** | `neeko create --skill "全栈工程师"` | 无明确标杆，组合多位专家 |

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- Chrome 浏览器（已登录 X.com）
- [opencli](https://github.com/jackwener/opencli)：`npm install -g @jackwener/opencli`
- Anthropic API Key（Soul 提炼 + 培养循环）
- OpenAI API Key（Embedding + Whisper 转录）
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

### CLI

```bash
# 配置 API Key
node dist/index.js config

# 创建 Persona（Path A：单人蒸馏）
node dist/index.js create @elonmusk

# 创建 Persona（Path B：能力融合）
node dist/index.js create --skill "产品经理"

# 与 Persona 对话
node dist/index.js chat elonmusk

# 查看所有 Persona
node dist/index.js list

# 导出为 OpenClaw 格式
node dist/index.js export elonmusk --to openclaw
```

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
| **PersonaAgent** | claude-haiku-4-5 | 基于 Soul + RAG 扮演目标人物 |
| **TrainerAgent** | claude-haiku-4-5 | 生成 4 种策略的训练问题 |
| **EvaluatorAgent** | claude-sonnet-4-6 | 独立裁判，评分 + 提取新记忆 |
| **DirectorAgent** | claude-sonnet-4-6 | 掌控全局，决策收敛 |

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
| **LLM** | Anthropic Claude（Sonnet 4.6 + Haiku 4.5） |
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
│   │   └── commands/             # create / chat / list / export / config
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
│   │   ├── export/               # 导出
│   │   ├── settings/             # 设置
│   │   └── api/                  # API Routes
│   └── components/
│       ├── sidebar.tsx
│       └── persona-card.tsx
├── package.json                  # CLI 依赖
└── tsup.config.ts                # 打包配置
```

---

## 收敛条件

培养循环在**全部满足**以下条件时停止：

1. 连续 3 轮新写入记忆节点 < 3 条
2. Soul 整体置信度 > 80%
3. 覆盖率评分 > 85%
4. 安全上限：最多 20 轮

---

## 免责声明

Neeko 创建的是基于公开数据的 AI 模拟，**不代表真实人物**。请在专业场合明确告知对方这是 AI 模拟。仅处理公开内容，请遵守相关平台服务条款。

---

## License

MIT
