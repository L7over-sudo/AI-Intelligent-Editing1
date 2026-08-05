# 目录结构

```text
apps/
  web/                 Next.js 页面和 API
  worker/              SQLite 轮询 Worker、OpenAI、FFmpeg
packages/
  db/                  Prisma schema、生成客户端、本地迁移器
  shared/              Zod schema 与共享类型
  queue/               本地任务生产者和 LocalJob 接口
  storage/             本地文件存储和路径安全
  scene-engine/        SVG 素材与合成
  media/               字幕、时间线和 FFmpeg 命令
storage/
  stickmotion.db       SQLite 数据库
  media/               音频、字幕、图片和视频
tests/integration/     完整生成流程测试
docs/                  架构与状态机文档
```

`apps/*` 可以依赖 `packages/*`；共享包不得依赖应用。`storage/` 是运行时数据目录，不存放源码。