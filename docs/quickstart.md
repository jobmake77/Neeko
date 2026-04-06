# 快速开始指南

推荐先看：

- [架构设计](/Users/a77/Desktop/Neeko/docs/architecture.md)
- [系统 V1 正式定义](/Users/a77/Desktop/Neeko/docs/system-v1.md)
- [培养阶段 V1 阶段总结](/Users/a77/Desktop/Neeko/docs/training-phase-summary-v1.md)
- [客户端与交流层 V1 方案](/Users/a77/Desktop/Neeko/docs/client-conversation-v1-plan.md)
- [输入架构阶段总结](/Users/a77/Desktop/Neeko/docs/input-architecture-status.md)
- [大语料稳定蒸馏实施方案](/Users/a77/Desktop/Neeko/docs/large-corpus-implementation-plan.md)
- [大语料扩展优化路线图](/Users/a77/Desktop/Neeko/docs/large-corpus-roadmap.md)
- [Dynamic Evidence Scaling Framework](/Users/a77/Desktop/Neeko/docs/dynamic-evidence-scaling-framework.md)

## 第一步：环境准备

### 必须安装

**1. Node.js 18+**
```bash
node --version  # 需要 v18 或更高
```

**2. opencli（OpenCLI 模式需要，API 模式可跳过）**
```bash
npm install -g @jackwener/opencli
```
安装后，确保 Chrome 浏览器已登录 [x.com](https://x.com)。opencli 会复用浏览器的登录状态，无需任何 Twitter API Key。

验证安装：
```bash
opencli twitter search "test" --limit 3 --format json
```

**3. Qdrant（向量数据库）**
```bash
docker run -d -p 6333:6333 --name qdrant qdrant/qdrant
```
验证：访问 http://localhost:6333/dashboard

### API Key 准备

Neeko 支持五个 LLM 提供商，**填入任意一个**即可开始使用：

| Provider | 用途 | 获取地址 |
|----------|------|---------|
| Anthropic Claude | Soul 提炼 + 对话（推荐） | https://console.anthropic.com |
| OpenAI | Embedding + 音视频转录（Whisper） | https://platform.openai.com |
| Kimi（月之暗面） | Soul 提炼 + 对话（可选） | https://platform.moonshot.cn |
| Gemini（Google） | Soul 提炼 + 对话（可选） | https://aistudio.google.com |
| DeepSeek | Soul 提炼 + 对话（可选） | https://platform.deepseek.com |

> API Key 在 Web UI 设置页填写并保存，CLI 和 Web UI 共享同一份配置。

---

## 第二步：安装 Neeko

```bash
git clone https://github.com/jobmake77/Neeko.git
cd Neeko

# 安装 CLI 依赖
npm install
npm run build
```

---

## 第三步：配置

### 方式 A：Web UI 设置页（推荐）

启动 Web UI 后，访问 [http://localhost:3000/settings](http://localhost:3000/settings)：

1. **数据摄取方式**：选择 OpenCLI 模式（免 API）或 API 模式
2. **模型配置**：填入一个或多个 LLM 的 API Key
3. **当前使用模型**：点击圆形按钮选择激活的模型
4. **Qdrant 地址**：默认 `http://localhost:6333`
5. 点击「保存配置」

### 方式 B：CLI 交互式配置

```bash
node dist/cli/index.js config
```

### 方式 C：命令行参数

```bash
node dist/cli/index.js config --api-key sk-ant-xxx
node dist/cli/index.js config --openai-key sk-xxx
node dist/cli/index.js config --qdrant-url http://localhost:6333
node dist/cli/index.js config --training-profile full
```

---

## 第四步：启动 Web UI（推荐）

```bash
cd web
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)

---

## 创建你的第一个 Persona

### Path A：单人蒸馏

**通过 Web UI：**
1. 点击「新建 Persona」
2. 选择「单人蒸馏 Path A」
3. 输入 Twitter 账号（如 `elonmusk`）
4. 点击「开始构建」

**通过 CLI：**
```bash
node dist/cli/index.js create @elonmusk
```

指定训练优化档位（推荐）：
```bash
node dist/cli/index.js create @elonmusk --rounds 10 --training-profile full
```

快速培养（先出结果）：
```bash
node dist/cli/index.js create @elonmusk --rounds 3 --training-profile full
```

流程说明：
1. opencli 从 X.com 抓取该账号的推文（复用 Chrome 登录状态）
2. 生成 `corpus-snapshot.json`、`shard-plan.json`、`input-run-manifest.json`、`shards/<id>/raw-docs.json`、shard distillation summaries 与 global seed assets
3. 清洗 + 分块
4. LLM 提炼 Soul 五个维度
5. 写入 Qdrant 向量记忆库
6. （可选）运行培养循环（5/10/20 轮）

---

### Path B：能力融合

适合没有明确标杆人物，需要拼合多方经验的场景。

```bash
node dist/cli/index.js create --skill "全栈工程师"
```

流程：
1. LLM 拆解「全栈工程师」的子能力维度（前端/后端/数据库/架构...）
2. 为每个维度推荐 2-4 个数据源
3. 你确认/调整数据源
4. 进入采集 → 提炼流程

---

## 培养优化与对照实验

`--training-profile` 可选值：
- `baseline`：旧训练流程基线
- `a1`：课程化训练（Curriculum）
- `a2`：A1 + 评估器标尺校准 + 双评审
- `a3`：A2 + 记忆写入治理（去重/冲突隔离）
- `a4`：A3 + 收敛策略升级
- `full`：完整优化（默认）

运行 A/B 对照实验：
```bash
node dist/cli/index.js experiment elonmusk --rounds 10
```

导出实验报告（JSON/CSV）：
```bash
node dist/cli/index.js experiment elonmusk --rounds 10 --output-dir ./reports
```

运行 A/B 回归对比（默认 baseline vs full，输出表格+JSON/CSV/MD）：
```bash
node dist/cli/index.js ab-regression elonmusk --rounds 10 --gate
```

启用质量门禁（可用于 CI）：
```bash
node dist/cli/index.js experiment elonmusk --rounds 6 --gate
```

实验会对比 `baseline/a1/a2/a3/a4` 的质量与风险指标，并输出推荐默认档位。

当前输入策略建议：
- 安全默认仍是 `legacy + off`
- 当前推荐灰度实验线是 `v2 + off`
- `topics` 与 `signals` 仍作为实验增强项保留
- 当显式请求 `signals` 时，系统会先做 readiness gate；如果 seed 噪声过高，会自动降到 `topics`

继续培养已创建 Persona：
```bash
node dist/cli/index.js train elonmusk --mode quick
node dist/cli/index.js train elonmusk --mode full
```

刷新 Skill 库（蒸馏 3-6 个高质量 Skill）：
```bash
node dist/cli/index.js skills-refresh elonmusk --mode quick
node dist/cli/index.js skills-refresh elonmusk --mode full
```

---

## 与 Persona 对话

### Web UI

点击 Persona 卡片上的「对话」按钮。

在「培养中心」页面你可以：
- 查看每轮培养回放明细与趋势图
- 下载训练报告（JSON/CSV）
- 查看实验历史，展开 profile 对比表
- 一键将某个 profile 设为默认训练档位
- 一键 Resume 训练，并可选择 checkpoint 恢复

### CLI

```bash
node dist/cli/index.js chat elonmusk
```

手动触发某个 Skill：
```text
/skill 谈判框架
请你帮我拆解这次商务谈判的步骤
```

输入 `exit` 退出对话。

---

## 导出 Persona

### Web UI

点击 Persona 卡片右上角的 ⋯ 菜单，选择「导出为 OpenClaw」或「导出为 LobeChat」。

### CLI

```bash
node dist/cli/index.js export elonmusk --to openclaw
```

输出目录：`./neeko-export-elonmusk/`

文件结构：
```
neeko-export-elonmusk/
├── SOUL.md        # 人格档案（可读）
├── IDENTITY.md    # 元数据
├── MEMORY.md      # 记忆索引
├── soul.yaml      # 原始 Soul 数据
└── agent.json     # OpenClaw/LobeChat 配置
```

导入 OpenClaw：
```bash
openclaw agents import ./neeko-export-elonmusk/
```

---

## 常见问题

**Q：opencli 抓取失败怎么办？**

1. 确认 Chrome 已登录 X.com（非无痕模式）
2. 运行 `opencli twitter search "hello" --limit 3` 测试
3. 如仍失败，检查 Chrome 是否在运行
4. 或切换到 API 模式（在设置页配置 Twitter API Key）

**Q：Qdrant 连接失败？**

```bash
docker ps | grep qdrant   # 检查容器是否运行
curl http://localhost:6333/health  # 检查服务健康
```

**Q：培养循环费用大概多少？**

- 5 轮：~$1
- 10 轮：~$2-3
- 20 轮：~$5

推文采集通过 opencli 免费，主要费用来自 LLM 调用。

**Q：Persona 数据存在哪里？**

```
~/.neeko/personas/{slug}/
  persona.json   元数据
  soul.yaml      Soul 数据
```

Qdrant 中的向量数据存储在集合 `nico_{slug}`。

## 运行时监控与断点续训

当 Web 培养任务运行时，Neeko 会写入以下文件（按 persona 独立）：

```
~/.neeko/personas/{slug}/
  runtime-task.json       # queued / running / done / failed
  runtime-progress.json   # stage / percent / round / eta
  training-context.json   # requested_rounds / completed_rounds / last_error
  training-report.json    # 每轮报告（增量落盘）
```

并在全局写入租约锁：

```
~/.neeko/runtime/locks/train-{slug}.lock
```

锁包含 `fencing_token` 与 `expires_at`，训练 worker 会定时心跳续约。  
如果进程异常退出且锁过期/持有者失活，系统会自动恢复继续培养。
