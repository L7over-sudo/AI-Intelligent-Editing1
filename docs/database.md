# SQLite 数据结构

数据库默认位于 `storage/stickmotion.db`，由 Prisma Client 查询，由 `packages/db/src/migrate.ts` 幂等应用 SQL 迁移。

| 模型 | 用途 | 关键约束 |
| --- | --- | --- |
| `User` | 本地账户 | email 唯一 |
| `Project` | 项目设置与版本 | owner、status、revision 索引 |
| `Scene` | 分镜内容 | `(projectId, order)` 唯一 |
| `Asset` | 本地媒体元数据 | `(bucket, objectKey)` 唯一，bucket 固定为 local |
| `VoiceTrack` | 单镜 AI 配音 | 关联场景和音频素材 |
| `SubtitleCue` | 字幕时间轴 | `(sceneId, order)` 唯一，关键词为 JSON |
| `SoundPlacement` | 音效位置 | offset 和 gain 持久化 |
| `GenerationJob` | 持久任务队列 | idempotencyKey 唯一，status/queuedAt 索引 |
| `JobEvent` | 任务事件日志 | 按 jobId/createdAt 查询 |
| `RenderOutput` | 最终视频记录 | 绑定 project revision 与本地视频 Asset |

SQLite 使用 WAL 模式以便 Web 读取与 Worker 写入并行。任务和业务状态都在同一数据库中，不依赖 Redis。

## 本地迁移

迁移文件按目录名排序，每次执行 `pnpm db:migrate` 时，未记录在 `_LocalMigration` 表中的迁移会在事务内执行。失败的迁移不会写入版本记录。