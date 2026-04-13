# 快速开始

更新时间：2026-04-13

这份文档面向当前真实产品形态：`桌面客户端 + CLI + 本地 workbench-server`。

如果你第一次接触仓库，建议按下面顺序阅读：

1. [README](/Users/a77/Desktop/Neeko/README.md)
2. [项目状态总览](/Users/a77/Desktop/Neeko/docs/project-status-overview.md)
3. [训练流程总览](/Users/a77/Desktop/Neeko/docs/training-runtime-overview.md)
4. [架构设计](/Users/a77/Desktop/Neeko/docs/architecture.md)

## 1. 环境准备

### 必须项

- Node.js `18+`
- npm
- Qdrant
- 至少一个可用的模型 API Key

### 推荐项

- `opencli`
  - 用于浏览器态抓取社交内容
- `yt-dlp`
  - 用于远程视频获取
- Rust 与 Tauri 依赖
  - 如果要启动桌面壳

### 启动 Qdrant

```bash
docker run -d -p 6333:6333 --name qdrant qdrant/qdrant
```

## 2. 安装项目

```bash
git clone https://github.com/jobmake77/Neeko.git
cd Neeko
npm install
npm run build
```

如果你要跑桌面端：

```bash
npm --prefix desktop install
```

## 3. 启动本地服务

```bash
node dist/cli/index.js workbench-server
```

默认地址：

- `http://127.0.0.1:4310`

## 4. 启动桌面端

### 4.1 仅启动前端开发服务

```bash
npm --prefix desktop run dev
```

### 4.2 启动 Tauri 桌面应用

```bash
npm --prefix desktop run tauri:dev
```

如果 Tauri 首次启动失败，优先检查：

- Rust 是否安装
- 系统依赖是否完整
- 本地 `workbench-server` 是否可用

## 5. 第一次配置

可以通过客户端设置页或 CLI 配置运行时。

### 5.1 CLI 配置

```bash
node dist/cli/index.js config
```

### 5.2 当前重点配置项

- 聊天模型 provider / model
- 培养模型 provider / model
- API Key
- Qdrant URL
- 数据目录
- 本地服务地址

说明：

- 当前系统支持聊天模型与培养模型分离配置
- 也支持统一共享一套 provider / model
- 聊天主路由失败时，会自动尝试备用聊天 provider

## 6. 创建第一个 persona

### 6.1 CLI 创建

```bash
node dist/cli/index.js create @elonmusk --rounds 3 --training-profile full
```

这条命令会大致执行：

1. 拉取素材
2. 标准化素材
3. 构建初始 `Soul`
4. 写入 `Memory`
5. 进入训练轮次

### 6.2 当前常见训练命令

```bash
# 快速继续培养
node dist/cli/index.js train elonmusk --mode quick

# 完整继续培养
node dist/cli/index.js train elonmusk --mode full

# 指定轮次
node dist/cli/index.js train elonmusk --rounds 3 --training-profile full
```

## 7. 和 persona 对话

### 7.1 CLI

```bash
node dist/cli/index.js chat elonmusk
```

### 7.2 桌面端

1. 打开 `聊天`
2. 选择 persona
3. 新建或切换线程
4. 输入消息并发送

当前聊天页支持：

- 模型选择
- 附件上传
- provider failover
- 隐藏底层 prompt / memory / training 内部实现

## 8. 人格库里可以做什么

当前 `人格库` 主要负责两件事：

### 8.1 素材池编辑

可以维护：

- `social`
- `chat_file`
- `video_file`
- `article`
- 候选发现来源

### 8.2 培养中心查看

可以查看：

- 当前状态
- 进度条
- 轮次
- 技能摘要
- 素材摘要
- 最近更新结果

并触发：

- `check updates`
- `continue cultivation`
- `retry`

## 9. 常用命令

```bash
# 列出 persona
node dist/cli/index.js list

# 创建 persona
node dist/cli/index.js create @handle --rounds 3 --training-profile full

# 继续培养
node dist/cli/index.js train handle --mode full

# 对话
node dist/cli/index.js chat handle

# 导出
node dist/cli/index.js export handle --to openclaw

# 实验
node dist/cli/index.js experiment handle --rounds 6
```

## 10. 关键输出文件

一个 persona 训练后，你通常会在 persona 目录下看到这些文件：

- `persona.json`
- `soul.yaml`
- `training-context.json`
- `training-report.json`
- `checkpoint_index.json`
- `evidence-index.jsonl`
- `evidence-stats.json`

这些文件分别承担：

- 人格摘要
- Soul 资产
- 当前训练状态
- 训练报告
- checkpoint 恢复
- 证据索引与统计

## 11. 当前不建议怎么理解这个项目

不建议把 Neeko 理解成：

- 一个普通聊天套壳
- 一个单纯抓推文的脚本
- 一个底模微调平台

当前更准确的理解是：

- 一个本地化的人格培养系统
- 一个可持续更新的素材池 + 训练 + 聊天闭环
- 一个以桌面客户端为主入口、CLI 为深度调试入口的工程系统

## 12. 下一步读什么

如果你已经能把项目跑起来，下一步建议继续看：

- [项目状态总览](/Users/a77/Desktop/Neeko/docs/project-status-overview.md)
- [训练流程总览](/Users/a77/Desktop/Neeko/docs/training-runtime-overview.md)
- [架构设计](/Users/a77/Desktop/Neeko/docs/architecture.md)
- [输入架构阶段总结](/Users/a77/Desktop/Neeko/docs/input-architecture-status.md)
