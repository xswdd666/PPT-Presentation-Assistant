# Deck Rehearsal 多对话开发计划

需求基线：`Deck-Rehearsal-SPEC-v0.1.md`。

## 执行顺序

```text
阶段 A：00 仓库骨架与共享契约（必须先完成并提交）
  ↓
阶段 B：01—05 从同一基线创建分支，可并行开发
  ↓
阶段 C：06 在阶段 B 合并后做集成与 E2E
```

| 对话 | 任务                                                                 | 主要所有权                        |
| ---- | -------------------------------------------------------------------- | --------------------------------- |
| 0    | [00-bootstrap-contracts.md](tasks/00-bootstrap-contracts.md)         | 根配置、共享契约、领域/数据库骨架 |
| 1    | [01-pptx-engine.md](tasks/01-pptx-engine.md)                         | `packages/pptx`、PPTX fixtures    |
| 2    | [02-ai-analysis-review.md](tasks/02-ai-analysis-review.md)           | `packages/ai`、分析 Worker jobs   |
| 3    | [03-project-upload-progress.md](tasks/03-project-upload-progress.md) | 项目、上传、背景、分析进度 UI/API |
| 4    | [04-review-workbench.md](tasks/04-review-workbench.md)               | 评审工作台、评论流、叙事视图      |
| 5    | [05-rewrite-version-script.md](tasks/05-rewrite-version-script.md)   | 局部改写、版本、排序/隐藏、讲稿   |
| 6    | [06-integration-e2e.md](tasks/06-integration-e2e.md)                 | 集成装配、E2E、CI、Demo 验收      |

## 分支建议

- `feat/00-foundation`
- `feat/01-pptx-engine`
- `feat/02-ai-review`
- `feat/03-project-flow`
- `feat/04-review-workbench`
- `feat/05-rewrite-version-script`
- `feat/06-integration`

## 协作规则

1. 不要让 00 与其他任务并行；01—05 必须从 00 合并后的同一 commit 开始。
2. 每个对话只修改任务中声明的目录，不回滚或重写其他对话的改动。
3. 共享对象、schema、事件和接口统一放在 `packages/contracts`；不要复制私有版本。
4. 阶段 B 不自行修改根依赖、workspace、lint/test 配置或数据库迁移；确需修改时记录并交由集成任务处理。
5. 生产代码通过端口使用模型、PPTX、存储和队列，不直接跨模块调用具体 SDK。
6. 测试优先通过项目工作流服务/API 这一最高 seam 验证外部行为；真实 PPTX 另做契约测试。
7. 每个对话最终列出 commit、改动范围、测试命令与结果、环境变量和未完成项。

## 阶段 B 合并顺序

推荐依次合并 01、02、03、04、05，每次合并后运行共享检查。开发仍可并行。

## 产品完成路径

上传 ≤60 页 PPTX → 可选目标由 AI 建议 → 分析与角色路由 → 右侧 50—100 字评论流 → 展开并定位 → 局部选中文字 → AI 结合本页和上下页改写 → 接受/不接受 → 提交新版本 → 布局复查 → 生成讲稿 → 下载 PPTX。
