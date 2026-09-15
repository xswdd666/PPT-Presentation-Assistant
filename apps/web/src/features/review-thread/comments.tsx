import { stableRequestKey } from "../../client/upload.js";
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
}: {
  comment: ReviewComment;
  data: WorkspaceSnapshot;
  onLocate: (id: string) => void;
  onOpen?: (id: string) => void;
}) {
  const role = roles[c.reviewerId];
  const slide = data.slides.find((s) => s.id === c.relatedSlideIds[0]);
  return (
    <article className="comment">
      <span className={`avatar avatar-${c.reviewerId}`} aria-hidden="true">
        {role?.name[0] ?? "AI"}
      </span>
      <div className="comment-main">
        <div className="comment-author">
          <b>{role?.name ?? c.reviewerId}</b>
          <span>AI 点评人</span>
        </div>
        <small>
          {role?.title ?? c.reviewerId} · 第 {String(slide?.index ?? "—")} 页
        </small>
        <time className="basis" dateTime={c.createdAt}>
          {new Date(c.createdAt).toLocaleString("zh-CN")}
        </time>
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
          <div className="evidence">
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
        )}
        <div className="comment-actions">
          <button
            disabled={!slide}
            onClick={() => {
              if (slide) onLocate(slide.id);
            }}
          >
            ⌖ 定位第 {String(slide?.index ?? "—")} 页
          </button>
          {onOpen && <button onClick={() => onOpen(c.id)}>回复 ↗</button>}
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
      if (focusId.current)
        document
          .getElementById(`comment-${focusId.current}`)
          ?.focus({ preventScroll: true });
    }
  }, [commentId]);
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
  return (
    <>
      <header className="review-heading">
        {commentId ? (
          <button className="back" onClick={back}>
            ← 评论详情
          </button>
        ) : (
          <>
            <span className="eyebrow">REVIEW ROOM</span>
            <h2>听听不同的视角。</h2>
            <p>AI 模拟听众，与你一起打磨这次汇报。</p>
            <small>{comments.length} 条评论</small>
          </>
        )}
      </header>
      <div
        ref={list}
        className="comment-list"
        hidden={!!commentId}
        onScroll={(e) => {
          if (!commentId) scroll.current = e.currentTarget.scrollTop;
        }}
      >
        {loading ? (
          <p role="status" className="comment-empty">
            正在加载评审…
          </p>
        ) : error ? (
          <div className="comment-empty" role="alert">
            <p>{error}</p>
            <button className="button" onClick={() => setAttempt((v) => v + 1)}>
              重试加载
            </button>
          </div>
        ) : comments.length ? (
          comments.map((c) => (
            <Comment
              key={c.id}
              comment={c}
              data={data}
              onLocate={onLocate}
              onOpen={open}
            />
          ))
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
      <footer className="review-footer">
        AI 建议供参考，最终判断由你决定。
      </footer>
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
    if (nearBottom.current && scroll.current)
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
  if (!thread)
    return (
      <p className="comment-empty" role="status">
        正在加载对话…
      </p>
    );
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
            <span className="avatar" aria-hidden="true">
              {r.author === "user" ? "我" : role?.name[0]}
            </span>
            <div>
              <b>{r.author === "user" ? "我" : role?.name}</b>
              <p>{r.body}</p>
              <small>{r.basis}</small>
            </div>
          </article>
        ))}
        {optimistic && (
          <article className="reply user">
            <span className="avatar" aria-hidden="true">
              我
            </span>
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
          placeholder={`回复 ${role?.title ?? thread.comment.reviewerId}…`}
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
