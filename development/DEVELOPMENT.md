# Development

运行步骤、环境变量、迁移和备份以根 [README](../README.md) 为准，06 验收状态见 [集成交接](06-integration-handoff.md)。

- `packages/contracts`：工作流、评论、讲稿和 AI 契约。
- `packages/domain`：版本/受控编辑等领域规则。
- `packages/db`：本地 schema v2、原子事务和跨进程锁；预留 PostgreSQL schema。
- `packages/pptx`：真实 Open XML 解析、受控写入和 fixture。
- `packages/ai`：Schema、逐页分析/缓存策略、角色路由与局部改写。
- `apps/worker`：持久队列、生成租约、回复与分析 Worker。
- `apps/web/src/server/integrated-service.ts`：应用装配和增量任务调度。
- `apps/web/src/server/worker-store.ts`：共享工作区事务到 Worker 端口的适配；当前快照直接来自同一数据源。
- `apps/web/src/server/worker-cli.ts`：集成后的独立 Worker / 数据迁移入口。

`pnpm dev` 默认内置 Worker。独立运行时设置 `EMBEDDED_WORKER=false`，使用 `pnpm dev:web` 和 `pnpm dev:worker`。统一质量门槛为 `pnpm check`。
