# 03 项目、上传与分析进度交接

日期：2026-09-15。范围：项目入口、上传页、目标输入、持久化进度及 API。

## 已实现

- /projects 显示最近处理状态、版本号与更新时间；未完成项目回到上传阶段。
- /projects/new 保留表单草稿和请求幂等键，支持全部既有场景与“其他”说明。
- /projects/:projectId/upload 支持文件选择、拖放、键盘提交、实际传输百分比、服务器校验状态、失败提示、分析取消和重试。
- 上传成功原子保存项目关联、不可变源文件引用、初始版本及唯一待启动 Job；点击“开始 AI 分析”后才启动模型，避免上传即发送材料。
- 校验 PPTX 扩展名、MIME、1 字节至 50 MiB、真实 PPTX 解析和 1–60 页。原始对象以 wx 写入，源文件及版本文件引用不能覆盖。
- 可选目标自动保存，AI 建议、用户确认和修改时间分别记录；目标修订号防止旧页面静默覆盖。分析开始使用最新输入。
- 每阶段写入持久化快照，页面轮询恢复状态；取消使旧执行失效，同一失败 Job 可以幂等重试。
- 分析完成后自动跳转 /projects/:projectId/review；已完成项目重新打开上传页可查看、确认或修改建议。
- 沿用现有共享工作台外壳，不复制导航或改写评审页面。

## 文件与提交

本次直接修改：

- apps/web/src/client/app.tsx：项目入口、摘要与上传组件装配。
- apps/web/src/client/upload.tsx：上传和目标 UI、请求幂等、草稿恢复。
- apps/web/src/server/http.ts：目标、上传会话、取消和重试接口。
- apps/web/src/server/service.ts：上传与任务编排。
- packages/db/src/local-store.ts、index.ts、upload-state.ts：兼容持久化扩展和不可变引用约束。
- apps/web/src/server/upload.test.ts：11 项服务/HTTP/持久化测试。
- apps/web/src/server/upload-browser.e2e.test.ts：真实 Edge 页面流程。
- development/03-project-upload-handoff.md：本说明。

未创建 commit：开始开发时多个上述文件已有未提交实现，部分整个目录尚未跟踪；未将他人工作一起暂存或提交。根配置和共享 contracts 未改动。本地 upload-state 是数据库实现扩展，后续可由 02 契约 owner 统一上移。

## 路由与 API

页面：/projects、/projects/new、/projects/:projectId/upload。
成功跳转：/projects/:projectId/review。

所有写请求通过现有本机应用的同源检查；当前仍是单用户本地开发模式。

| 接口                                         | 请求                                                                | 返回                               |
| -------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| GET /api/projects                            | 无                                                                  | 保持原有项目数组                   |
| GET /api/project-summaries                   | 无                                                                  | 项目、uploadState、versionNumber   |
| POST /api/projects                           | name、scenario、audience、durationMinutes、可选 customScenario      | 项目                               |
| GET /api/projects/:id                        | 无                                                                  | 原 WorkspaceSnapshot + uploadState |
| POST /api/projects/:id/upload-session        | 空 JSON，Idempotency-Key                                            | 上传中状态                         |
| POST /api/projects/:id/upload?name=deck.pptx | PPTX 二进制；PPTX MIME 或 application/octet-stream；Idempotency-Key | sourceFile、version、唯一 job      |
| PUT /api/projects/:id/targets                | goal、response、revision、可选 acceptSuggestions                    | 已保存的 uploadState               |
| POST /api/projects/:id/analyze               | goal、response 均可空或省略；Idempotency-Key                        | job、queueJobId；202               |
| POST /api/projects/:id/cancel                | 空 JSON                                                             | cancelled 状态                     |
| POST /api/projects/:id/retry                 | jobId；Idempotency-Key                                              | 同一 job；202                      |

目标示例：

```json
{ "goal": "说明研究价值", "response": "", "revision": 0 }
```

接受当前建议示例（revision 使用最新快照值）：

```json
{
  "goal": "说明研究价值",
  "response": "认可研究结论",
  "revision": 2,
  "acceptSuggestions": true
}
```

