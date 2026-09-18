import { useState } from "react";
import type {
  ScriptDocument,
  Slide,
  TextSelection,
} from "@deck-rehearsal/contracts";
import { PresenterScriptEditor } from "./editor.js";
export function ScriptPage({
  projectId,
  slides,
  documents,
  slide,
  onSelect,
  onSelection,
  onSaved,
  onError,
  initialFull = false,
}: {
  projectId: string;
  slides: Slide[];
  documents: Record<string, ScriptDocument>;
  slide: Slide;
  onSelect: (id: string) => void;
  onSelection: (s: TextSelection) => void;
  onSaved: (d: ScriptDocument) => void;
  onError: (s: string) => void;
  initialFull?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [full, setFull] = useState(initialFull);
  const total = slides.reduce(
    (n, s) => n + (documents[s.id]?.text.length ?? 0),
    0,
  );
  return (
    <div className="content-page script-page">
      <h1>{full ? "整份演讲稿" : "逐页讲稿"}</h1>
      <p>
        {total} 字 · 预计 {Math.ceil(total / 220)} 分钟
      </p>
      <button className="button" onClick={() => setFull(!full)}>
        {full ? "逐页编辑" : "通读整份讲稿"}
      </button>
      <input
        aria-label="搜索讲稿"
        placeholder="搜索页面标题或讲稿"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <nav className="script-index" aria-label="讲稿页面索引">
        {slides
          .filter((s) =>
            (
              (documents[s.id]?.text ?? "") +
              s.elements.map((e) => e.text ?? "").join(" ")
            ).includes(query),
          )
          .map((s) => (
            <button
              key={s.id}
              aria-current={slide.id === s.id ? "page" : undefined}
              onClick={() => {
                onSelect(s.id);
                setFull(false);
              }}
            >
              第 {s.index} 页 · {documents[s.id]?.text.length ?? 0} 字 · 约{" "}
              {Math.ceil(((documents[s.id]?.text.length ?? 0) / 220) * 60)} 秒
              {!documents[s.id]?.text && " · 待补写"}
            </button>
          ))}
      </nav>
      {full ? (
        <div className="full-manuscript">
          {slides
            .filter((s) =>
              (
                (documents[s.id]?.text ?? "") +
                s.elements.map((e) => e.text ?? "").join(" ")
              ).includes(query),
            )
            .map((s) => (
              <article key={s.id}>
                <header>
                  <h2>第 {s.index} 页</h2>
                  <button
                    onClick={() => {
                      onSelect(s.id);
                      setFull(false);
                    }}
                  >
                    编辑本页
                  </button>
                </header>
                <p>{documents[s.id]?.text || "本页讲稿待生成"}</p>
              </article>
            ))}
        </div>
      ) : (
        <PresenterScriptEditor
          key={slide.id}
          projectId={projectId}
          slide={slide}
          document={
            documents[slide.id] ?? {
              slideId: slide.id,
              revision: 0,
              text: "",
              marks: [],
              annotations: [],
              updatedAt: "",
            }
          }
          onSelection={onSelection}
          onSaved={onSaved}
          onError={onError}
        />
      )}
    </div>
  );
}
