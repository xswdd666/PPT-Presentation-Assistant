import { stableRequestKey } from "../../client/upload.js";
import { ChatCircleIcon as ChatCircle } from "@phosphor-icons/react/ChatCircle";
import { LinkIcon as Link } from "@phosphor-icons/react/Link";
import { ArrowLeftIcon as ArrowLeft } from "@phosphor-icons/react/ArrowLeft";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  AsyncReviewGateway,
  ReviewComment,
  ReviewGateway,
  ReviewThread,
  WorkspaceSnapshot,
} from "@deck-rehearsal/contracts";
import { reviewGateway, ReviewRequestError } from "./gateway.js";
const roles: Record<string, { name: string; title: string }> = {
  jack: { name: "Jack", title: "挑剔领导" },
  olivia: { name: "Olivia", title: "谨慎的证据审阅者" },
  ryan: { name: "Ryan", title: "商业化策略顾问" },
  mia: { name: "Mia", title: "产品体验设计师" },
  emma: { name: "Emma", title: "品牌与公关守门人" },
  leo: { name: "Leo", title: "交付与工程负责人" },
  sophie: { name: "Sophie", title: "目标听众代表" },
};
function CommentLoading({ label = "正在加载评审…" }: { label?: string }) {
  return (
    <div
      className="comment-skeletons"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="comment-loading-label">
        <span className="comment-loading-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {label}
      </p>
      {[0, 1, 2].map((index) => (
        <div className="comment-skeleton" key={index} aria-hidden="true">
          <div className="skeleton-author">
            <div className="skeleton-avatar" />
            <div className="skeleton-identity">
              <span className="skeleton-bar skeleton-name" />
              <span className="skeleton-bar skeleton-role" />
            </div>
          </div>
          <span className="skeleton-bar" />
          <span className="skeleton-bar" />
          <span className="skeleton-bar skeleton-short" />
          <span className="skeleton-bar skeleton-actions" />
        </div>
      ))}
    </div>
  );
}
function Avatar({ id }: { id: string }) {
  const female = ["olivia", "mia", "emma", "sophie"].includes(id);
  return (
    <img
      className={`avatar avatar-${id}`}
      src={`/assets/avatars/${female ? "olivia" : "ryan"}.png`}
      alt=""
    />
  );
}
function isConflict(error: unknown) {
  return (
    (error instanceof ReviewRequestError && error.status === 409) ||
    (typeof error === "object" &&
      error !== null &&
      "failure" in error &&
      typeof error.failure === "object" &&
      error.failure !== null &&
      "code" in error.failure &&
      error.failure.code === "version_conflict")
  );
}
function message(error: unknown) {
  if (isConflict(error))
    return "版本已变化。请刷新当前版本后重新回复，输入内容已保留。";
  if (error instanceof ReviewRequestError) {
    if (error.status === 403)
      return "没有权限查看这条评审，请检查项目访问权限。";
    if (error.status === 404 || error.status === 410)
      return "评论已失效或不存在，请返回评论列表。";
    if (error.status === 409)
      return "版本已变化。请刷新当前版本后重新回复，输入内容已保留。";
  }
  return error instanceof Error ? error.message : "加载失败，请重试。";
}
function Comment({
  comment: c,
  data,
  onLocate,
  onOpen,
  more,
}: {
  comment: ReviewComment;
  data: WorkspaceSnapshot;
  onLocate: (id: string) => void;
  onOpen?: (id: string) => void;
  more?:
    | { count: number; expanded: boolean; toggle: () => void; id: string }
    | undefined;
}) {
  const role = roles[c.reviewerId];
  const slide = data.slides.find((s) => s.id === c.relatedSlideIds[0]);
  return (
    <article className="comment">
      <Avatar id={c.reviewerId} />
      <div className="comment-main">
        <div className="comment-author">
          <b>{role?.name ?? c.reviewerId}</b>
          <span className="page-badge">
            第 {String(slide?.index ?? "—")} 页
          </span>
          <time dateTime={c.createdAt}>
            {new Date(c.createdAt).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
        <small>{role?.title ?? c.reviewerId}</small>
        {onOpen ? (
          <button
            id={`comment-${c.id}`}
            className="comment-body"
            onClick={() => onOpen(c.id)}
          >
            {c.body}
          </button>
        ) : (
          <p className="comment-body">{c.body}</p>
        )}
        {!onOpen && (
          <details className="evidence">
            <summary>查看评审依据</summary>
            <div>
              <p>
                <b>依据</b>
                {c.evidence}
              </p>
              <p>
                <b>影响</b>
                {c.impact}
              </p>
              <p>
                <b>建议</b>
                {c.suggestedAction}
              </p>
            </div>
          </details>
        )}
        <div className="comment-actions">
          <button
            onClick={() =>
              onOpen
                ? onOpen(c.id)
                : document.getElementById("review-reply")?.focus()
            }
          >
            <ChatCircle size={18} />
            回复
          </button>
          <button
            aria-label={`⌖ 定位第 ${String(slide?.index ?? "—")} 页`}
            disabled={!slide}
            onClick={() => {
              if (slide) onLocate(slide.id);
            }}
          >
            <Link size={18} />
            定位页面
          </button>
          {more && (
            <button
              className="more-comments-button"
              aria-expanded={more.expanded}
              aria-controls={more.id}
              onClick={more.toggle}
            >
              {more.expanded ? "收起评论" : "更多评论"}（{more.count}）
            </button>
          )}
        </div>
        <span className="basis">
          基于 V
          {String(
            data.versions.find((v) => v.id === c.deckVersionId)
              ?.versionNumber ?? "—",
          )}
        </span>
      </div>
    </article>
  );
}
export function Comments({
  data,
  url,
  onLocate,
  navigate,
  gateway = reviewGateway,
}: {
  data: WorkspaceSnapshot;
  url: URL;
  onLocate: (id: string) => void;
  navigate: (url: string) => void;
  gateway?: ReviewGateway | AsyncReviewGateway;
}) {
  const commentId = url.searchParams.get("comment");
  const [comments, setComments] = useState(data.comments);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const scroll = useRef(0);
  const focusId = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void gateway
      .listComments(data.project.id)
      .then((items) => {
        if (active) setComments(items);
      })
      .catch((e: unknown) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [gateway, data.project.id, data.comments, attempt]);
  useLayoutEffect(() => {
    if (commentId)
      document
        .querySelector<HTMLButtonElement>(".review-heading .back")
        ?.focus({ preventScroll: true });
    if (!commentId && list.current) {
      list.current.scrollTop = scroll.current;
      if (focusId.current) {
        const target = document.getElementById(`comment-${focusId.current}`);
        if (target) {
          target.focus({ preventScroll: true });
        }
      }
    }
  }, [commentId, comments, loading]);
  function open(id: string) {
    scroll.current = list.current?.scrollTop ?? 0;
    focusId.current = id;
    const next = new URL(url);
    next.searchParams.set("comment", id);
    if (!next.searchParams.has("slide") && data.slides[0])
      next.searchParams.set("slide", data.slides[0].id);
    navigate(next.pathname + next.search);
  }
  function back() {
    const next = new URL(url);
    if (!next.searchParams.has("slide")) {
      const id = comments.find((c) => c.id === commentId)?.relatedSlideIds[0];
      if (id) next.searchParams.set("slide", id);
    }
    next.searchParams.delete("comment");
    navigate(next.pathname + next.search);
  }
  const reviewerGroups = Array.from(
    comments.reduce((groups, comment) => {
      const group = groups.get(comment.reviewerId) ?? [];
      group.push(comment);
      groups.set(comment.reviewerId, group);
      return groups;
    }, new Map<string, ReviewComment[]>()),
  );
  return (
    <>
      <header className="review-heading">
        {commentId ? (
          <button className="back" aria-label="← 评论详情" onClick={back}>
            <ArrowLeft size={20} /> 评论详情
          </button>
        ) : (
          <>
            <h2>评审意见</h2>
            <small>{comments.length} 条评论</small>
          </>
        )}
      </header>
      <div ref={list} className="comment-list" hidden={!!commentId}>
        {loading && !comments.length ? (
          <CommentLoading />
        ) : error ? (
          <div className="comment-empty" role="alert">
            <p>{error}</p>
            <button className="button" onClick={() => setAttempt((v) => v + 1)}>
              重试加载
            </button>
          </div>
        ) : !comments.length &&
          data.job &&
          [
            "queued",
            "analyzing",
            "parsing",
            "rendering",
            "visual_understanding",
            "global_analysis",
            "routing",
            "comment_generation",
          ].includes(data.job.stage) ? (
          <CommentLoading label="评审人正在阅读文稿，生成评论…" />
        ) : comments.length ? (
          <>
            {reviewerGroups.map(([reviewerId, reviewerComments]) => {
              return (
                <section className="reviewer-comment-group" key={reviewerId}>
                  {reviewerComments.slice(0, 1).map((comment) => (
                    <Comment
                      key={comment.id}
                      comment={comment}
                      data={data}
                      onLocate={onLocate}
                      onOpen={open}
                      more={
                        reviewerComments.length > 1
                          ? {
                              count: reviewerComments.length - 1,
                              expanded: Boolean(expanded[reviewerId]),
                              id: `more-${reviewerId}`,
                              toggle: () =>
                                setExpanded((prev) => ({
                                  ...prev,
                                  [reviewerId]: !prev[reviewerId],
                                })),
                            }
                          : undefined
                      }
                    />
                  ))}
                  {reviewerComments.length > 1 && (
                    <div
                      className="reviewer-more"
                      id={`more-${reviewerId}`}
                      data-expanded={Boolean(expanded[reviewerId])}
                      aria-hidden={!expanded[reviewerId]}
                      inert={!expanded[reviewerId]}
                    >
                      <div className="reviewer-more-clip">
                        <div className="reviewer-comments">
                          {reviewerComments.slice(1).map((comment) => (
                            <Comment
                              key={comment.id}
                              comment={comment}
                              data={data}
                              onLocate={onLocate}
                              onOpen={open}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </>
        ) : (
          <div className="comment-empty">
            <h3>还没有评论</h3>
            <p>
              {data.job?.stage === "failed"
                ? "分析未完成，请前往上传页查看原因并重试。"
                : "分析完成后，评审人的页面评论会出现在这里。"}
            </p>
          </div>
        )}
      </div>
      {commentId && (
        <ThreadDetail
          key={commentId}
          commentId={commentId}
          data={data}
          gateway={gateway}
          onLocate={onLocate}
        />
      )}
    </>
  );
}
function ThreadDetail({
  commentId,
  data,
  gateway,
  onLocate,
}: {
  commentId: string;
  data: WorkspaceSnapshot;
  gateway: ReviewGateway | AsyncReviewGateway;
  onLocate: (id: string) => void;
}) {
  const [thread, setThread] = useState<ReviewThread>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const storageKey = `review-draft:${data.project.id}:${commentId}`;
  const [body, setBody] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState("");
  const [sendError, setSendError] = useState("");
  const [conflict, setConflict] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const generationKey =
    "review-generation:" + data.project.id + ":" + commentId;
  const [generationId, setGenerationId] = useState(() => {
    try {
      return sessionStorage.getItem(generationKey) ?? "";
    } catch {
      return "";
    }
  });
  const nearBottom = useRef(true);
  const threadOpened = useRef(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const replyKey = useRef(crypto.randomUUID());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, body);
    } catch {
      /* Draft remains in memory. */
    }
  }, [body, storageKey]);
  useEffect(() => {
    let active = true;
    setError("");
    const request =
      "getReplyResult" in gateway && generationId
        ? gateway
            .getReplyResult(data.project.id, generationId)
            .then((r) => r.thread)
        : gateway.getThread(data.project.id, commentId);
    void request
      .then((t) => {
        if (active) {
          setThread(t);
          if ("generationId" in t && typeof t.generationId === "string")
            setGenerationId(t.generationId);
        }
      })
      .catch((e: unknown) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [commentId, data.project.id, gateway, attempt, generationId]);
  useEffect(() => {
    if (
      !thread ||
      busy ||
      !["queued", "generating"].includes(thread.generation)
    )
      return;
    let active = true;
    const timer = setTimeout(() => {
      const request =
        "getReplyResult" in gateway && generationId
          ? gateway
              .getReplyResult(data.project.id, generationId)
              .then((r) => r.thread)
          : gateway.getThread(data.project.id, commentId);
      void request
        .then((t) => {
          if (active) setThread(t);
        })
        .catch((e: unknown) => {
          if (active) setSendError(message(e));
        });
    }, 1200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    thread,
    busy,
    attempt,
    gateway,
    data.project.id,
    commentId,
    generationId,
  ]);
  useLayoutEffect(() => {
    if (!thread || !scroll.current) return;
    if (!threadOpened.current) {
      threadOpened.current = true;
      scroll.current.scrollTop = 0;
      return;
    }
    if (nearBottom.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [thread, optimistic, busy, sendError]);
  async function send() {
    if (!body.trim() || !data.version || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setSendError("");
    setConflict(false);
    setOptimistic(body.trim());
    try {
      const input = {
        projectId: data.project.id,
        commentId,
        body: body.trim(),
        deckVersionId: data.version.id,
        idempotencyKey: stableRequestKey(
          `review-request:${data.project.id}:${commentId}`,
          JSON.stringify([body.trim(), data.version.id]),
        ),
      };
      let result: ReviewThread;
      if ("submitReply" in gateway) {
        const generation = await gateway.submitReply(input);
        try {
          sessionStorage.setItem(generationKey, generation.id);
        } catch {
          /* Remains available for this session. */
        }
        if (alive.current) setGenerationId(generation.id);
        result = (await gateway.getReplyResult(data.project.id, generation.id))
          .thread;
      } else result = await gateway.reply(input);
      if (!alive.current) return;
      sessionStorage.removeItem(
        `review-request:${data.project.id}:${commentId}`,
      );
      setThread(result);
      setOptimistic("");
      setBody("");
      replyKey.current = crypto.randomUUID();
    } catch (e) {
      if (!alive.current) return;
      setSendError(message(e));
      setConflict(isConflict(e));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function retryGeneration() {
    if (!("retryReply" in gateway) || !generationId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setSendError("");
    try {
      await gateway.retryReply(data.project.id, generationId);
      const result = await gateway.getReplyResult(
        data.project.id,
        generationId,
      );
      if (alive.current) setThread(result.thread);
    } catch (e) {
      if (alive.current) {
        setSendError(message(e));
        setConflict(isConflict(e));
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (error)
    return (
      <div className="comment-empty" role="alert">
        <p>{error}</p>
        <button className="button" onClick={() => setAttempt((v) => v + 1)}>
          重试加载
        </button>
      </div>
    );
  if (!thread) return <CommentLoading label="正在加载对话…" />;
  const role = roles[thread.comment.reviewerId];
  const generating =
    busy || ["queued", "generating"].includes(thread.generation);
  return (
    <div className="thread-view">
      <div
        className="thread-scroll"
        ref={scroll}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 72;
        }}
      >
        <Comment comment={thread.comment} data={data} onLocate={onLocate} />
        {thread.replies.map((r) => (
          <article className={`reply ${r.author}`} key={r.id}>
            <Avatar
              id={r.author === "user" ? "user" : thread.comment.reviewerId}
            />
            <div>
              <div className="comment-author">
                <b>{r.author === "user" ? "我" : role?.name}</b>
              </div>
              <span className="reply-role">
                {r.author === "user" ? "汇报人" : role?.title}
              </span>
              <p>{r.body}</p>
              <small>{r.basis}</small>
              <div className="comment-actions">
                <button
                  onClick={() =>
                    document.getElementById("review-reply")?.focus()
                  }
                >
                  <ChatCircle size={18} />
                  回复
                </button>
                <button
                  onClick={() => {
                    const id = thread.comment.relatedSlideIds[0];
                    if (id) onLocate(id);
                  }}
                >
                  <Link size={18} />
                  定位页面
                </button>
              </div>
            </div>
          </article>
        ))}
        {optimistic && (
          <article className="reply user">
            <Avatar id="user" />
            <div>
              <b>我</b>
              <p>{optimistic}</p>
              <small>{busy ? "发送中" : "发送未确认"}</small>
            </div>
          </article>
        )}
        {generating && (
          <p className="thread-state" role="status">
            {thread.generation === "queued" && !busy
              ? "AI 回复排队中…"
              : "AI 点评人正在生成回复…"}
          </p>
        )}
        {(sendError || thread.generation === "failed") && (
          <div className="thread-state" role="alert">
            <p>{sendError || thread.error || "AI 回复生成失败"}</p>
            {conflict ? (
              <button className="button" onClick={() => location.reload()}>
                刷新当前版本
              </button>
            ) : (
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  if (
                    "retryReply" in gateway &&
                    generationId &&
                    thread.generation === "failed"
                  )
                    void retryGeneration();
                  else if (body.trim()) void send();
                  else setAttempt((v) => v + 1);
                }}
              >
                {"retryReply" in gateway &&
                generationId &&
                thread.generation === "failed"
                  ? "重试 AI 回复"
                  : body.trim()
                    ? "重试回复"
                    : "重新读取回复状态"}
              </button>
            )}
          </div>
        )}
      </div>
      <form
        className="reply-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="review-reply">
          回复 {role?.title ?? thread.comment.reviewerId}
        </label>
        <textarea
          id="review-reply"
          value={body}
          placeholder={`回复 ${role?.name ?? thread.comment.reviewerId}…`}
          maxLength={4000}
          disabled={busy}
          onChange={(e) => {
            setBody(e.target.value);
            setOptimistic("");
            setSendError("");
            replyKey.current = crypto.randomUUID();
          }}
        />
        <div className="reply-buttons">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              setBody("");
              setOptimistic("");
              setSendError("");
              replyKey.current = crypto.randomUUID();
            }}
          >
            取消
          </button>
          <button
            className="button primary"
            disabled={!body.trim() || generating || conflict}
          >
            发送回复 ↑
          </button>
        </div>
      </form>
    </div>
  );
}
