# 快速开始指南

## 第一步：环境准备

### 必须安装

**1. Node.js 18+**
```bash
node --version  # 需要 v18 或更高
```

**2. opencli（推文免费采集）**
```bash
npm install -g @jackwener/opencli
```
安装后，确保 Chrome 浏览器已登录 [x.com](https://x.com)。opencli 会复用浏览器的登录状态，无需任何 API Key。

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

| Key | 用途 | 获取地址 |
|-----|------|---------|
| Anthropic API Key | Soul 提炼 + 培养循环 + 对话 | https://console.anthropic.com |
| OpenAI API Key | Embedding + 音视频转录（Whisper） | https://platform.openai.com |

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

### 方式 A：交互式配置（推荐）

```bash
node dist/index.js config
```

### 方式 B：命令行参数

```bash
node dist/index.js config --api-key sk-ant-xxx
node dist/index.js config --openai-key sk-xxx
node dist/index.js config --qdrant-url http://localhost:6333
```

### 方式 C：环境变量

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
export OPENAI_API_KEY=sk-xxx
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

## 与 Persona 对话

### Web UI

点击 Persona 卡片上的「对话」按钮。

### CLI

```bash
node dist/index.js chat elonmusk
```

输入 `exit` 退出对话。

---

## 导出 Persona

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

Qdrant 中的向量数据存储在集合 `neeko_{slug}`。
