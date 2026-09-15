import { asyncReviewGateway } from "../features/review-thread/gateway.js";
import {
  SlideTextSelectionLayer,
  elementStyle,
} from "../features/slide-rewrite/selection.js";
import { ScriptPage } from "../features/presenter-script/page.js";
import type { ReactNode } from "react";
import { Comments } from "../features/review-thread/comments.js";
import { WorkflowNavigation } from "../features/workspace-shell/navigation.js";
import { Splitter, useSplit } from "../features/workspace-shell/splitter.js";
import { ThumbnailRail } from "../features/review-workbench/slots.js";
import type { WorkbenchSlots } from "../features/review-workbench/slots.js";
import { Upload, uploadLabels, stableRequestKey } from "./upload.js";
import type {
  UploadSnapshot as WorkspaceSnapshot,
  UploadState,
} from "@deck-rehearsal/db";
import { PresenterScriptEditor as ScriptEditor } from "../features/presenter-script/editor.js";
import { Versions } from "../features/version-history/page.js";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, SyntheticEvent } from "react";
import { createRoot } from "react-dom/client";
import type {
  ReviewGateway,
  AsyncReviewGateway,
  Project,
  Slide,
  SelectionRewrite,
  TextSelection,
  ScriptDocument,
} from "@deck-rehearsal/contracts";
const scenarios: Record<string, string> = {
  project_report: "项目汇报",
  resource_request: "资源申请",
  research_report: "研究汇报",
  other: "其他",
  work_report: "工作复盘",
  performance_review: "晋升述职",
  proposal_presentation: "项目提案",
  solution_review: "方案评审",
  product_launch: "产品发布",
  course_presentation: "课程展示",
  thesis_defense: "毕业答辩",
  academic_talk: "学术报告",
  startup_pitch: "创业路演",
  public_speaking: "公开演讲",
};
async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
  key?: string,
): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? {}
      : {
          method,
          headers: {
            "content-type": "application/json",
            "idempotency-key": key ?? crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
  );
  const data: unknown = await response.json();
  if (!response.ok) throw new Error((data as { error: string }).error);
  return data as T;
}
function navigate(url: string) {
  history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
function useLocation() {
  const [url, setUrl] = useState(() => new URL(location.href));
  useEffect(() => {
    const update = () => setUrl(new URL(location.href));
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return url;
}
function Button({
  children,
  primary = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      {...props}
      className={`button ${primary ? "primary" : ""} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
function App() {
  const url = useLocation();
  const projectId = /^\/projects\/([^/]+)/.exec(url.pathname)?.[1];
  const [error, setError] = useState("");
  return (
    <>
      <div className="toast" role="alert" hidden={!error}>
        {error}
        <button aria-label="关闭提示" onClick={() => setError("")}>
          ×
        </button>
      </div>
      {projectId && projectId !== "new" ? (
        <Workspace
          key={projectId}
          projectId={projectId}
          url={url}
          onError={setError}
        />
      ) : (
        <Projects isNew={projectId === "new"} onError={setError} />
      )}
    </>
  );
}
function Projects({
  isNew,
  onError,
}: {
  isNew: boolean;
  onError: (s: string) => void;
}) {
  const [projects, setProjects] = useState<
    (Project & { uploadState: UploadState; versionNumber: number })[]
  >([]);
  const [draft] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem("new-project-draft") ?? "{}",
      ) as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<(Project & { uploadState: UploadState; versionNumber: number })[]>(
      "/project-summaries",
    )
      .then(setProjects)
      .catch((e: unknown) => onError(String(e)));
  }, [onError]);
  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const fields = new FormData(event.currentTarget);
    const input = {
      name: fields.get("name"),
      audience: fields.get("audience"),
      scenario: fields.get("scenario"),
      durationMinutes: Number(fields.get("duration")),
      ...(fields.get("customScenario")
        ? { customScenario: fields.get("customScenario") }
        : {}),
    };
    try {
      const project = await api<Project>(
        "/projects",
        input,
        "POST",
        stableRequestKey("new-project-request", JSON.stringify(input)),
      );
      sessionStorage.removeItem("new-project-draft");
      sessionStorage.removeItem("new-project-request");
      navigate(`/projects/${project.id}/upload`);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="projects">
      <div className="eyebrow">DECK REHEARSAL / 汇报预演室</div>
      <div className="page-heading">
        <div>
          <h1>
            {isNew ? "为下一次汇报，做好准备。" : "让好内容，被更好地理解。"}
          </h1>
          <p>保留你的观点，和 AI 模拟听众一起打磨表达。</p>
        </div>
        {!isNew && (
          <Button primary onClick={() => navigate("/projects/new")}>
            ＋ 新建预演项目
          </Button>
        )}
      </div>
      {isNew ? (
        <form
          className="project-form"
          onSubmit={(e) => void submit(e)}
          onChange={(e) =>
            sessionStorage.setItem(
              "new-project-draft",
              JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
            )
          }
        >
          <label>
            汇报主题
            <input
              name="name"
              defaultValue={draft.name ?? ""}
              required
              maxLength={200}
              placeholder="例如：第三季度产品增长复盘"
            />
          </label>
          <label>
            汇报场景
            <select
              name="scenario"
              defaultValue={draft.scenario ?? "work_report"}
            >
              {Object.entries(scenarios).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            其他场景说明（选择“其他”时填写）
            <input
              name="customScenario"
              maxLength={1000}
              defaultValue={draft.customScenario ?? ""}
            />
          </label>
          <label>
            真实听众
            <input
              name="audience"
              defaultValue={draft.audience ?? ""}
              required
              placeholder="他们是谁？了解多少背景？"
            />
          </label>
          <label>
            预计时长（分钟）
            <input
              name="duration"
              type="number"
              min={1}
              max={480}
              defaultValue={draft.duration ?? 15}
              required
            />
          </label>
          <div className="actions">
            <Button type="button" onClick={() => navigate("/projects")}>
              返回项目
            </Button>
            <Button primary disabled={busy}>
              {busy ? "正在创建…" : "创建并上传 PPTX →"}
            </Button>
          </div>
        </form>
      ) : projects.length ? (
        <div className="project-grid">
          {projects.map((p) => (
            <button
              key={p.id}
              className="project-card"
              onClick={() =>
                navigate(
                  `/projects/${p.id}/${p.uploadState.stage === "completed" ? "review" : "upload"}`,
                )
              }
            >
              <span className="project-symbol">▱</span>
              <span className="muted">
                {scenarios[p.scenario] ?? p.scenario} · {p.durationMinutes} 分钟
              </span>
              <h2>{p.name}</h2>
              <p>{p.audience}</p>
              <p>
                {uploadLabels[p.uploadState.stage]} ·{" "}
                {p.versionNumber ? "V" + String(p.versionNumber) : "尚无版本"}
              </p>
              <span className="card-footer">
                {new Date(p.updatedAt).toLocaleDateString("zh-CN")}
                <span>继续预演 ↗</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <span className="empty-icon">▱</span>
          <h2>从你已经写好的 PPT 开始</h2>
          <p>上传 1–60 页 PPTX，建立属于这次汇报的评审空间。</p>
          <Button onClick={() => navigate("/projects/new")}>
            新建第一个项目
          </Button>
        </div>
      )}
      <p className="privacy">
        本地开发版 · 文稿保存在本机。开始 AI
        分析后，文稿文字与背景将发送至你配置的模型服务。
      </p>
    </main>
  );
}
export function Workspace({
  projectId,
  url,
  onError,
  slots = {},
  reviews,
}: {
  slots?: WorkbenchSlots;
  reviews?: ReviewGateway | AsyncReviewGateway;
  projectId: string;
  url: URL;
  onError: (s: string) => void;
}) {
  const [data, setData] = useState<WorkspaceSnapshot>();
  const [loading, setLoading] = useState(true);
  const [right, setRight] = useSplit("review-width", 360, 340, 370);
  const [top, setTop] = useSplit("slide-height", 62, 35, 75);
  const [drawer, setDrawer] = useState<"slides" | "comments" | null>(null);
  useEffect(() => {
    if (!drawer || !window.matchMedia("(max-width: 800px)").matches) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = document.querySelector<HTMLElement>(
      drawer === "slides" ? ".slide-rail" : ".review-panel",
    );
    const central = document.querySelector<HTMLElement>(".central");
    if (central) central.inert = true;
    panel?.querySelector<HTMLElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawer(null);
      }
      if (event.key !== "Tab" || !panel) return;
      const items = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length);
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      if (central) central.inert = false;
      window.removeEventListener("keydown", keydown);
      previous?.focus({ preventScroll: true });
    };
  }, [drawer]);
  const [zoom, setZoom] = useState(100);
  const [suggestion, setSuggestion] = useState<SelectionRewrite>();
  const [generating, setGenerating] = useState(false);
  const generation = useRef(0);
  const origin = useRef<HTMLElement | null>(null);
  const originRange = useRef<Range | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [rewriteError, setRewriteError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [pptNote, setPptNote] = useState(false);
  const [pptNoteText, setPptNoteText] = useState("");
  function savedDocument(doc: ScriptDocument) {
    setData((old) =>
      old
        ? { ...old, documents: { ...old.documents, [doc.slideId]: doc } }
        : old,
    );
  }
  function closeRewrite() {
    generation.current++;
    setGenerating(false);
    setSuggestion(undefined);
    setSelected(undefined);
    setRewriteError("");
    setPptNote(false);
    origin.current?.focus({ preventScroll: true });
    if (
      originRange.current &&
      origin.current?.contains(originRange.current.startContainer)
    ) {
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(originRange.current);
    }
  }

  const [selected, setSelected] = useState<{
    target: "ppt" | "script";
    selection: TextSelection;
  }>();
  const section = url.pathname.split("/")[3] ?? "review";
  const load = async () => {
    try {
      setData(await api<WorkspaceSnapshot>(`/projects/${projectId}`));
    } catch (e) {
      onError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [projectId]);
  useEffect(() => {
    if (
      !data ||
      ["failed", "completed", "cancelled", "waiting_upload"].includes(
        data.uploadState.stage,
      )
    )
      return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [data?.uploadState.stage]);
  const slides = data?.slides ?? [];
  const slide =
    slides.find((s) => s.id === url.searchParams.get("slide")) ??
    slides.find(
      (s) =>
        s.id ===
        data?.comments.find((c) => c.id === url.searchParams.get("comment"))
          ?.relatedSlideIds[0],
    ) ??
    slides[0];

  useEffect(() => {
    closeRewrite();
  }, [slide?.id, slide?.deckVersionId, section]);
  useEffect(() => {
    if (suggestion)
      document.querySelector<HTMLElement>(".diff-dialog button")?.focus();
  }, [suggestion]);
  function goSlide(id: string) {
    const canvas = document.querySelector(".canvas-pane");
    canvas?.classList.remove("located");
    requestAnimationFrame(() => canvas?.classList.add("located"));
    const next = new URL(location.href);
    next.searchParams.set("slide", id);
    navigate(next.pathname + next.search);
    setSelected(undefined);
    setDrawer(null);
  }
  function goSection(value: string) {
    navigate(
      `/projects/${projectId}/${value}${slide ? `?slide=${slide.id}` : ""}`,
    );
    setSelected(undefined);
    setDrawer(null);
  }
  async function rewrite() {
    if (!selected) return;
    const token = ++generation.current;
    origin.current =
      selected.target === "script"
        ? document.querySelector<HTMLElement>('[contenteditable="true"]')
        : ([
            ...document.querySelectorAll<HTMLElement>("[data-element-id]"),
          ].find(
            (el) => el.dataset.elementId === selected.selection.elementId,
          ) ?? null);
    const currentSelection = window.getSelection();
    originRange.current = currentSelection?.rangeCount
      ? currentSelection.getRangeAt(0).cloneRange()
      : null;
    setRewriteError("");
    setGenerating(true);
    try {
      const result = await api<SelectionRewrite>(
        `/projects/${projectId}/suggest`,
        {
          ...selected,
          ...(selected.target === "script"
            ? {
                scriptRevision:
                  data?.documents[selected.selection.slideId]?.revision,
              }
            : {}),
        },
      );
      if (token === generation.current) setSuggestion(result);
    } catch (e) {
      if (token === generation.current) setRewriteError(String(e));
    } finally {
      if (token === generation.current) setGenerating(false);
    }
  }
  async function accept() {
    if (!suggestion || accepting) return;
    setAccepting(true);
    setGenerating(true);
    try {
      await api(
        `/projects/${projectId}/accept`,
        { suggestionId: suggestion.id },
        "POST",
        suggestion.id,
      );
      setSuggestion(undefined);
      setSelected(undefined);
      await load();
      setEditorEpoch((n) => n + 1);
      origin.current?.focus({ preventScroll: true });
    } catch (e) {
      setRewriteError(String(e));
    } finally {
      setAccepting(false);
      setGenerating(false);
    }
  }
  if (loading)
    return (
      <main className="empty">
        <p>正在打开项目…</p>
      </main>
    );
  if (!data)
    return (
      <main className="empty">
        <h1>无法打开项目</h1>
        <Button onClick={() => navigate("/projects")}>返回项目列表</Button>
      </main>
    );
  const nav = <WorkflowNavigation section={section} onNavigate={goSection} />;
  return (
    <main
      className={`workspace drawer-${drawer ?? "none"}`}
      style={
        {
          "--right-width": `${right}px`,
          "--top-height": `${top}%`,
        } as CSSProperties
      }
    >
      <aside className="slide-rail">
        <button className="back" onClick={() => navigate("/projects")}>
          ← 所有项目
        </button>
        <div className="rail-title">
          演示文稿 <span>{slides.length} 页</span>
        </div>
        <ThumbnailRail
          slides={slides}
          selectedId={slide?.id}
          onSelect={goSlide}
        />
        <span className="rail-footer">DECK REHEARSAL</span>
      </aside>
      <div className="mobile-bar">
        <Button
          onClick={() => setDrawer(drawer === "slides" ? null : "slides")}
        >
          页面
        </Button>
        <span>{data.project.name}</span>
        <Button
          onClick={() => setDrawer(drawer === "comments" ? null : "comments")}
        >
          评审与导航
        </Button>
      </div>
      <section className="central">
        {section === "upload" ? (
          <Upload
            data={data}
            reload={load}
            onError={onError}
            onReview={() => goSection("review")}
          />
        ) : section === "versions" ? (
          <Versions data={data} reload={load} onError={onError} />
        ) : !slide ? (
          <div className="empty">
            <h2>还没有演示文稿</h2>
            <p>先上传 PPTX，即可查看页面、准备讲稿并开始评审。</p>
            <Button onClick={() => goSection("upload")}>上传 PPTX</Button>
          </div>
        ) : section === "script" ? (
          <ScriptPage
            key={editorEpoch}
            projectId={projectId}
            slides={slides}
            documents={data.documents}
            slide={slide}
            onSelect={goSlide}
            onSaved={savedDocument}
            onError={onError}
            onSelection={(selection) =>
              setSelected({ target: "script", selection })
            }
          />
        ) : (
          <>
            <div
              className="canvas-pane"
              onAnimationEnd={(e) =>
                e.currentTarget.classList.remove("located")
              }
            >
              <header className="canvas-header">
                <div>
                  <span className="eyebrow">{data.project.name}</span>
                  <h2>
                    {section === "script" ? "逐页讲稿" : "评审工作台"}{" "}
                    <small>V{data.version?.versionNumber}</small>
                  </h2>
                </div>
                <div className="canvas-actions">
                  <Button
                    title="上一页"
                    disabled={slide.index <= 1}
                    onClick={() => {
                      const s = slides[slide.index - 2];
                      if (s) goSlide(s.id);
                    }}
                  >
                    ←
                  </Button>
                  <span>
                    {slide.index} / {slides.length}
                  </span>
                  <Button
                    title="下一页"
                    disabled={slide.index >= slides.length}
                    onClick={() => {
                      const s = slides[slide.index];
                      if (s) goSlide(s.id);
                    }}
                  >
                    →
                  </Button>
                  <select
                    aria-label="画布缩放"
                    value={zoom}
                    onChange={(e) => {
                      setZoom(Number(e.target.value));
                    }}
                  >
                    {[75, 100, 125, 150].map((n) => (
                      <option key={n} value={n}>
                        {n}%
                      </option>
                    ))}
                  </select>
                </div>
              </header>
              <div className="canvas-scroll">
                <SlideCanvas
                  onClear={() => setSelected(undefined)}
                  slide={slide}
                  zoom={zoom}
                  onSelection={(selection) =>
                    setSelected({ target: "ppt", selection })
                  }
                  selectionLayer={
                    slots.slideTextSelectionLayer
                      ? slots.slideTextSelectionLayer({
                          projectId,
                          slide,
                          zoom,
                          document: data.documents[slide.id] ?? {
                            slideId: slide.id,
                            revision: 0,
                            text: "",
                            marks: [],
                            annotations: [],
                            updatedAt: "",
                          },
                          onSelection: (selection) =>
                            setSelected({ target: "ppt", selection }),
                        })
                      : undefined
                  }
                />
              </div>
              <footer className="canvas-footer">
                <span>文字结构预览 · 复杂图形请在 PowerPoint 中核对</span>
                <span>{slide.hidden ? "备用页 · 已隐藏" : "当前页面"}</span>
              </footer>
            </div>
            <Splitter
              orientation="horizontal"
              label="调整画布与讲稿高度"
              value={top}
              min={35}
              max={75}
              defaultValue={62}
              onChange={setTop}
            />
            {slots.presenterScriptEditor ? (
              slots.presenterScriptEditor({
                projectId,
                slide,
                zoom,
                document: data.documents[slide.id] ?? {
                  slideId: slide.id,
                  revision: 0,
                  text: "",
                  marks: [],
                  annotations: [],
                  updatedAt: "",
                },
                onSelection: (selection) =>
                  setSelected({ target: "script", selection }),
              })
            ) : (
              <ScriptEditor
                key={`${slide.id}:${editorEpoch}`}
                document={
                  data.documents[slide.id] ?? {
                    slideId: slide.id,
                    revision: 0,
                    text: "",
                    marks: [],
                    annotations: [],
                    updatedAt: "",
                  }
                }
                projectId={projectId}
                slide={slide}
                onError={onError}
                onSaved={savedDocument}
                onSelection={(selection) =>
                  setSelected({ target: "script", selection })
                }
              />
            )}
          </>
        )}
      </section>
      <Splitter
        orientation="vertical"
        label="调整评审面板宽度"
        value={right}
        min={340}
        max={370}
        defaultValue={360}
        onChange={setRight}
      />
      <aside className="review-panel">
        {nav}
        <Comments
          data={data}
          url={url}
          onLocate={goSlide}
          navigate={navigate}
          {...(reviews
            ? { gateway: reviews }
            : "asyncReviews" in data && data.asyncReviews
              ? { gateway: asyncReviewGateway }
              : {})}
        />
      </aside>
      {drawer && (
        <button
          className="drawer-backdrop"
          aria-label="关闭抽屉"
          onClick={() => setDrawer(null)}
        />
      )}
      {selected && !suggestion && (
        <div
          className="selection-toolbar"
          role="toolbar"
          aria-label="选中文字操作"
          onKeyDown={(e) => {
            if (e.key === "Escape") closeRewrite();
          }}
        >
          <span>
            {selected.target === "ppt" ? "PPT" : "讲稿"} · 已选{" "}
            {selected.selection.selectedText.length} 字
          </span>
          <Button primary disabled={generating} onClick={() => void rewrite()}>
            {generating ? "正在生成建议…" : "✦ AI 改写"}
          </Button>
          <Button
            onClick={() => {
              void navigator.clipboard
                .writeText(selected.selection.selectedText)
                .catch((e: unknown) => onError(String(e)));
            }}
          >
            复制
          </Button>
          {selected.target === "ppt" && (
            <Button onClick={() => setPptNote(true)}>添加标注</Button>
          )}
          {rewriteError && <span role="alert">{rewriteError}</span>}
          {pptNote && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const key = `ppt-notes:${projectId}`;
                try {
                  const notes = JSON.parse(
                    localStorage.getItem(key) ?? "[]",
                  ) as unknown[];
                  localStorage.setItem(
                    key,
                    JSON.stringify([
                      ...notes,
                      {
                        selection: selected.selection,
                        text: pptNoteText,
                        author: "我",
                        createdAt: new Date().toISOString(),
                      },
                    ]),
                  );
                  setPptNoteText("");
                  setPptNote(false);
                  onError("文字标注已保存在本机，绑定当前版本与选区");
                } catch {
                  onError("标注保存失败，请重试");
                }
              }}
            >
              <input
                aria-label="PPT 标注内容"
                value={pptNoteText}
                onChange={(e) => setPptNoteText(e.target.value)}
              />
              <Button disabled={!pptNoteText.trim()}>保存标注</Button>
            </form>
          )}
          <Button onClick={closeRewrite}>取消</Button>
        </div>
      )}
      {suggestion && (
        <div className="rewrite-panel">
          <section
            role="dialog"
            aria-modal="false"
            aria-labelledby="diff-title"
            className="diff-dialog"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !accepting) closeRewrite();
            }}
          >
            <span className="eyebrow">
              AI REWRITE / V{data.version?.versionNumber}
            </span>
            <h2 id="diff-title">让表达更清楚，由你来决定。</h2>
            <label>
              − 原文<del>{suggestion.selection.selectedText}</del>
            </label>
            <label>
              ＋ 建议<ins>{suggestion.replacementText}</ins>
            </label>
            <div aria-label="文字差异" className="inline-diff">
              {suggestion.diff.map((part, i) =>
                part.type === "delete" ? (
                  <del key={i}>−{part.text}</del>
                ) : part.type === "insert" ? (
                  <ins key={i}>＋{part.text}</ins>
                ) : (
                  <span key={i}>{part.text}</span>
                ),
              )}
            </div>
            <p>{suggestion.rationale}</p>
            {rewriteError && (
              <p role="alert">
                {rewriteError}{" "}
                <Button
                  onClick={() => {
                    closeRewrite();
                    void load();
                  }}
                >
                  读取当前版本
                </Button>
              </p>
            )}
            <div className="actions">
              <Button disabled={generating} onClick={closeRewrite}>
                不接受
              </Button>
              <Button
                primary
                disabled={generating}
                onClick={() => void accept()}
              >
                {generating ? "正在保存…" : "接受修改"}
              </Button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
function SlideCanvas({
  slide,
  zoom,
  onSelection,
  onClear,
  selectionLayer,
}: {
  selectionLayer?: ReactNode;
  slide: Slide;
  zoom: number;
  onSelection: (s: TextSelection) => void;
  onClear: () => void;
}) {
  const width = slide.width ?? 12192000;
  const height = slide.height ?? 6858000;
  return (
    <div className="slide-stage" style={{ width: `${zoom}%` }}>
      <div
        className="slide-canvas"
        style={{ aspectRatio: `${width}/${height}` }}
      >
        {slide.elements.map((e) => (
          <div
            key={e.id}
            className={`slide-element ${e.editable ? "editable" : "readonly"}`}
            style={{
              ...elementStyle(slide, e),
              color: `#${/^[\da-fA-F]{6}$/.test(e.color ?? "") ? e.color : "263341"}`,
            }}
            title={e.readOnlyReason}
            aria-label={
              !e.editable
                ? `只读：${e.readOnlyReason ?? "该对象不支持编辑"}`
                : undefined
            }
          >
            {e.text ?? (
              <span className="object-placeholder">
                {e.kind === "image" ? "图片" : "图形 / 图表"}
              </span>
            )}
          </div>
        ))}
        {selectionLayer ?? (
          <SlideTextSelectionLayer
            key={`${slide.id}:${slide.deckVersionId}`}
            slide={slide}
            onSelection={onSelection}
            onClear={onClear}
          />
        )}
      </div>
    </div>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
