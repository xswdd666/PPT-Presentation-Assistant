# 05 文字改写、讲稿与版本交接

## 实现范围

以 05 的最新交互为准。已核对共享契约检查点 `d2d110f` 和 AI/Worker 提交 `11cf03f`，使用 04 的画布/讲稿插槽。没有创建 commit：开始时客户端、服务端等目录已经是他人的未跟踪工作，已有大量跨任务修改，未将它们混入本任务提交。

### 本次新增

- `apps/web/src/features/slide-rewrite/selection.tsx`：透明原生文字选择层、稳定元素 ID、UTF-16 范围、Enter 全选入口、失效选区回调、百分比坐标和字号映射。
- `apps/web/src/features/slide-rewrite/diff.ts`：中文分词/词级 Diff，长文本使用有界退化策略。
- `apps/web/src/features/slide-rewrite/shared.tsx`：编辑组件的 HTTP 与按钮适配。
- `apps/web/src/features/presenter-script/editor.tsx`：本页讲稿、格式、独立标注、串行保存、本机草稿恢复、冲突保护、联网重试。
- `apps/web/src/features/presenter-script/rich-text.tsx`：带样式的可编辑正文、UTF-16 选区保存、纯文本粘贴和中文组合输入处理。
- `apps/web/src/features/presenter-script/page.tsx`：集中讲稿、搜索、页索引、字数/时长、空稿补写入口。
- `apps/web/src/features/version-history/page.tsx`：版本选择、来源/时间线、文本/页序/显示状态比较、警告、恢复、指定版本导出及失败重试。
- `apps/web/src/features/slide-rewrite/rewrite.test.ts`、`apps/web/src/server/rewrite05.test.ts`、`apps/web/src/server/rewrite05.e2e.test.ts`。

### 现有文件的最小接入调整

- `apps/web/src/client/app.tsx`：把原讲稿/版本内容移到上述功能目录；保留外壳、导航、评论和插槽覆盖方式。切页、切路由和版本变化取消旧建议；建议面板非模态，拒绝不发写请求；服务端冲突有读取当前版本入口。
- `apps/web/src/client/styles.css`：选择层、150ms 动画、减少动态效果、富文本、建议面板及版本页内容样式。
- `apps/web/src/client/script-document.ts`：局部替换保留选区外的相交格式；整段覆盖选区的格式继续覆盖替换文本。相交标注明确失效，后方标注平移。
- `apps/web/src/server/service.ts`：生成在写事务外执行，返回前再核对版本/讲稿 revision；接受时仍执行领域命令/原文校验；按派生版本保留 ChangeOperation 记录；版本详情读取。
- `apps/web/src/server/http.ts`：传递可选 scriptRevision、允许空讲稿的 0..0 选区（服务校验仅空稿允许），增加版本详情 GET。

## 组件接口

```tsx
<SlideTextSelectionLayer
  slide={slide}
  onSelection={(selection: TextSelection) => openRewrite(selection)}
  onClear={() => clearSelection()}
/>
<PresenterScriptEditor
  projectId={projectId}
  slide={slide}
  document={document}
  onSelection={(selection: TextSelection) => openRewrite(selection)}
  onSaved={(saved: ScriptDocument) => updateSharedSnapshot(saved)}
  onError={showError}
/>
```

`SlideTextSelectionLayer` 挂在 04 的相对定位 `.slide-canvas` 内，尺寸由画布容器决定。可直接消费 slot 的 slide/onSelection；zoom 随父画布整体缩放，不再重复乘缩放倍数。`onClear` 可选。

`PresenterScriptEditor` 使用稳定 Slide ID，并在页面切换时按 Slide ID 重建。`onSaved` 可选，但工作台默认接入此事件以同步集中视图的数据。讲稿接受 AI 建议后刷新快照并重建编辑器；普通自动保存不重建正文。外部 slot 仍可替换默认组件。

### 富文本与标注载荷

```json
{
  "slideId": "stable-slide-id",
  "revision": 3,
  "text": "先讲结论，再说依据",
  "marks": [
    { "start": 0, "end": 4, "kind": "bold" },
    { "start": 7, "end": 9, "kind": "color", "value": "#426581" }
  ],
  "annotations": [
    {
      "id": "annotation-id",
      "start": 7,
      "end": 9,
      "text": "注明来源",
      "author": "我",
      "createdAt": "2026-09-15T04:00:00.000Z"
    }
  ],
  "updatedAt": "2026-09-15T04:00:00.000Z"
}
```

