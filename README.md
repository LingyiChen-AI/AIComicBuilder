# AI Comic Builder


社区交流：[https://linux.do/](https://linux.do/)

> v0.2.3

AI 驱动的漫剧生成器 — 从剧本到动画视频的全自动流水线。

📺 **系统介绍视频**：

[Bilibili](https://www.bilibili.com/video/BV1gMQSBQEoi/) 

[v0.2.1 版本更新](https://www.bilibili.com/video/BV13CXQB8EwL/)

[v0.2.2 Seedance 2.0 接入 + 参考图模式重构](https://www.bilibili.com/video/BV1v4DZBmEiw/)


本网站全程由 AI 驱动开发， 开发指南：https://github.com/twwch/vibe-coding




## 功能特性

- **剧本导入** — 支持上传 TXT/DOCX/PDF 文件，AI 自动解析文本、提取角色、智能分集，流程可视化
- **分集管理** — 项目级分集列表，角色按集关联，支持手动创建或导入自动分集
- **角色管理** — 项目级角色管理，主角/配角分区展示，支持跨集复用和按集独立解析
- **剧本创作** — 手动编写或 AI 辅助生成剧本
- **角色提取** — AI 自动从剧本中提取角色并生成详细视觉描述
- **角色四视图** — 为每个角色生成四视图参考图（正面/四分之三/侧面/背面），确保后续帧画面一致性
- **智能分镜** — AI 将剧本拆解为专业镜头列表（含构图、灯光、运镜指令）
- **首尾帧生成** — 为每个镜头生成起始帧和结束帧关键画面（首尾帧模式 / 场景参考帧模式）
- **视频提示词** — AI 基于分镜描述和参考帧自动生成视频提示词，支持直接编辑
- **视频生成** — 基于首尾帧插值生成动画视频片段
- **视频合成** — 将所有片段拼接为完整动画，支持字幕烧录
- **分镜工作流** — 分镜编辑抽屉、角色内联面板、看板视图三种协作视图，支持单张分镜精细编辑
- **帧图管理** — 生成帧支持手动上传替换及一键清除
- **资源下载** — 支持最终视频下载及全部素材打包下载
- **多语言** — 中文 / English / 日本語 / 한국어
- **风格自适应** — 自动识别剧本风格（动漫/写实等），角色四视图与首尾帧生成均匹配对应风格
- **视频比例** — 支持 16:9 / 9:16 / 1:1 / 自适应比例，首尾帧与视频生成统一比例
- **多模型** — 支持 OpenAI、Gemini、Kling、Seedance、Veo 等多家 AI 供应商，可按项目配置
- **Grok 视频** — 支持 xAI / 兼容网关的 Grok 视频接口，含 Grok 1.5 首尾帧与参考图模式；[配置及测试说明](docs/grok-video.md)

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 前端 | React 19, Tailwind CSS 4, Zustand, Base UI |
| 国际化 | next-intl |
| 数据库 | SQLite + Drizzle ORM |
| AI 文本 | OpenAI / Gemini (via AI SDK) |
| AI 图像 | OpenAI DALL-E / Gemini Imagen / Kling |
| AI 视频 | Seedance / Kling / Veo |
| 视频处理 | FFmpeg (fluent-ffmpeg) |
| 包管理 | pnpm |

## 快速开始

### 环境要求

- Node.js 18+
- pnpm
- FFmpeg（视频合成功能需要）

### 安装

```bash
pnpm install
```

### 初始化数据库

```bash
pnpm drizzle-kit push
```

### 启动

```bash
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)

## Docker 部署

### 快速启动

```bash
docker run -d \
  --name ai-comic-builder \
  -p 3000:3000 \
  -v ./data:/app/data \
  -v ./uploads:/app/uploads \
  --platform linux/amd64 \
  twwch/aicomicbuilder:latest
```

启动后在设置页面中配置 AI 模型供应商（OpenAI / Gemini / Seedance）。

### Docker Compose

创建 `docker-compose.yml`：

```yaml
services:
  ai-comic-builder:
    image: twwch/aicomicbuilder:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
    restart: unless-stopped
```

```bash
docker compose up -d
```

### 数据持久化

通过 volume 挂载保持数据：

- `./data` — SQLite 数据库文件
- `./uploads` — 上传的文件及生成的资源（图片、视频等）

### 手动构建镜像

```bash
git clone https://github.com/twwch/AIComicBuilder.git
cd AIComicBuilder
docker build -t ai-comic-builder .
```

## 生成流水线

```
剧本输入 → 剧本解析 → 角色提取 → 角色四视图
                                      ↓
                                   智能分镜
                                      ↓
                         参考帧生成 / 首尾帧生成（逐镜头）
                                      ↓
                              视频提示词生成（逐镜头）
                                      ↓
                              视频生成（逐镜头）
                                      ↓
                                 视频合成 + 字幕
```

每个阶段支持单独触发或批量生成，用户可完全控制流水线节奏。分镜页提供列表视图和看板视图，看板按生成进度自动分列。支持分镜版本管理，可创建多个版本进行对比迭代。

## 项目结构

```
src/
├── app/
│   ├── [locale]/                # i18n 路由
│   │   ├── (dashboard)/         # 项目列表
│   │   ├── project/[id]/        # 项目编辑器
│   │   │   ├── script/          # 剧本编辑
│   │   │   ├── characters/      # 角色管理
│   │   │   ├── storyboard/      # 分镜面板
│   │   │   └── preview/         # 预览 & 合成
│   │   └── settings/            # 模型配置
│   └── api/                     # API 路由
├── components/
│   ├── ui/                      # 基础 UI 组件
│   ├── editor/                  # 编辑器组件
│   └── settings/                # 设置组件
├── lib/
│   ├── ai/                      # AI 供应商 & Prompt
│   ├── pipeline/                # 生成流水线
│   ├── db/                      # 数据库 Schema
│   └── video/                   # FFmpeg 处理
└── stores/                      # Zustand 状态管理
```

## 数据模型

- **Project** — 项目（剧本、状态）
- **Character** — 角色（名称、描述、参考图）
- **Shot** — 镜头（序号、提示词、时长、首尾帧、视频）
- **Dialogue** — 对白（角色、文本、音频）
- **Task** — 后台任务队列

## 界面截图

| 项目列表 | 分集管理 |
|:---:|:---:|
| ![项目列表](images/demo/list.png) | ![分集管理](images/demo/分集管理.png) |

| 剧本导入 | 导入 — 角色解析 | 导入 — 自动分集 |
|:---:|:---:|:---:|
| ![剧本导入](images/demo/剧本上传.png) | ![角色解析](images/demo/剧本上传-角色解析.png) | ![自动分集](images/demo/剧本上传-自动分集.png) |

| 角色管理 | 剧本生成 |
|:---:|:---:|
| ![角色管理](images/demo/角色管理.png) | ![剧本生成](images/demo/剧本生成.png) |

| 角色解析 | 分镜 | 分镜看板 |
|:---:|:---:|:---:|
| ![角色解析](images/demo/角色解析.png) | ![分镜](images/demo/分镜.png) | ![分镜看板](images/demo/分镜看板.png) |

| 看板 | 看板详情 |
|:---:|:---:|
| ![看板](images/demo/看板.png) | ![看板详情](images/demo/看板详情.png) |

| 预览 | 模型配置 |
|:---:|:---:|
| ![预览](images/demo/预览.png) | ![模型配置](images/demo/模型配置.png) |

| 提示词管理 | 提示词修改 |
|:---:|:---:|
| ![提示词管理](images/demo/提示词管理.png) | ![提示词修改](images/demo/提示词修改.png) |

| 提示词快捷入口 | 分镜 AI 优化 |
|:---:|:---:|
| ![提示词快捷入口](images/demo/提示词快捷入口.png) | ![分镜AI优化](images/demo/分镜AI优化.png) |

## Demo

https://www.bilibili.com/video/BV19rwVzUEeD/

https://www.bilibili.com/video/BV1RrwVzUE3x/

https://www.bilibili.com/video/BV15rwVzSEKZ/

https://www.bilibili.com/video/BV15kwiz7E6Q/

https://www.bilibili.com/video/BV1hTw1zAEgY/

最新版生成

[《拳魂·最后一回合》-seedance1.5](https://www.bilibili.com/video/BV1WGAPzrEs1/)

[《拳魂·最后一回合》-seedance2](https://www.bilibili.com/video/BV1fVAuzLEAX/)

[基于 Seedance 2.0 生成](https://www.bilibili.com/video/BV1g5SDBSECs/)


## License

[Apache License 2.0](./LICENSE)
