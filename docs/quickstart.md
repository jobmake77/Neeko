# 快速开始指南

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
node dist/index.js config
```

### 方式 C：命令行参数

```bash
node dist/index.js config --api-key sk-ant-xxx
node dist/index.js config --openai-key sk-xxx
node dist/index.js config --qdrant-url http://localhost:6333
node dist/index.js config --training-profile full
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
node dist/index.js create @elonmusk
```

指定训练优化档位（推荐）：
```bash
node dist/index.js create @elonmusk --rounds 10 --training-profile full
```

快速培养（先出结果）：
```bash
node dist/index.js create @elonmusk --rounds 3 --training-profile full
```

流程说明：
1. opencli 从 X.com 抓取该账号的推文（复用 Chrome 登录状态）
2. 清洗 + 分块
3. LLM 提炼 Soul 五个维度
4. 写入 Qdrant 向量记忆库
5. （可选）运行培养循环（5/10/20 轮）

---

### Path B：能力融合

适合没有明确标杆人物，需要拼合多方经验的场景。

```bash
node dist/index.js create --skill "全栈工程师"
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
node dist/index.js experiment elonmusk --rounds 10
```

导出实验报告（JSON/CSV）：
```bash
node dist/index.js experiment elonmusk --rounds 10 --output-dir ./reports
```

启用质量门禁（可用于 CI）：
```bash
node dist/index.js experiment elonmusk --rounds 6 --gate
```

实验会对比 `baseline/a1/a2/a3/a4` 的质量与风险指标，并输出推荐默认档位。

继续培养已创建 Persona：
```bash
node dist/index.js train elonmusk --mode quick
node dist/index.js train elonmusk --mode full
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

### CLI

```bash
node dist/index.js chat elonmusk
```

输入 `exit` 退出对话。

---

## 导出 Persona

### Web UI

点击 Persona 卡片右上角的 ⋯ 菜单，选择「导出为 OpenClaw」或「导出为 LobeChat」。

### CLI

```bash
node dist/index.js export elonmusk --to openclaw
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
