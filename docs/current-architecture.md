# 汇报预演室：当前技术架构与数据流

更新时间：2026-09-16。对应应用代码提交：`a8336d5`。本文描述实际实现，不把规划功能当作已完成能力。

## 1. 总体架构

```mermaid
flowchart TB
  U[用户：上传 / 评审 / 回复 / 局部改写] --> UI[React 19 + TypeScript 浏览器界面]
  UI <-->|HTTP API / 状态轮询| API[Node HTTP 服务 apps/web]
  API --> S[IntegratedWorkspaceService 业务编排]
  S --> P[OpenXmlPptxProcessor 本地 PPTX 解析与修改]
  S --> W[ReviewWorker 持久化任务处理]
  T[默认每 1 秒调度一次] --> W
  W --> A[AnalysisPipeline / ReviewModelGateway]
  S --> R[LocalRewriteService 局部改写]
  R --> A
  PR[角色 Markdown + 公共约束 + 输出 Schema] --> A
  A <-->|服务端 HTTPS 请求与 JSON 响应| L[千问 Token Plan / qwen3.6-flash]
  E[服务端 .env 配置与密钥] --> A
  S <--> DB[(本地 workspace.json)]
  W <--> DB
  P <--> OBJ[(本地 objects：PPTX 文件)]
  P -->|原图字节经图片 API| UI
```

这是 **单机文件持久化应用**，不是已经上线的云端多租户架构。前端由 esbuild 构建；Web 默认内嵌 Worker，也可以关闭 `EMBEDDED_WORKER` 后运行独立 Worker，共用同一绝对 `DATA_DIR`。没有实际接入 Redis、向量数据库或 PostgreSQL；`.env.example` 中的数据库/队列配置是预留项。

主要评审、回复、局部改写走运行时 `ReviewModelGateway`；基础服务仍保留 `JsonModelGateway` 路径，不能把所有 AI 功能理解成同一个角色聊天接口。

## 2. 上传 → 解析 → 分析 → 评论

```mermaid
flowchart TD
  A[上传 PPTX：上限 60 页 / 50 MB] --> B[校验文件并保存原始 PPTX]
  B --> C[本地解压 Open XML]
  C --> D[提取每页文本 / 元素坐标 / 备注 / 稳定 ID]
  D --> E[(持久化 slides / contexts / versions)]
  E --> F[提交分析任务并保存项目快照]
  F --> G[Worker 领取任务：租约 + 防重复提交]
  G --> H[按页检查内容哈希缓存]
  H -->|命中| I[直接复用 PageAnalysis]
  H -->|未命中| J[最多 3 页并发调用模型]
  J --> K[公共约束 + 单页数据 + JSON 输出规则]
  K --> L[校验响应并缓存成功页]
  I --> M[汇总逐页结果 / 更新进度]
  L --> M
  M --> N[按汇报场景选择 3–4 位评审人]
  N --> O[每人独立调用：人设 + 整份 PPT + 逐页结果 + 输出规则]
  O --> P[校验 / 按角色去重 / 创建评论线程]
  P --> Q[(保存评论、目标建议、叙事摘要、任务结果)]
  Q --> R[前端轮询结果并显示评论]
  X[失败后重试] --> F
```

重试复用已经解析的 `slides` 和成功页缓存，不重新解压整份 PPT，也不重跑命中的单页模型分析。但最终“各角色生成评论”仍可能重新调用，不能把它理解成整条分析任务完全零成本续跑。

缓存键包含项目 ID、模型/接口命名空间、提示词/Schema 版本、页面稳定 ID、内容与布局字段；不以页码或 PPT 版本号作为唯一依据，因此单纯重排页面能复用结果，修改页面内容会使相关缓存失效。缓存中的“提示词版本”是程序版本常量，不代表自动追踪每份角色 Markdown 的内容哈希。

进度表示已尝试处理的页数；到达 12/12 后仍可能需要生成角色评论。部分页面失败会保留诊断，所有页面失败则报错。模型超时/限流/输出不合格式也是独立错误，不是 PPT 解压失败。

