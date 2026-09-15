# Deck Rehearsal

把已有 PPTX 变成可评审、可改写、可管理版本的本地工作台。06 已将真实 Open XML 引擎、领域服务、持久化 AI Worker 和 03–05 界面装配到同一流程。

## 从全新检出启动

需要 Node.js 24+、pnpm 11.22.0。Windows 的完整浏览器验收使用 Microsoft Edge。

```powershell
pnpm install --frozen-lockfile
# 仅首次创建；保留已有配置
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm db:migrate
pnpm dev
```

打开 [本机项目列表](http://127.0.0.1:3000/projects)。默认内置 Worker；无需另起数据库服务。当前数据库是 `DATA_DIR/workspace.json`，对象是 `DATA_DIR/objects`。`DATA_DIR` 默认仓库的 `.local-data`，两个进程使用自定义路径时必须填同一个绝对目录。

要使用独立 Worker，在 `.env` 设置 `EMBEDDED_WORKER=false`，分别在两个终端运行：

```powershell
pnpm dev:web
pnpm dev:worker
```

Web 只保存请求，独立 Worker 负责调度分析/回复并发布状态。两个入口都读取仓库 `.env`，并通过 `workspace.lock` 串行提交。旧的 `apps/worker` 包级 CLI 仍是单独 AI 端口示例；应用集成请使用根目录命令。

## AI 配置和演示

在 `.env` 填写 `MODEL_API_KEY`、`MODEL_BASE_URL`、`MODEL_NAME`。兼容接口需支持 `/chat/completions` 和 JSON 输出。密钥仅在服务端读取；未配置会得到可恢复错误。开始分析后，当前材料的文字、备注、布局和背景发送给所配置服务。当前没有多模态原图理解。

演示路径：新建项目 → 上传 `tests/fixtures/pptx/demo-6.pptx` → 确认或留空目标 → 开始分析 → 评论定位与回复 → 选择 PPT 文字并接受/拒绝 Diff → 编辑/标注讲稿 → 版本页导出。文件与版本真实保存；没有页面内硬编码 AI 评论。讲稿“改写选区”先选文字，再打开 AI 改写工具。

无需模型凭证的完整自动演示运行 `pnpm test:acceptance`，使用真实 HTTP、浏览器、存储、Worker、PPTX 和确定性模型端口替身。

## 统一验证

```powershell
pnpm check
# 定向检查
pnpm test:integration
pnpm test:acceptance
```

`pnpm check` 包含类型、Lint、格式、单元/集成/真实 PPTX 测试，以及全部浏览器 E2E。06 浏览器测试同时运行 axe WCAG A/AA 检查与 1440×1024、1366×768、390×844 像素回归。CI 使用同一命令，配置位于 `.github/workflows/check.yml`；本地通过不代表远端 CI 已运行。

Windows 基线使用 Edge 和锁定依赖中的 Noto Sans SC 字体。Linux 可用 `PLAYWRIGHT_CHANNEL=chromium` 并安装 Playwright Chromium；尚未提供 Linux 像素基线。确认视觉改动后才更新基线：

```powershell
$env:UPDATE_VISUAL='1'
pnpm test:acceptance
Remove-Item Env:\UPDATE_VISUAL
pnpm test:acceptance
```

截图、像素差异、axe 报告、真实导出文件和性能数据输出到 `artifacts/integration06/`。测试失败时不要直接更新基线消除差异。

## 数据迁移、备份和恢复

`pnpm db:migrate` 从空目录建立 schema v2；旧本地快照缺少字段时补齐，保留项目、文件引用、版本、线程及上传状态。v2 将 AI 队列/缓存和工作区放入同一原子快照，避免双库提交。未知未来版本会拒绝打开。独立旧 `ai-worker.json` 中的实验数据不自动迁移；应用已有 `workspace.json` 评论仍可继续回复。

备份与回滚前停止 Web 和 Worker，复制整个 `DATA_DIR`，包括 `workspace.json` 和 `objects`。例如默认目录：

```powershell
Copy-Item -LiteralPath .local-data -Destination ('../deck-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Recurse
```

恢复时将备份完整还原到一个空数据目录，再让 `DATA_DIR` 指向该目录。回滚应用同时恢复升级前备份；不要让旧程序消费 v2 队列。进程被强杀后可能留下 `workspace.lock`，应先确认两个进程均已停止、完成备份，再删除该空锁目录。不会自动抢占不确定的存储锁。模型任务有租约，进程重启后可重新领取已过期任务。

## 已知边界

- 画布仍为文字结构预览。复杂图形、母版、混合字体的高保真渲染和字符级坐标尚待 01 渲染适配器交付；文字结构导出不等于完整视觉保真。
- 本地 schema v2 已测试；PostgreSQL schema 仍为预留模型，`DATABASE_URL`、对象存储和外部队列配置当前不参与应用运行。生产数据库迁移未交付。
- 默认绑定回环地址，当前没有登录、租户隔离或加密存储，不应作为多用户线上服务部署。
- 已验证页面缓存复用；真实模型延迟、质量、费用和视觉模型效果尚未验收。60 页结果中的毫秒数据使用确定性模型，不能与真实 AI 的五分钟目标直接比较。
- PPT 本地选区标注仍只存在浏览器本机；讲稿标注已经服务端持久化。完整读屏器/输入法矩阵、复杂 PPT 样本库和生产负载仍未覆盖。

详细结果、复现方式和后续责任见 [06 交接](development/06-integration-handoff.md)。
