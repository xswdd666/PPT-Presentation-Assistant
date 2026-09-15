import type {
  DeckVersion,
  Slide,
  LayoutWarning,
  ChangeOperation,
} from "@deck-rehearsal/contracts";
import { useEffect, useState } from "react";
import type { UploadSnapshot as WorkspaceSnapshot } from "@deck-rehearsal/db";
import { api, Button } from "../slide-rewrite/shared.js";
export function Versions({
  data,
  reload,
  onError,
}: {
  data: WorkspaceSnapshot;
  reload: () => Promise<void>;
  onError: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(data.version?.id ?? "");
  const [base, setBase] = useState(
    data.versions[1]?.id ?? data.version?.id ?? "",
  );
  type Detail = {
    version: DeckVersion;
    slides: Slide[];
    warnings: LayoutWarning[];
    operations: ChangeOperation[];
  };
  const [detail, setDetail] = useState<Detail>();
  const [comparison, setComparison] = useState<Detail>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setComparison(undefined);
    setError("");
    if (selected && base)
      void Promise.all([
        api<Detail>(`/projects/${data.project.id}/version/${selected}`),
        api<Detail>(`/projects/${data.project.id}/version/${base}`),
      ])
        .then(([d, c]) => {
          if (active) {
            setDetail(d);
            setComparison(c);
          }
        })
        .catch((e: unknown) => {
          if (active) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [selected, base, retry]);
  async function download() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/projects/${data.project.id}/download/${detail.version.id}`,
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "导出失败，请重试");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `deck-V${String(detail.version.versionNumber)}.pptx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError(`导出失败：${String(e)}。编辑状态已保留，可重试导出。`);
    } finally {
      setBusy(false);
    }
  }
  async function act(action: string, body: unknown) {
    setBusy(true);
    try {
      await api(`/projects/${data.project.id}/${action}`, body);
      await reload();
      setRetry((n) => n + 1);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="content-page versions">
      <span className="eyebrow">04 / 版本与导出</span>
      <h1>每一步修改，都有来处。</h1>
      <p className="muted">
        原稿与历史版本始终保留。恢复历史会创建一个新版本。
      </p>
      <div className="version-selectors">
        <label>
          查看与导出版本
          <select
            aria-label="查看与导出版本"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {data.versions.map((v) => (
              <option key={v.id} value={v.id}>
                V{v.versionNumber} · {v.changeSummary}
              </option>
            ))}
          </select>
        </label>
        <label>
          比较基准
          <select
            aria-label="比较基准"
            value={base}
            onChange={(e) => setBase(e.target.value)}
          >
            {data.versions.map((v) => (
              <option key={v.id} value={v.id}>
                V{v.versionNumber}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <Button onClick={() => setRetry((n) => n + 1)}>重新加载版本</Button>
        </p>
      )}
      {detail && (
        <section aria-label="选定版本详情">
          <h2>V{detail.version.versionNumber} · 导出前检查</h2>
          <p>
            来源：
            {data.versions.find((v) => v.id === detail.version.parentVersionId)
              ?.versionNumber
              ? `V${String(data.versions.find((v) => v.id === detail.version.parentVersionId)?.versionNumber)}`
              : "原始上传"}
          </p>
          <div className="warnings">
            {detail.warnings.length ? (
              detail.warnings.map((w, i) => (
                <p key={i}>
                  ⚠ 第{" "}
                  {w.pageIndex ??
                    detail.slides.find((s) => s.id === w.slideId)?.index}{" "}
                  页 · {w.message}
                </p>
              ))
            ) : (
              <p>此版本没有已记录的布局警告。</p>
            )}
          </div>
          <Button primary disabled={busy} onClick={() => void download()}>
            {busy
              ? "正在导出…"
              : `导出 V${String(detail.version.versionNumber)} PPTX ↓`}
          </Button>
          <h3>与 V{comparison?.version.versionNumber} 比较</h3>
          {comparison &&
            detail.slides.map((slide) => {
              const old = comparison.slides.find((s) => s.id === slide.id);
              const text = (s: Slide | undefined) =>
                s?.elements.map((e) => e.text ?? "").join("\n") ?? "";
              if (
                old &&
                old.index === slide.index &&
                old.hidden === slide.hidden &&
                text(old) === text(slide)
              )
                return null;
              return (
                <article className="version-comparison" key={slide.id}>
                  <h4>第 {slide.index} 页</h4>
                  <p>
                    页序 {old?.index ?? "新增"} → {slide.index} ·{" "}
                    {slide.hidden ? "已隐藏" : "显示"}
                  </p>
                  <del>− {text(old)}</del>
                  <ins>＋ {text(slide)}</ins>
                </article>
              );
            })}
          {comparison &&
            detail.slides.every((s) => {
              const old = comparison.slides.find((o) => o.id === s.id);
              return (
                old?.index === s.index &&
                old.hidden === s.hidden &&
                JSON.stringify(old.elements) === JSON.stringify(s.elements)
              );
            }) && <p>页面内容、顺序与显示状态一致。</p>}
          <p>
            变更记录：
            {detail.operations
              .map((o) =>
                o.type === "replace_text"
                  ? `文字改写（第 ${String(detail.slides.find((s) => s.id === o.selection.slideId)?.index)} 页）`
                  : o.type === "reorder_slides"
                    ? "页面排序"
                    : o.type === "set_slide_hidden"
                      ? `${o.hidden ? "隐藏" : "恢复"}页面`
                      : "更新备注",
              )
              .join("、") || detail.version.changeSummary}
          </p>
        </section>
      )}
      <div className="version-list">
        {data.versions.map((v) => (
          <article key={v.id}>
            <div className="version-dot" />
            <div>
              <h3>
                V{v.versionNumber}{" "}
                {v.id === data.version?.id && <small>当前版本</small>}
              </h3>
              <p>{v.changeSummary}</p>
              <small>{new Date(v.createdAt).toLocaleString("zh-CN")}</small>
              <div className="actions">
                {v.id !== data.version?.id && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void act("restore", {
                        versionId: v.id,
                        currentVersionId: data.version?.id,
                      })
                    }
                  >
                    恢复为新版本
                  </Button>
                )}
                <Button onClick={() => setSelected(v.id)}>
                  查看与导出 V{v.versionNumber}
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {data.slides.length > 0 && (
        <>
          <h2>页面结构</h2>
          <p className="muted">调整顺序或隐藏页面时会立即创建派生版本。</p>
          <div className="structure-list">
            {data.slides.map((s, index) => (
              <div key={s.id}>
                <span>
                  {s.index}.{" "}
                  {s.elements.find((e) => e.text)?.text?.slice(0, 40) ??
                    "未命名页面"}
                </span>
                <Button
                  disabled={busy || index === 0}
                  onClick={() => {
                    const ids = data.slides.map((s) => s.id);
                    const previous = ids[index - 1];
                    if (previous) {
                      ids[index - 1] = s.id;
                      ids[index] = previous;
                      void act("changes", {
                        versionId: data.version?.id,
                        operations: [{ type: "reorder_slides", slideIds: ids }],
                      });
                    }
                  }}
                >
                  上移
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act("changes", {
                      versionId: data.version?.id,
                      operations: [
                        {
                          type: "set_slide_hidden",
                          slideId: s.id,
                          hidden: !s.hidden,
                        },
                      ],
                    })
                  }
                >
                  {s.hidden ? "恢复显示" : "隐藏"}
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
