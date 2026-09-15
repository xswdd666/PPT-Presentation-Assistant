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
}: {
  projectId: string;
  slides: Slide[];
  documents: Record<string, ScriptDocument>;
  slide: Slide;
  onSelect: (id: string) => void;
  onSelection: (s: TextSelection) => void;
  onSaved: (d: ScriptDocument) => void;
  onError: (s: string) => void;
}) {
  const [query, setQuery] = useState("");
  const total = Object.values(documents).reduce((n, d) => n + d.text.length, 0);
  return (
    <div className="content-page script-page">
      <h1>逐页讲稿</h1>
      <p>
        {total} 字 · 预计 {Math.ceil(total / 220)} 分钟
      </p>
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
              onClick={() => onSelect(s.id)}
            >
              第 {s.index} 页 · {documents[s.id]?.text.length ?? 0} 字 · 约{" "}
              {Math.ceil(((documents[s.id]?.text.length ?? 0) / 220) * 60)} 秒
              {!documents[s.id]?.text && " · 待补写"}
            </button>
          ))}
      </nav>
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
    </div>
  );
}