## 3. 提示词何时进入模型

```mermaid
flowchart LR
  C[公共事实约束] --> S[system 消息]
  P[当前角色 Markdown] -->|仅初始评审与角色回复| S
  T[任务说明 + Prompt 版本 + Schema 版本] --> U[user 消息：JSON]
  D[PPT 数据 / 当前问题 / 本角色历史] --> U
  O[输出 JSON Schema 与字数规则] --> U
  S --> M[一次独立 chat/completions 请求]
  U --> M
  M --> V[解析 JSON + Schema / 业务校验]
  V -->|不合法| F[上次结果 + 字段纠错提示]
  F --> M
  V -->|合法| DB[持久化业务结果]
```

| 阶段 | 人设 | 模型接收的数据 | 结果 |
| --- | --- | --- | --- |
| 单页分析 | 无专属评审人设 | 单页元素、备注、布局、已有视觉摘要等结构化数据 | 页面摘要与问题依据 |
| 初始角色评审 | 当前评审人的 Markdown | 相同的整份 PPT、背景、逐页分析结果；不传其他角色评论 | 当前角色评论，每条 0–100 显示字符 |
| 用户回复某角色 | 同一角色 Markdown，每次重新读取 | 当前评论锚点、该角色在本项目的评论与双方历史、当前 PPT 全文与分析 | 该角色回复，0–100 显示字符 |
| PPT / 讲稿局部改写 | 不使用评论人人设 | 选中文本、相关页面上下文、修改要求 | 改写建议，等待接受或拒绝 |

真实请求的 `system` 是公共安全/事实约束加人设；`user` 是序列化 JSON，包含 `task`、`promptVersion`、`schemaVersion`、`outputSchema`、`input`。人设也放入 `input.personaPrompt`。这不是先后发三轮消息，而是在同一次请求内组合“人设、材料、规则”。

模型不合法输出会带纠错信息重试，最多 3 次尝试；失败的上一份输出只用于这次纠错，不等于持久聊天历史。材料被声明为数据，不应执行 PPT 中的指令。服务端校验并不能完全保证模型内容事实正确。

实际提示词目录：`packages/ai/src/prompts/reviewers/`。

| 文件 | 角色关注点 |
| --- | --- |
| `jack.md` | 决策、投入产出 |
| `olivia.md` | 证据、数据口径 |
| `ryan.md` | 商业化、增长 |
| `mia.md` | 产品体验、理解成本 |
| `emma.md` | 表达、传播风险 |
| `leo.md` | 工程交付、资源 |
| `sophie.md` | 听众疑问、记忆点 |

## 4. 每个评审人如何拥有独立上下文

```mermaid
sequenceDiagram
  actor U as 用户
  participant API as Web API
  participant DB as workspace.json
  participant W as ReviewWorker
  participant P as 当前角色提示词文件
  participant AI as 千问模型
  U->>API: 在 Olivia 某条评论下回复
  API->>DB: 保存用户回复 + reply 任务（幂等）
  API-->>U: 返回生成任务状态
  W->>DB: 领取任务并读取当前项目快照
  W->>DB: 筛选 projectId + reviewerId = Olivia 的全部线程
  DB-->>W: Olivia 的初始评论与按时间排序的双方回复
  Note over DB,W: 不加入其他评审人的评论历史
  W->>P: 读取 Olivia 人设
  P-->>W: 人设文本
  W->>AI: 人设 + 当前 PPT + 分析结果 + 本角色历史 + 当前锚点 + 输出规则
  AI-->>W: JSON 回复
  W->>W: 校验输出与项目版本/快照一致性
  W->>DB: 将 AI 回复追加到当前评论线程
  U->>API: 轮询任务/读取评论详情
  API->>DB: 读取线程
  API-->>U: 展示回复
```

