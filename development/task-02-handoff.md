# 任务 02：AI / Worker 开发交接

日期：2026-09-14。

## 提交与范围

- 共享契约检查点：`d2d110f`。
- AI / Worker 实现：本文件所在的 `feat(ai): implement versioned analysis and review worker` 提交。
- 新增实现位于 `packages/ai/src/{runtime,gateway,schemas,pipeline,rewrites,reviewers}.ts` 和 `apps/worker/src/**`；契约在 `packages/contracts/src/ai.ts`。
- 保留原有 `packages/ai/src/index.ts`、Web 服务、PPTX 引擎及其他未提交改动。新实现通过 `@deck-rehearsal/ai/runtime` 导出，旧入口继续可用。
- 本次仅暂存 AI / Worker 所需的场景、页面尺寸与哈希类型，以及 lockfile 中的 AI / Worker 依赖；前端、PPTX 和原有其他改动保持未暂存。

## 已实现的行为

1. `AnalysisPipeline.run` 接收当前 `AnalysisSnapshot`；缺少目标与期望回应时补全 `ai_suggested`，保留 `user_input` / `user_confirmed` 值。Worker 保存补全后的上下文，后续回复和改写可读取。
2. 单页分析覆盖结构、叙事、证据、视觉表达和场景适配维度。页缓存键包括项目、模型命名空间、Prompt/Schema 版本、稳定 Slide ID、文字、备注、布局和视觉摘要，不包含页码与 PPT 版本号。排序后重算全局叙事并复用单页结果。
3. 五种任务场景分别路由 3–4 个角色：工作复盘 `work_report`，晋升述职 `performance_review`，项目提案 `proposal_presentation`（兼容 `resource_request`），方案评审 `solution_review`，产品发布 `product_launch`。保留旧场景兼容路由。
4. 主评论按规范化后的 grapheme cluster 校验 50–100 字，回复为 30–180 字。模型页面与角色引用错误也会拒绝。按“同页、同根因、同建议”聚合，保留不同建议；时间线按 `createdAt` 和 `id` 升序返回，无处理状态或筛选计数。
5. `submitReply` 原子保存用户回复与 queued 任务，立即返回；`runNext` 生成原角色的同线程回复。读取完整历史及当前版本相关页，输出页码与版本依据。重复幂等键不重复追加，同键不同内容冲突，同线程未完成时拒绝另一轮并发提交。
6. 模型调用在存储事务外运行；完成时再次检查版本、上下文与任务租约。超时、限流、模型不可用及非法输出最多调用三次，默认退避 500ms / 1000ms，单次超时 90 秒；认证/配置错误不自动重试。异常不包含密钥或原始 PPT 内容。
7. 回复/分析可轮询、显式重试；失败重试不重复插入用户消息。生成租约 6 分钟，页面进度会续租，过期任务可重新领取，旧领取者不能发布重复结果。
8. `LocalRewriteService.suggest` 支持 PPT / 讲稿选区，读取本页与上下页背景，验证选区、PPT 版本和讲稿 revision；结果包含原文、建议、Diff、理由、依据、事实风险。生成过程零编辑写入。数值改变会将 `factsPreserved` 设为 false；格式/批注保留在原始 ScriptDocument 中。
9. `FileWorkerStore` 持久化队列、上下文、评论、分析和页面缓存；原子重命名发布，目录锁串行化写入。`MemoryWorkerStore` 为确定性测试适配器。

## 04 / 05 / 06 接入

共享载荷示例见 [task-02-contracts.md](task-02-contracts.md)。新增 `AsyncAnalysisGateway` / `AnalysisGeneration` 描述分析提交、状态查询与重试。