相同幂等键和相同内容返回原结果；相同键换内容返回 409。上传产生的 Job 初始为 upload_completed，但 uploadState.analysisRequested=false；后台不会自动发送给模型。

## 状态与错误

上传状态：
waiting_upload → uploading → parsing → ready → queued → parsing → [rendering] → analyzing → generating_review → completed。
可进入 failed；用户取消进入 cancelled，重试回到 queued。

取消通过本地 uploadState 表达，兼容现有 AnalysisJob.stage：底层 job 标记 failed，attempt 递增。后台仅在 attempt 仍匹配时发布结果。取消不会撤销已经发出的模型请求，但其返回结果会被丢弃。

| 错误码                                   | 含义/恢复                            |
| ---------------------------------------- | ------------------------------------ |
| unsupported_file_type / unsupported_mime | 重新选择支持的 PPTX                  |
| file_size_exceeded                       | 选择 1 字节至 50 MiB 文件            |
| invalid_pptx                             | 损坏、加密或无效文件，修复后重新上传 |
| page_limit_exceeded                      | 拆分为最多 60 页                     |
| source_immutable                         | 新建项目上传其他源文件               |
| upload_interrupted                       | 重新选择同一文件，幂等恢复           |
| model_not_configured                     | 配置模型后重试同一 Job               |
| analysis_failed                          | 暂时性分析/渲染错误，可重试          |
| target_conflict                          | 刷新检查其他页面的编辑               |
| analysis_busy                            | 等待或取消当前任务                   |
| version_conflict                         | 基于当前版本重新分析                 |
| not_retryable / not_cancellable          | 当前任务状态不允许操作               |

每个持久化失败包含 code、message、retryable、recovery。上传传输百分比是当前浏览器 XHR 实际字节进度；刷新后不能续传部分字节，会提示重选同一文件，不假装已上传。

## 数据迁移和回滚

仍使用 DATA_DIR/workspace.json 与 DATA_DIR/objects。只新增根字段 uploadStates，不需要 SQL 迁移；旧文件缺少该字段时自动补空，并从项目、Job 和 DeckContext 懒恢复。目标保存前可没有 PPTX 或 DeckContext。

同进程同目录的多个 LocalWorkspaceStore 实例共享事务串行锁；快照先写临时文件再原子替换。后台同目录防止重复并发领取。该适配器不支持多个操作系统进程同时写同一 DATA_DIR。

上线前停止写入并备份整个 DATA_DIR。回滚时同样先停止后台处理，再恢复本次升级前的数据目录与应用代码。不要仅把旧代码指向新增的待启动 Job：旧版本没有 analysisRequested 门控，可能自动启动它们。无需删除源文件或修改历史版本。

## 验证

Node 24.18.1、已有 pnpm 及工作区依赖。浏览器测试使用系统 Microsoft Edge 的 headless 模式；PPTX 样本由现有 makeFixture 真实生成。测试中的 AI/渲染服务使用确定性替身，不调用真实模型。

- pnpm typecheck：全部工作区通过。
- pnpm lint：通过。
- pnpm test：60 项通过（含新增 11 项）。
- pnpm test:e2e：4 项通过（含新增浏览器测试）。
- 本次改动文件 Prettier 检查通过。

浏览器测试覆盖空状态、文件上传中、解析就绪、目标保存和刷新、慢分析、失败、同 Job 重试、完成跳转；使用 390×844 验证无横向溢出，并生成 1440×1000 桌面截图。
截图：artifacts/03-upload-mobile.png、artifacts/03-upload-desktop.png。

## 集成边界与剩余风险

- 默认沿用现有文本分析。完整 PPT 页面渲染与视觉理解仍需要 01/02/06 集成；未把默认流程伪装成已完成渲染。WorkspaceService 第三个构造参数可注入既有 SlideRenderer 端口；接入时逐页保存图片与真实渲染进度。渲染测试验证的是端口编排，不是 PowerPoint 保真度。
- 长任务在现有 Web 进程的后台定时器执行，不占用 HTTP 请求生命周期；生产多实例需外部数据库/队列和租约。
- 未用真实模型验证分析质量或延迟，缺少配置时返回可恢复失败。
- 当前开发版没有多用户认证和租户隔离；此次没有改变既有部署边界。
- 未进行 git 提交或发布。
