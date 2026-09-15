# Deck Rehearsal 多对话开发计划

需求基线：`Deck-Rehearsal-SPEC-v0.1.md`。最新页面与交互基线：`design/concepts/review-workbench-v5-comment-thread.png` 和任务 01—06 中注明的最新产品决定；两者冲突时以后者为准。

## 执行顺序

```text
阶段 A：00 仓库骨架与共享契约（已完成）
  ↓
阶段 B1：01、02、03 从 00 基线并行；02 先提交共享契约检查点
  ↓
阶段 B2：04、05 基于 02 的契约检查点并行
  ↓
阶段 C：06 在 01—05 合并后做集成与 E2E
```

| 对话 | 任务                                                                 | 主要所有权                        |
| ---- | -------------------------------------------------------------------- | --------------------------------- |
| 0    | [00-bootstrap-contracts.md](tasks/00-bootstrap-contracts.md)         | 根配置、共享契约、领域/数据库骨架 |
| 1    | [01-pptx-engine.md](tasks/01-pptx-engine.md)                         | PPTX 引擎、渲染与画布数据         |
| 2    | [02-ai-analysis-review.md](tasks/02-ai-analysis-review.md)           | AI、Worker、评论串与编辑共享契约  |
| 3    | [03-project-upload-progress.md](tasks/03-project-upload-progress.md) | 项目、上传、背景、分析进度 UI/API |
| 4    | [04-review-workbench.md](tasks/04-review-workbench.md)               | 工作台外壳、评论流与评论详情      |
| 5    | [05-rewrite-version-script.md](tasks/05-rewrite-version-script.md)   | PPT 改写、讲稿编辑、版本与导出    |
| 6    | [06-integration-e2e.md](tasks/06-integration-e2e.md)                 | 集成装配、E2E、CI、Demo 验收      |

## 分支建议

- `codex/01-pptx-engine`
- `codex/02-ai-review`
- `codex/03-project-flow`
- `codex/04-review-workbench`
- `codex/05-rewrite-version-script`
- `codex/06-integration`

## 协作规则

1. 00 已完成；01、02、03 从它的同一 commit 开始。04、05 等待 02 的共享契约检查点合入后开始。
2. 每个对话只修改任务中声明的目录，不回滚或重写其他对话的改动。
3. 共享对象、schema、事件和接口统一放在 `packages/contracts`；不要复制私有版本。
4. 02 是本轮共享契约的唯一 owner；04、05 消费契约。根依赖、workspace、lint/test 配置的必要改动记录并交由 06 处理。
5. 生产代码通过端口使用模型、PPTX、存储和队列，不直接跨模块调用具体 SDK。
6. 测试优先通过项目工作流服务/API 这一最高 seam 验证外部行为；真实 PPTX 另做契约测试。
7. 每个对话最终列出 commit、改动范围、测试命令与结果、环境变量和未完成项。

## 阶段 B 合并顺序

先合入 02 的契约检查点，再合入 01、02、03 的实现，然后合入 04、05。每次合并后运行共享检查；只有同阶段且目录所有权不重叠的任务并行。

## 产品完成路径

上传 ≤60 页 PPTX → 可选目标由 AI 建议 → 分析与角色路由 → 右侧 50—100 字评论流 → 定位页面或进入评论详情 → 用户回复、AI 评审人继续回复 → 局部选择 PPT 或讲稿文字 → AI 结合本页和上下页生成 Diff → 接受或不接受 → 讲稿格式与标注 → 派生版本和布局复查 → 在版本页导出 PPTX。
