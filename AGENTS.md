# AGENTS.md

## 架构原则

- Web/API 与 Worker 必须是独立进程；禁止在请求处理中执行完整 FFmpeg 渲染。
- SQLite 是单机版的业务状态和任务状态真相；任务领取、进度、重试和错误日志均持久化。
- OpenAI 密钥只能由服务端 Worker 读取，不得使用 `NEXT_PUBLIC_` 前缀。
- 所有 API、任务 payload、模型输出和 JSON 数据库字段必须使用 Zod 校验。
- 默认使用 SVG 模板模式。模型只能选择受信任的素材 ID 和参数，不能生成并执行任意 SVG、HTML 或代码。
- 媒体文件存放在 `storage/media`，数据库只保存元数据与受控相对对象键。
- 本地路径必须经过白名单和根目录边界校验，禁止绝对路径与路径穿越。
- 所有生成物均绑定 project revision；过期任务不得覆盖新版本。

## 目录说明

- `apps/web`：Next.js UI 与服务器接口。
- `apps/worker`：SQLite 任务消费者、OpenAI 与 FFmpeg 调用。
- `packages/db`：Prisma schema、本地迁移和客户端。
- `packages/shared`：共享 Zod schema、类型、常量和无副作用工具。
- `packages/queue`：本地任务 payload 与生产者接口。
- `packages/storage`：本地媒体文件存取与路径安全。
- `packages/scene-engine`：受控 SVG 素材与场景合成。
- `packages/media`：字幕、时间线和 FFmpeg 命令构建。
- `tests/integration`：跨包生成流程测试。
- `storage`：本地 SQLite 和媒体生成物，不纳入版本控制。

## 编码规范

- TypeScript strict 模式，不使用无说明的 `any`。
- 服务端文件使用 `server-only` 或放在明确的 server/worker 目录。
- 函数优先小而纯；I/O 通过接口注入以便测试。
- 错误使用稳定错误码和清理后的用户消息，禁止泄露密钥或完整供应商响应。
- 对用户输入生成的文件名、路径、FFmpeg 参数使用白名单，不拼接 shell 字符串。
- 单机 Worker 默认顺序执行，任务领取必须有条件更新，失败不得无限重试。

## 常用命令

```powershell
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

## 测试要求

- 核心 schema、任务状态转换、SVG 场景组合、字幕、FFmpeg 参数和本地路径安全必须有单元测试。
- 完整生成流程至少有一个集成测试，外部 OpenAI 与 FFmpeg 可使用受控替身；媒体存储使用临时目录。
- 修复缺陷时先补回归测试；不得通过跳过测试来完成任务。