**逻辑会话键是 `projectId + reviewerId`，物理保存键仍是 `commentId`。** 一个角色的多条评论在界面上有各自回复串；调用模型时，会把同项目同角色的这些串聚合。历史包含版本标记，可跨 PPT 版本存在；当前材料取当前版本。

同一项目同一角色一次处理一个回复，避免并发回复错序。不同角色共享 PPT 材料，不共享私人对话历史。这里的隔离是应用筛选逻辑，不是为每个人创建了模型供应商端的独立常驻 Agent。

## 5. 长期数据、短期上下文到底存在哪里

```mermaid
flowchart TB
  subgraph DISK[本地磁盘：重启后仍可读取]
    PPT[objects：原始和派生 PPTX]
    DECK[workspace.json：页面、背景、版本、讲稿]
    HIS[workspace.json：各角色评论与回复]
    CACHE[workspace.json：成功页分析缓存与任务]
    PERSONA[代码目录：角色 Markdown]
  end
  DECK --> SNAP[服务端内存：当前快照]
  HIS --> FILTER[按项目和角色筛选历史]
  CACHE --> SNAP
  SNAP --> CTX[服务端内存：本次请求上下文]
  FILTER --> CTX
  PERSONA --> CTX
  CTX --> MODEL[模型请求：每次重新提供上下文]
  MODEL --> SAVE[校验后持久化回复或分析结果]
  SAVE --> HIS
  SAVE --> CACHE
  PPT --> ZIP[服务端内存：最多 2 份 PPTX 解压缓存]
  subgraph BROWSER[浏览器]
    STATE[React 状态：选中、展开、加载]
    SESSION[sessionStorage：未发送草稿、任务与请求标识]
  end
  SESSION -->|用户发送后| HIS
```

默认数据目录是 `D:\项目2\.local-data`，可通过 `DATA_DIR` 覆盖。下表是默认路径，不是云端存储地址。

| 数据 | 物理位置 / JSON 字段 | 生命周期与作用 |
| --- | --- | --- |
| 原始与新版本 PPTX | `.local-data/objects/<storageKey>` | 持久文件；已存版本不原地覆盖 |
| 项目与版本关系 | `.local-data/workspace.json` 的 `projects`、`sources`、`versions` | 项目持久记录 |
| PPT 结构、背景 | `slides[versionId]`、`contexts[versionId]` | 共享知识来源；不是向量索引 |
| 评论及双方回复 | `threads[commentId]` | 角色对话持久历史 |
| Worker 线程视图 | `aiWorker.threads[commentId]` | 与业务线程同步的处理视图，不是第二套独立记忆 |
| 页分析缓存 | `aiWorker.pageCache[hash]` | 成功页结果，支持重试复用 |
| 队列、分析结果与快照 | `aiWorker.jobs`、`aiWorker.analysis`、`aiWorker.snapshots` | 本地持久队列与工作快照 |
| UI 进度和上传状态 | `jobs`、`uploadStates`、`aiLinks` | 前端轮询与任务映射 |
| 讲稿内容与标注 | `documents[projectId][slideId]` 等业务字段 | 可编辑讲稿、修订与标注 |
| 人设 | `packages/ai/src/prompts/reviewers/*.md` | 源码管理，每次生成/回复读取 |
| 密钥 | 根目录 `.env` | 仅服务端使用，不进入 Git，不发给浏览器 |
| 未发送回复草稿 | 浏览器 `sessionStorage` 的 `review-draft:项目ID:评论ID` | 当前浏览器标签页会话；不是服务端长期记忆 |
| 本次模型 messages / 纠错输出 | 服务端进程内存 | 请求期间存在，无独立长期 messages 数据库 |
| UI 展开、选区、忙碌状态 | 浏览器 React 内存 | 刷新后通常重新建立 |

`LocalWorkspaceStore` 使用进程内串行队列、`workspace.lock` 跨进程锁、临时文件写入后原子重命名来更新 JSON。它不是数据库事务引擎；随着数据增长，整份 JSON 的读写和历史拼接会成为瓶颈。

