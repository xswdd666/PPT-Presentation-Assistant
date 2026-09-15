# 04 评审工作台交接

## 交付范围

已确认共享契约检查点 `d2d110f` 与 Worker 实现 `11cf03f` 位于当前 Git 历史。按 v5 设计稿及 04 最新决定实现；保留已有上传、PPT 改写、讲稿与版本功能。

- `apps/web/src/features/workspace-shell/navigation.tsx`：上传 / 评审 / 讲稿 / 版本，当前路由 `aria-current`。
- `apps/web/src/features/workspace-shell/splitter.tsx`：指针捕获、方向键、Home/End、Enter/双击重置、本地存储与损坏值钳制。
- `apps/web/src/features/review-workbench/slots.tsx`：60 页窗口化缩略图、自动定位、键盘跨窗口焦点恢复，以及编辑器插槽类型。
- `apps/web/src/features/review-thread/comments.tsx`：连续评论、同面板详情、阅读位置与焦点恢复、乐观回复、轮询、生成失败重试和版本冲突。
- `apps/web/src/features/review-thread/gateway.ts`：现有本地 HTTP 到 `ReviewGateway` 的适配；403/404/409 错误保留状态码。
- `apps/web/src/client/app.tsx`：上述组件装配与窄屏抽屉、键盘焦点约束；已有 03/05 业务继续使用原实现。
- `apps/web/src/client/styles.css`：共用设计令牌、三栏、线程线、焦点态与响应式样式。
- `apps/web/src/server/review-workbench.e2e.test.ts`：浏览器级组件与契约 Mock 验收。

没有新建 commit。仓库开始时存在大量他人的未提交改动，客户端整个目录也尚未纳入 Git；本次没有将这些内容混入一个提交，也没有回滚现有工作。

## 布局与设计令牌

桌面缩略图轨道 176px（中等屏幕 168px），右侧默认 360px、可调整 340–370px；中央初始约 62% 画布 / 38% 讲稿。分栏值保存于 `review-width` 与 `slide-height`，不可信存储值会钳制。低高度窗口中央区域可以滚动，避免讲稿无法到达。

共享 CSS 令牌集中在 `styles.css` 的 `Shared workspace design tokens` 段：`--ink`、`--muted`、`--line`、`--accent`、`--panel`、`--surface-*`、`--space-*`、`--radius-*`、`--font-*`、`--shadow-canvas`、`--focus-ring`、`--rail-width`。页面和已有编辑器共享同一份样式，不添加全局品牌导航、评论筛选、待处理或社交指标。

800px 以下缩略图与评论成为覆盖式抽屉。打开时中央内容 inert，键盘焦点在面板中循环，Escape 关闭后回到触发按钮。按钮与输入控件至少 44px，分隔条支持键盘和 ARIA 值。减少动态效果时关闭定位动画。

## URL 与状态

- `/projects/:projectId/review?slide=:stableSlideId`
- `/projects/:projectId/review?slide=:stableSlideId&comment=:commentId`
- 仅有 `comment` 参数时，初始页由评论关联的稳定 Slide ID 恢复。返回列表时将该页写入 URL。
- 从已有页面进入详情时保留 `slide`；详情开关不重建中央编辑区、不重置缩放和分栏。
- 列表滚动位置及原评论焦点在同一工作台实例中恢复；回复草稿用 sessionStorage 按项目/评论隔离。
- 新回复只在接近底部时自动滚动；主动向上阅读时不强行拉回底部。
- 上传、讲稿、版本导航分别使用 `/upload`、`/script`、`/versions`，导出沿用版本页。

## 05 插槽接入

`Workspace` 支持 `slots?: WorkbenchSlots`。两种 slot 的公共 props 为 `projectId`、当前 `slide`、`zoom`、本页 `document`、`onSelection`。

```tsx
<Workspace
  projectId={projectId}
  url={url}
  onError={onError}
  slots={{
    slideTextSelectionLayer: (props) => <SlideTextSelectionLayer {...props} />,
    presenterScriptEditor: (props) => <PresenterScriptEditor {...props} />,
  }}
/>
```

PPT 选择层挂在现有 `.slide-canvas` 内，使用该相对定位容器的页面坐标，随画布整体缩放。讲稿 slot 替换中央下部的完整讲稿组件，组件自行负责保存与富文本逻辑。未提供 slot 时，继续使用现有编辑组件。

`WorkflowNavigation` 可由其他项目路由复用。`Workspace` 当前仍从客户端入口导出，集成方应在现有入口中装配，避免将带 createRoot 副作用的入口作为独立组件库导入。

## 回复接口

`Comments.gateway` 与 `Workspace.reviews` 支持现有 `ReviewGateway` 或 `AsyncReviewGateway`，均直接消费 contracts。

默认本地 HTTP 仍为 `GET/POST /api/projects/:id/thread/:commentId`，采用原有同步服务。发起时立即显示用户回复与生成提示；失败保留草稿和同一幂等键，允许重试；409 要求刷新当前版本。

注入异步端口后，提交使用 `submitReply`，保存 generation ID，轮询 `getReplyResult`，失败使用 `retryReply(projectId, generationId)` 重试原任务，避免重复写用户消息；刷新后恢复该会话保存的生成任务 ID。未修改 02 的共享契约或 Worker。

**集成边界**：现有 HTTP 服务尚未暴露 Worker 的异步任务路由。因此默认本地模式的 queued/generating 为请求过程提示，持久异步任务状态需 06 将已有 Worker 端口通过 HTTP 适配后注入。前端已通过异步契约组件测试，不代表默认 HTTP 已完成 Worker 集成。

## 验证与截图

运行命令：

```text
pnpm --filter @deck-rehearsal/web typecheck
pnpm exec eslint apps/web/src/features apps/web/src/client/app.tsx apps/web/src/server/review-workbench.e2e.test.ts
pnpm exec vitest run --config vitest.e2e.config.ts apps/web/src/server/review-workbench.e2e.test.ts apps/web/src/server/upload-browser.e2e.test.ts
```

浏览器覆盖：第 6 页评论定位、打开详情、回复、queued/generating/completed、返回列表位置和焦点、评论深链刷新、409 草稿保留、500 重试、403/404、列表空态与错误恢复、分隔条键盘调整、60 页窗口化和跨窗口键盘定位、四阶段导航、390px 无横向溢出。另在浏览器挂载 Comments 并注入 AsyncReviewGateway，验证 failed → retryReply → completed 且用户回复只有一条。

截图：

- `artifacts/review04/desktop-1440.png`：1440 × 1024。
- `artifacts/review04/narrow-390.png`：390 × 844。

截图使用测试 fixture，无生产组件硬编码评论。截图已人工查看，不是自动像素差异基线。浏览器为本机 Edge headless；未声明完成真实读屏软件或全站 WCAG 审计。PPT 画面继续使用现有文字结构预览，真实复杂图形渲染由 01/06 集成。
