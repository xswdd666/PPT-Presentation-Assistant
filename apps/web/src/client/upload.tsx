import { useEffect, useRef, useState } from "react";
import { UploadPlayground } from "./upload-playground.js";
import type { UploadSnapshot, UploadState } from "@deck-rehearsal/db";

export const uploadLabels: Record<UploadState["stage"], string> = {
  waiting_upload: "等待上传",
  uploading: "上传中",
  parsing: "解析中",
  ready: "文件已就绪，等待开始分析",
  queued: "等待后台处理",
  rendering: "渲染中",
  analyzing: "AI 分析中",
  generating_review: "生成评审",
  completed: "评审已准备好",
  failed: "处理未完成",
  cancelled: "已取消分析",
};
export function stableRequestKey(scope: string, fingerprint: string) {
  const stored = sessionStorage.getItem(scope);
  if (stored) {
    try {
      const value = JSON.parse(stored) as { fingerprint: string; key: string };
      if (value.fingerprint === fingerprint) return value.key;
    } catch {
      /* Replace invalid local data. */
    }
  }
  const key = crypto.randomUUID();
  sessionStorage.setItem(scope, JSON.stringify({ fingerprint, key }));
  return key;
}
async function request<T>(
  path: string,
  body: unknown,
  method = "POST",
  key: string = crypto.randomUUID(),
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error((data as { error: string }).error);
  return data as T;
}
export function Upload({
  data,
  reload,
  onError,
  onReview,
}: {
  data: UploadSnapshot;
  reload: () => Promise<void>;
  onError: (s: string) => void;
  onReview: () => void;
}) {
  const state = data.uploadState;
  const scope = "/projects/" + data.project.id;
  const draftKey = "target-draft:" + data.project.id;
  const [values, setValues] = useState(() => {
    try {
      const draft = sessionStorage.getItem(draftKey);
      if (draft) return JSON.parse(draft) as { goal: string; response: string };
    } catch {
      /* Use server state. */
    }
    return {
      goal: state.goal.confirmed ?? state.goal.suggestion ?? "",
      response: state.response.confirmed ?? state.response.suggestion ?? "",
    };
  });
  const [dirty, setDirty] = useState(() =>
    Boolean(sessionStorage.getItem(draftKey)),
  );
  const [saved, setSaved] = useState("");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const revision = useRef(state.revision);
  const pending = useRef<Promise<void> | undefined>(undefined);
  const xhrRef = useRef<XMLHttpRequest | undefined>(undefined);
  const attempted = useRef(false);
  const running =
    state.analysisRequested &&
    !["completed", "failed", "cancelled"].includes(state.stage);
  const textRef = useRef(values);
  textRef.current = values;
  useEffect(() => {
    if (!dirty && !pending.current) {
      revision.current = state.revision;
      setValues({
        goal: state.goal.confirmed ?? state.goal.suggestion ?? "",
        response: state.response.confirmed ?? state.response.suggestion ?? "",
      });
    }
  }, [state.revision, dirty]);
  useEffect(() => {
    if (state.stage === "completed" && attempted.current) {
      attempted.current = false;
      onReview();
    }
  }, [state.stage, onReview]);
  useEffect(() => {
    // A recovered active run should also navigate when its persisted result completes.
    if (running) attempted.current = true;
  }, [running]);
  function edit(field: "goal" | "response", value: string) {
    const next = { ...textRef.current, [field]: value };
    textRef.current = next;
    setValues(next);
    setDirty(true);
    setSaved("尚未保存");
    sessionStorage.setItem(draftKey, JSON.stringify(next));
  }
  async function save(acceptSuggestions = false): Promise<void> {
    if (pending.current) {
      await pending.current;
      return save(acceptSuggestions);
    }
    const submitted = textRef.current;
    setSaving(true);
    const task = (async () => {
      const updated = await request<UploadState>(
        scope + "/targets",
        { ...submitted, revision: revision.current, acceptSuggestions },
        "PUT",
      );
      revision.current = updated.revision;
      if (JSON.stringify(textRef.current) === JSON.stringify(submitted)) {
        setDirty(false);
        sessionStorage.removeItem(draftKey);
        setSaved("目标已保存");
      }
      await reload();
    })();
    pending.current = task;
    try {
      await task;
    } finally {
      pending.current = undefined;
      setSaving(false);
    }
  }
  useEffect(() => {
    if (!dirty || running) return;
    const timer = setTimeout(() => {
      void save().catch((e: unknown) => {
        setSaved("保存失败，本页草稿已保留；请重试保存");
        onError(String(e));
      });
    }, 650);
    return () => clearTimeout(timer);
  }, [values, dirty, running]);
  function choose(next?: File) {
    if (busy) return;
    setFile(next);
    setProgress(0);
    setLocalError("");
    if (
      next &&
      (!next.name.toLowerCase().endsWith(".pptx") ||
        !next.size ||
        next.size > 50 * 1024 * 1024)
    ) {
      setFile(undefined);
      setLocalError("请选择 1 字节至 50 MB 的 PPTX 文件。");
    }
  }
  async function upload() {
    if (!file) return;
    setBusy(true);
    setLocalError("");
    const key = stableRequestKey(
      "upload:" + data.project.id,
      file.name + ":" + String(file.size) + ":" + String(file.lastModified),
    );
    try {
      await request(scope + "/upload-session", {}, "POST", key);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open(
          "POST",
          "/api" + scope + "/upload?name=" + encodeURIComponent(file.name),
        );
        xhr.setRequestHeader(
          "content-type",
          file.type || "application/octet-stream",
        );
        xhr.setRequestHeader("idempotency-key", key);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            try {
              reject(
                new Error(
                  (JSON.parse(xhr.responseText) as { error: string }).error,
                ),
              );
            } catch {
              reject(new Error("上传失败，请重试"));
            }
          }
        };
        xhr.onerror = () => reject(new Error("网络中断，可选择同一文件重试"));
        xhr.onabort = () => reject(new Error("上传已取消，可重新选择文件"));
        xhr.send(file);
      });
      await reload();
    } catch (e) {
      setLocalError(String(e));
      await reload();
    } finally {
      setBusy(false);
      xhrRef.current = undefined;
    }
  }
  async function analyze(retry = false) {
    setBusy(true);
    try {
      if (dirty || pending.current) await save();
      const input = retry ? { jobId: data.job?.id } : textRef.current;
      const key = stableRequestKey(
        "analysis:" + data.project.id,
        JSON.stringify({
          input,
          retry,
          attempt: state.attempt,
          revision: revision.current,
        }),
      );
      await request(
        scope + (retry ? "/retry" : "/analyze"),
        input,
        "POST",
        key,
      );
      attempted.current = true;
      await reload();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="content-page upload">
      <span className="eyebrow">01 / 上传与汇报背景</span>
      <h1>{data.project.name}</h1>
      <p className="muted">
        {data.project.audience} · {data.project.durationMinutes} 分钟
      </p>
      {!data.version ? (
        <>
          <label
            className="drop-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              choose(e.dataTransfer.files[0]);
            }}
          >
            <span className="empty-icon">↥</span>
            <strong>{file?.name ?? "拖入 PPTX，开始这次预演"}</strong>
            <span>1–60 页 · 最大 50 MB · 保留不可变原稿</span>
            <input
              aria-label="选择 PPTX 文件"
              type="file"
              accept=".pptx"
              disabled={busy}
              onChange={(e) => choose(e.target.files?.[0])}
            />
          </label>
          <button
            className="button primary"
            disabled={!file || busy}
            onClick={() => void upload()}
          >
            上传文稿
          </button>
          {busy && (
            <div role="status">
              <UploadPlayground
                {...(progress < 100 ? { progress } : {})}
                label={progress < 100 ? "正在上传文稿" : "正在解析 PPT"}
              />
              <p>
                {progress < 100
                  ? "上传 " + String(progress) + "%"
                  : "传输完成，正在校验与解析文件…"}
              </p>
              <button
                className="button"
                onClick={() => xhrRef.current?.abort()}
              >
                取消上传
              </button>
            </div>
          )}
          {!busy && ["uploading", "parsing"].includes(state.stage) && (
            <p role="status">
              上次传输仍在处理或已中断。可选择同一文件重试，已完成上传不会重复创建任务。
            </p>
          )}
        </>
      ) : (
        <div className="file-ready">
          ✓ 已解析 {data.slides.length} 页，原始文件已保存。
          <span>V{data.version.versionNumber}</span>
        </div>
      )}
      {localError && <p role="alert">{localError}</p>}
      {running && (
        <UploadPlayground
          label={`当前阶段：${uploadLabels[state.stage]}`}
          processed={data.job?.processedSlides ?? 0}
          total={data.job?.totalSlides ?? data.slides.length}
        />
      )}
      <div className="goal-form">
        {(["goal", "response"] as const).map((field) => (
          <label key={field}>
            {field === "goal" ? "汇报目标" : "期望听众回应"}{" "}
            <span>
              {state[field].confirmed
                ? "用户确认"
                : state[field].suggestion
                  ? "AI 建议 · 可修改"
                  : running
                    ? "AI 建议生成中…"
                    : "可选 · 留空由 AI 建议"}
            </span>
            <textarea
              maxLength={5000}
              value={values[field]}
              disabled={running}
              onChange={(e) => edit(field, e.target.value)}
            />
            {state[field].suggestion && state[field].confirmed && (
              <small>AI 原建议：{state[field].suggestion}</small>
            )}
          </label>
        ))}
      </div>
      <div className="actions">
        <button
          className="button"
          disabled={saving || running}
          onClick={() => void save().catch((e: unknown) => onError(String(e)))}
        >
          保存目标
        </button>
        {(state.goal.suggestion || state.response.suggestion) && (
          <button
            className="button"
            disabled={saving || running}
            onClick={() =>
              void save(true).catch((e: unknown) => onError(String(e)))
            }
          >
            接受 AI 建议
          </button>
        )}
        <span role="status">{saving ? "正在保存目标…" : saved}</span>
      </div>
      <div
        className={"job-state " + (state.stage === "failed" ? "failed" : "")}
        role="status"
        aria-live="polite"
      >
        <strong>{uploadLabels[state.stage]}</strong>
        {running && (
          <>
            <progress aria-label="分析正在处理" />
            <p>
              {state.stage === "rendering"
                ? String(data.job?.processedSlides ?? 0) +
                  " / " +
                  String(data.slides.length) +
                  " 页已渲染"
                : "共 " +
                  String(data.slides.length) +
                  " 页；完成前不会显示为成功。可离开此页后返回。"}
            </p>
          </>
        )}
        {state.error && (
          <p>
            {state.error.message}（{state.error.code}）
          </p>
        )}
      </div>
      <div className="actions">
        {running ? (
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              void request(scope + "/cancel", {})
                .then(reload)
                .catch((e: unknown) => onError(String(e)));
            }}
          >
            取消分析
          </button>
        ) : data.job &&
          (state.stage === "cancelled" || state.error?.retryable) ? (
          <button
            className="button primary"
            disabled={busy || saving}
            onClick={() => void analyze(true)}
          >
            重试分析
          </button>
        ) : (
          <button
            className="button primary"
            disabled={!data.version || busy || saving}
            onClick={() => void analyze()}
          >
            {state.stage === "completed" ? "重新分析" : "开始 AI 分析"}
          </button>
        )}
        {state.stage === "completed" && (
          <button className="button" onClick={onReview}>
            进入评审 →
          </button>
        )}
      </div>
      <p className="privacy">
        开始分析将把文稿文字、备注和汇报背景发送至配置的模型服务。当前默认流程为文本分析，未接入完整页面渲染与视觉分析。
      </p>
    </div>
  );
}