```ts
import { createLocalWorker } from "@deck-rehearsal/worker";
import {
  LocalRewriteService,
  createModelGatewayFromEnv,
} from "@deck-rehearsal/ai/runtime";

// Web 与独立 Worker 必须使用同一个绝对状态文件路径。
const worker = createLocalWorker("/absolute/path/to/ai-worker.json");
// 上传解析完成、提交版本、修改目标或讲稿后，同步最新快照。
await worker.putSnapshot({ context, slides, documents });
const analysis = await worker.submitAnalysis(
  context.projectId,
  context.deckVersionId,
  requestKey,
);
const analysisResult = await worker.getAnalysisResult(
  context.projectId,
  analysis.id,
);

const reply = await worker.submitReply({
  projectId,
  commentId,
  body,
  deckVersionId,
  idempotencyKey,
});
// 立即显示用户消息，再轮询；不要等待同步模型回复。
const replyResult = await worker.getReplyResult(projectId, reply.id);
const proposal = await new LocalRewriteService(
  worker,
  createModelGatewayFromEnv(),
).suggest(request);
```

- 04 使用 `listComments` / `getThread` / `submitReply` / `getReplyResult` / `retryReply`。`version_conflict` 显示刷新/基于当前版本重新生成；它不能自动改成成功。不同轮次使用新幂等键，同一轮故障使用原 generation ID 重试。
- 05 接受建议仍由其上层编辑命令执行，必须再次校验 `basisVersionId`、选区原文和 `scriptRevision`。拒绝或关闭建议不写入 PPT、版本或讲稿。格式/批注范围的接受后重映射仍由编辑层负责。
- 06 将已有 `apps/web/src/server/service.ts` 的旧同步模型流程接到新端口，并在每次背景/版本/讲稿保存时同步快照。Web 认证与项目访问控制在该适配层执行。当前任务没有改写该服务，因此现有网页仍使用原有实现。
- 当前任务列表没有可明确识别为 04 / 05 的开发任务，未向不确定的任务发送消息。共享检查点与本交接文件可直接交给两位开发者。

## 启动与环境变量

```text
pnpm dev:worker
pnpm --filter @deck-rehearsal/worker start --once
```

生产入口 `createModelGatewayFromEnv` 仅读取 `MODEL_API_KEY`、`MODEL_BASE_URL`、`MODEL_NAME`。`MODEL_BASE_URL` 为兼容 Chat Completions 的基础地址。通过 `AI_WORKER_STATE_PATH` 指定状态文件的绝对路径；pnpm Worker 脚本默认使用仓库 `.local-data/ai-worker.json`。密钥不入日志或缓存。

Prompt 版本：`review-2026-09-14.1`。Schema 版本：`ai-output-1.0.0`。`OUTPUT_JSON_SCHEMAS` 可 JSON 序列化；Zod 执行运行时结构、字符长度及引用验证。`AiFailure` 提供 code、retryable 与 recovery，不暴露 provider 原始错误。

## 验证结果

- `pnpm check`：通过（全 workspace typecheck、ESLint、Prettier、49 项测试、3 项服务 E2E）。
- 本轮新增测试：AI 25 项，Worker 12 项，共 37 项。
- 60 页测试：首次 60 页；修改一页后复用 59 页；反转页面顺序后复用全部 60 页；跨项目不复用。
- 包含持久化重启、缓存重启、失败分析重试、完整多轮线程、并发幂等、租约抢占、过期版本结果丢弃、Schema、数值风险、边界相邻页、日志脱敏测试。
- Worker CLI 冒烟：使用新建独立空队列且清空模型配置执行 `start --once`，退出码 0；未消费真实队列或发送 PPT。
- 3 项既有 E2E 验证旧 Web 服务回归；新 Worker 的接入行为由上述 Worker 测试覆盖，不代表新 Worker 已接入网页。

## 已知限制

- 未使用真实模型凭证进行在线质量、成本或 60 页耗时评测；事实/术语保持仍需要用户审阅。数值检查不能证明整段语义等价。
- 视觉分析只使用已提供的布局和 visualSummary，未实现图片多模态上传、渲染或图表事实识别。
- 同根因聚合依赖模型规范化 rootCause 与 suggestedAction；不同措辞的语义重复可能残留，避免过度合并不同建议。
- 本地 JSON 存储适合单机开发。进程在持有短事务目录锁时被强杀可能遗留 `.lock`；确认所有 Worker 停止后再清理该锁。多机事务、长期缓存清理和项目删除生命周期交由生产存储适配层。任务租约恢复不自动删除文件锁。
- 参考设计图的文件路径已确认；本机图片读取工具因沙箱初始化故障未能显示该图。本次没有 UI 或视觉实现。
