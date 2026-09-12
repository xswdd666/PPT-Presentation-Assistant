# 对话 0：仓库骨架与共享契约

## 复制给新对话

你负责 Deck Rehearsal 阶段 A。完整阅读 `Deck-Rehearsal-SPEC-v0.1.md` 与 `development/README.md`。这是共享仓库，你不是唯一开发者，不要回滚他人改动。你拥有根工程配置、`apps/web`/`apps/worker` 最小骨架、`packages/contracts`、`packages/domain` 基础骨架和 `packages/db` 基础骨架。建立可运行、可测试、可供后续并行开发的 TypeScript monorepo，不实现具体 PPTX、AI 或复杂页面。完成后运行检查并提交独立 commit，报告契约入口、命令结果和后续约束。

## 交付

- pnpm workspace：`apps/web`、`apps/worker`、`packages/contracts`、`packages/domain`、`packages/db`、`packages/pptx`、`packages/ai`。
- TypeScript strict、lint、format、unit、E2E 基础命令和开发 README。
- 领域契约：Project、SourceFile、DeckVersion、Slide、SlideElement、DeckContext、Reviewer、ReviewIssue、IssueCluster、ReviewComment、RewriteProposal、ChangeSet、Script。
- 状态：分析阶段、问题/版本/改写状态、目标来源、场景、角色。
- 端口：PptxProcessor、SlideRenderer、LayoutInspector、ModelGateway、ObjectStorage、JobQueue、Clock、IdGenerator。
- 项目工作流接口：创建、上传完成、分析、评论、改写、接受/拒绝、提交版本、讲稿、下载。
- PostgreSQL schema/repository 骨架、环境变量校验、`.env.example`；ORM 选择写 ADR。
- 使用内存适配器的工作流冒烟测试。

## 不做

真实 PPTX、真实模型、完整业务页面；不绑定未确认的模型/存储/PPTX 厂商。

## 验收

Web 与 Worker 可启动，typecheck/lint/test 通过；其他对话无需修改根配置即可开发。先完成并提交本任务，再启动阶段 B。
