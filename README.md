# StickMotion 单机本地版

StickMotion 是一个运行在本机的火柴人短视频生成网站。输入主题或完整文案后，系统通过独立 Worker 异步生成脚本、分镜、SVG 画面、AI 配音、字幕和 1080P MP4。

## 本地架构

- Next.js 16、React 19、TypeScript 6、Tailwind CSS 4
- Prisma 7 + SQLite 单文件数据库
- SQLite 持久任务表 + 独立轮询 Worker
- D 盘本地文件存储
- Remotion、FFmpeg 8、Sharp
- OpenAI Responses、Image、Text-to-Speech、Speech-to-Text API

不需要 Docker、PostgreSQL、Redis、BullMQ、MinIO 或 S3。

## 运行要求

- Node.js 22+
- pnpm 11+
- FFmpeg
- OpenAI API 密钥（脚本、AI 生图、配音和转录需要）

## 安装和启动

```powershell
Copy-Item .env.example .env
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

打开 <http://localhost:3000>。`pnpm dev` 会同时启动 Web 与独立 Worker，完整 Remotion/FFmpeg 渲染不会在网页请求进程中执行。

最终视频默认由 Remotion 生成动态图片、逐句字幕、旁白、音效、背景音乐和分镜转场。如果 Remotion 在本机浏览器或编码阶段失败，Worker 会自动回退到原有 FFmpeg 渲染器；可在 `.env` 中用 `RENDER_ENGINE` 和 `REMOTION_FALLBACK_TO_FFMPEG` 调整。

## 本地数据位置

默认都位于项目所在的 D 盘目录：

- SQLite：`storage/stickmotion.db`
- SQLite WAL：`storage/stickmotion.db-wal`、`storage/stickmotion.db-shm`
- 音频、字幕、图片和视频：`storage/media/`

`storage/` 已在 `.gitignore` 中忽略。备份时应先停止 Web/Worker，再整体复制 `storage/`。

可在 `.env` 中调整：

```dotenv
DATABASE_URL=file:./storage/stickmotion.db
LOCAL_STORAGE_DIR=storage/media
OPENAI_API_KEY=
```

API 密钥只由 Worker 在服务端读取，不会发送到浏览器。

## 数据库命令

```powershell
pnpm db:generate   # 根据 Prisma schema 生成客户端
pnpm db:migrate    # 幂等应用本地 SQLite SQL 迁移
pnpm db:deploy     # 与 db:migrate 相同，供脚本化启动使用
```

Prisma schema 位于 `packages/db/prisma/schema.prisma`，迁移位于 `packages/db/prisma/migrations/`。由于 Windows 下 Prisma Schema Engine 在中文目录创建 SQLite 文件存在兼容问题，迁移由项目内的 `better-sqlite3` 运行器执行，Prisma Client 仍负责全部业务查询。

## 任务机制

HTTP API 只在 SQLite 的 `GenerationJob` 表中创建任务。独立 Worker 每 600ms 领取一个 `QUEUED` 或到期的 `RETRYING` 任务，并写回进度、事件、错误和重试时间。异常退出后，遗留的 `RUNNING` 任务会在 Worker 重启时重新排队。

单机模式按顺序处理任务，渲染不会阻塞网页。缺少 OpenAI 密钥时相关任务最多尝试三次，然后进入 `FAILED`，不会无限重试。

## 媒体文件

- Worker 只接受经过白名单校验的相对对象键，禁止绝对路径和 `..` 路径穿越。
- 背景音乐通过受控本地 API 上传，最大 50MB，并校验声明大小和 MIME 类型。
- 视频导出通过验证项目归属的本地下载接口完成。
- 内置音效由 `scripts/generate-sfx.ps1` 合成并按 CC0-1.0 提供。
- 可在 `.env` 中用 `SFX_LIBRARY_ROOT` 指向用户本地音效库，再运行
  `pnpm --filter @stickmotion/worker sfx:index` 建立受控相对路径索引。
- 外部音效不会整库复制；系统只把实际匹配到的音效复制到
  `storage/media/library/sfx/external`。外部素材会标记为用户提供，使用者需确认授权范围。
- 可在 `.env` 中用 `SUBTITLE_TEMPLATE_LIBRARY_ROOT` 指向剪映字幕预设目录，再运行
  `pnpm --filter @stickmotion/worker subtitles:index` 建立字幕模板索引。
- 字幕模板页面会读取本地预览图，并提取字体、字号、颜色、描边、阴影和位置用于
  Remotion/FFmpeg 渲染。原始预设不会被移动或删除；剪映专属联网动画资源不能保证在
  FFmpeg 中完全复刻。

## 页面

- `/login`：本地演示账户
- `/projects`：项目列表
- `/projects/new`：创建项目并异步生成分镜
- `/projects/:id/storyboard`：分镜编辑和单镜配音
- `/projects/:id/preview`：画面预览
- `/projects/:id/render`：渲染任务和进度
- `/projects/:id/export`：下载本地 MP4

## 测试和构建

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm --filter @stickmotion/worker test:remotion-smoke
pnpm build
```

集成测试会使用真实 FFmpeg 生成短 MP4，外部 OpenAI 调用使用受控替身或不参与该测试。Remotion 冒烟测试会在 `storage/media/remotion-smoke.mp4` 生成一个带动画、转场和逐句字幕的短视频。

## 本机声音克隆

声音克隆使用本机 IndexTTS2，安装、启动和页面使用方法见 [`docs/INDEXTTS.md`](docs/INDEXTTS.md)。