所有范围使用 UTF-16、右端不包含。讲稿正文和格式/标注分离存储；修改讲稿不产生 PPT 文件版本。恢复本机草稿遇到服务器 revision 冲突时保留草稿并提示核对，不自动覆盖服务器正文。

## 请求、版本与导出

- `POST /api/projects/:id/suggest`：`{target, selection, scriptRevision?}`。PPT 输入含当前页/上下页、项目背景、选区与当前版本；讲稿另外包含当前及相邻讲稿。空稿使用同一建议/接受流程，不自动写正文。
- `POST /api/projects/:id/accept`：`{suggestionId}`，使用 suggestion ID 作为幂等键。PPT 接受走领域 updateChanges/commitVersion，重新解析页面/内容哈希并检测警告；讲稿接受校验 revision 与原文。
- `GET /api/projects/:id/version/:versionId`：返回该版本、页面、警告与操作记录。版本和项目关系在服务端校验。
- `changeSets[versionId]` 保留提交时的操作快照；既有 `changeSets[projectId]` 仍供领域当前草稿使用。旧版本没有操作快照时回退到历史摘要，不伪造记录。
- 恢复历史仍创建新版本并复制真实历史文件，父版本指向恢复前的当前版本，摘要说明恢复来源。可通过此操作撤销已接受的 PPT 修改。
- 导出前显示选定版本自己的警告，读取该版本真实 PPTX，文件名包含版本号。HTTP/读取失败保留编辑状态和版本选择，并允许重试。

## 验证结果

```text
pnpm --filter @deck-rehearsal/web typecheck
pnpm exec eslint apps/web/src/features/slide-rewrite apps/web/src/features/presenter-script apps/web/src/features/version-history apps/web/src/client/app.tsx apps/web/src/client/script-document.ts apps/web/src/server/service.ts apps/web/src/server/http.ts apps/web/src/server/rewrite05.test.ts apps/web/src/server/rewrite05.e2e.test.ts
pnpm exec vitest run apps/web/src/client/script-document.test.ts apps/web/src/features/slide-rewrite/rewrite.test.ts apps/web/src/server/rewrite05.test.ts
pnpm exec vitest run --config vitest.e2e.config.ts apps/web/src/server/rewrite05.e2e.test.ts apps/web/src/server/review-workbench.e2e.test.ts apps/web/src/server/workflow.e2e.test.ts
```

类型检查、定向 ESLint 通过。核心测试 8/8 通过；集成/浏览器回归 5/5 通过。

覆盖：词级 Diff 可重建前后原文、缩放坐标、局部选区、上下页上下文、拒绝不写版本/文件、同幂等键并发接受只生成一个版本、生成期间版本变化不阻塞写操作且拒绝旧结果、讲稿 revision 冲突、格式与标注范围、空稿建议、文件恢复、真实导出可重新解析。浏览器覆盖 75%/100%/125% 缩放、键盘选择、取消后晚到结果、接受→版本→警告→导出、格式与标注刷新恢复、离线草稿恢复、讲稿 Diff、集中搜索、版本比较、导出失败重试及 390px 无横向溢出。04 的工作台/评论回归同时通过。

截图（测试 fixture / Edge headless，已查看）：

- `artifacts/rewrite05/diff-desktop.png`：1440×1024，PPT 选择及建议。
- `artifacts/rewrite05/versions-desktop.png`：1440×1024，比较、布局警告及导出。
- `artifacts/rewrite05/script-narrow.png`：390×844，集中讲稿。

## 01/02/04/06 集成边界与限制

- 01：继续使用现有解析器的文字结构预览，选择层与这份预览共享几何参数。尚不能宣称和 PowerPoint 复杂母版、图片、混合字体/run 的真实排版逐字对齐；真实渲染/字符坐标需由引擎提供。本任务没有改 PPTX 底层或伪造预览图。
- 02：消费现有模型端口和共享契约；本轮模型输出在测试中 mock，没有使用真实模型密钥验收。取消会关闭本次界面请求并忽略晚到结果，底层模型调用不支持中断时仍可能完成并保留未接受建议。
- 04：共享外壳、评论区及 slot 签名保持兼容。PPT 的“添加标注”入口当前使用本机 localStorage 记录当前版本选区，尚未接入跨设备标注服务；它不属于右侧评论串。讲稿标注已走服务端文档保存。
- 06：服务仍是现有单进程本地存储部署；跨进程并发需由正式存储层提供事务保障。选区/无关格式/文件内容已有测试，未声称完成真实 PowerPoint GUI 打开、读屏软件全量审计或复杂中日韩输入法矩阵验收。
- 超长 Diff 的词数乘积超过 250000 时退化为整段删除/插入，避免二次方内存耗尽。