**准确说法：已有长期持久化历史，但没有独立的“长期记忆智能系统”。** 目前没有向量检索、用户画像记忆、历史摘要压缩、Token 预算裁剪。短期上下文是每次从持久化数据重新拼装的请求，不是自动只保留最近几轮。历史变长时会增加请求体、耗时和上下文溢出风险。

## 6. 原图显示与 AI 分析是两条独立路径

```mermaid
flowchart LR
  P[PPTX 文件] --> X[解压 Open XML]
  X --> T[文本 / 坐标 / 备注]
  T --> AI[单页 AI 分析：结构化文本输入]
  X --> R[图片关系 rId → ppt/media 资源]
  R --> B[图片 API 返回原始图片字节]
  B --> UI[浏览器按元素坐标显示 img]
```

图片端点：`/api/projects/:projectId/image/:versionId/:slideId/:elementId`。先验证版本属于项目，再读取图片。支持 PNG/JPEG/GIF/WebP；浏览器私有缓存最长 24 小时。服务端以文件哈希缓存最多两份解压档案，重启会失效。

当前没有把原图字节或 `image_url` 送给模型，也没有额外 OCR/视觉识别流水线。因此显示原图不等于 AI 看懂原图；结构化预览也不等于 PowerPoint 完整渲染，复杂母版、图表和特殊图形仍有保真限制。

## 7. 选中文字 → AI 改写 → 接受或拒绝

```mermaid
flowchart TD
  S[用户选择 PPT 或讲稿局部文本] --> C[读取选区、当前版本、相关页上下文]
  C --> M[模型生成局部改写建议]
  M --> V[校验建议并展示 Diff]
  V --> D{用户决定}
  D -->|不接受| N[原文保持不变]
  D -->|接受 PPT 修改| P[校验版本与选区 / 写入派生 PPTX]
  P --> PV[保存新版本关系 / 更新解析结构]
  D -->|接受讲稿修改| T[更新讲稿文档及修订信息]
  PV --> DB[(workspace.json + objects)]
  T --> DB
```

模型返回建议本身不等于修改原文件；用户接受后才应用。PPT 文件版本与讲稿文档修订属于不同的数据链，不应混为一体。

## 8. 当前边界与后续演进点（尚未实现）

1. 多用户：当前具备项目/角色维度筛选，但不是已经完成账号权限隔离的 SaaS。
2. 长记忆：后续可引入“角色摘要 + 最近轮次 + 相关历史检索”，现在仍是全量历史拼接。
3. 并发与存储：JSON 文件队列适合本地；多实例需要数据库、对象存储、可租约任务队列。
4. 视觉理解：现在本地提取和显示图片；如需模型理解图像，应增加明确的视觉输入策略、成本预算和缓存。
5. 汇报摘要：角色独立生成结果后，当前整体目标/叙事摘要取首个角色结果，不是额外的多角色共识模型。
6. 提示词追溯：人设文件随源码版本管理，但每次调用没有完整提示词快照审计表。

## 9. 代码索引

- 启动与内嵌调度：`apps/web/src/index.ts`
- HTTP / 图片路由 / 网关装配：`apps/web/src/server/http.ts`
- 业务编排：`apps/web/src/server/integrated-service.ts`、`service.ts`
- Worker 与业务数据同步：`apps/web/src/server/worker-store.ts`
- 任务租约与角色历史筛选：`apps/worker/src/review-worker.ts`
- 分页并发与缓存键：`packages/ai/src/pipeline.ts`
- 请求消息与角色独立生成：`packages/ai/src/gateway.ts`
- 人设加载：`packages/ai/src/reviewer-prompts.ts`
- 局部改写：`packages/ai/src/rewrites.ts`
- JSON 持久化与锁：`packages/db/src/local-store.ts`
- PPTX 解析与原图读取：`packages/pptx/src/index.ts`

本次文档生成未重新发送用户 PPT 到模型，也未修改运行中的项目数据。
