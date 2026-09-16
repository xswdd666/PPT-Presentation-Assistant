import { RichText } from "./rich-text.js";
import { ArticleIcon as Article } from "@phosphor-icons/react/Article";
import { SparkleIcon as Sparkle } from "@phosphor-icons/react/Sparkle";
import { TextBIcon as TextB } from "@phosphor-icons/react/TextB";
import { TextUnderlineIcon as TextUnderline } from "@phosphor-icons/react/TextUnderline";
import { TextAUnderlineIcon as TextAUnderline } from "@phosphor-icons/react/TextAUnderline";
import { HighlighterIcon as Highlighter } from "@phosphor-icons/react/Highlighter";
import { useEffect, useRef, useState } from "react";
import type {
  ScriptDocument,
  ScriptMark,
  Slide,
  TextSelection,
} from "@deck-rehearsal/contracts";
import { editDocument } from "../../client/script-document.js";
import { api, Button } from "../slide-rewrite/shared.js";
export function PresenterScriptEditor({
  document: initial,
  projectId,
  slide,
  onError,
  onSelection,
  onSaved,
}: {
  document: ScriptDocument;
  projectId: string;
  slide: Slide;
  onError: (s: string) => void;
  onSelection: (s: TextSelection) => void;
  onSaved?: (doc: ScriptDocument) => void;
}) {
  const storageKey = `script-draft:${projectId}:${slide.id}`;
  const [doc, setDoc] = useState<ScriptDocument>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved
        ? {
            ...initial,
            ...(JSON.parse(saved) as ScriptDocument),
            revision: (JSON.parse(saved) as ScriptDocument).revision,
          }
        : initial;
    } catch {
      return initial;
    }
  });
  const [status, setStatus] = useState("已保存");
  const [conflict, setConflict] = useState(false);
  const blocked = useRef(false);
  const selection = useRef<{ start: number; end: number } | undefined>(
    undefined,
  );
  const revision = useRef(doc.revision);
  const chain = useRef(Promise.resolve());
  const latest = useRef(doc);
  latest.current = doc;
  const saved = useRef(JSON.stringify(initial));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [annotation, setAnnotation] = useState("");
  function persist() {
    if (blocked.current) return chain.current;
    const snapshot = latest.current;
    if (JSON.stringify(snapshot) === saved.current) return chain.current;
    chain.current = chain.current.then(async () => {
      if (blocked.current || JSON.stringify(snapshot) === saved.current) return;
      setStatus("保存中…");
      try {
        const result = await api<ScriptDocument>(
          `/projects/${projectId}/script`,
          { ...snapshot, revision: revision.current },
          "PUT",
        );
        revision.current = result.revision;
        onSaved?.(result);
        saved.current = JSON.stringify(snapshot);
        if (latest.current === snapshot) localStorage.removeItem(storageKey);
        else
          localStorage.setItem(
            storageKey,
            JSON.stringify({ ...latest.current, revision: result.revision }),
          );
        setStatus("已保存");
      } catch (e) {
        if (String(e).includes("更新")) {
          blocked.current = true;
          setConflict(true);
        }
        setStatus("保存失败 · 草稿保留在本机");
        onError(String(e));
      }
    });
    return chain.current;
  }
  useEffect(() => {
    if (JSON.stringify(doc) === saved.current) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ ...doc, revision: revision.current }),
      );
    } catch {
      onError("本机草稿无法保存，请及时手动保存");
    }
    timer.current = setTimeout(() => void persist(), 700);
    return () => {
      clearTimeout(timer.current);
    };
  }, [doc]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      void persist();
    },
    [],
  );
  function range() {
    return selection.current;
  }
  useEffect(() => {
    const retry = () => {
      void persist();
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  function mark(kind: ScriptMark["kind"], value?: string) {
    const r = range();
    if (!r) {
      onError("请先在讲稿中选中文字");
      return;
    }
    setDoc({
      ...doc,
      marks: [...doc.marks, { ...r, kind, ...(value ? { value } : {}) }],
    });
  }
  async function choose() {
    const r = range();
    if (!r && doc.text) {
      onError("请先在讲稿中选中文字");
      return;
    }
    const chosen = r ?? { start: 0, end: 0 };
    clearTimeout(timer.current);
    await persist();
    if (saved.current !== JSON.stringify(latest.current)) return;
    onSelection({
      deckVersionId: slide.deckVersionId,
      slideId: slide.id,
      elementId: "script",
      startOffset: chosen.start,
      endOffset: chosen.end,
      selectedText: doc.text.slice(chosen.start, chosen.end),
    });
  }
  return (
    <section className="script-editor">
      <header>
        <div>
          <h3>
            <Article size={20} /> 本页汇报稿 <small>第 {slide.index} 页</small>
          </h3>
          <span className="muted">把画面上的信息，变成自然的讲述。</span>
        </div>
        <span role="status" className="save-status">
          {status}
        </span>
      </header>
      <div className="script-tools">
        <Button title="加粗" aria-label="加粗" onClick={() => mark("bold")}>
          <TextB size={18} />
        </Button>
        <Button
          title="下划线"
          aria-label="下划线"
          onClick={() => mark("underline")}
        >
          <TextUnderline size={18} />
        </Button>
        <Button
          title="钢蓝文字"
          aria-label="文字颜色：钢蓝"
          onClick={() => mark("color", "#426581")}
        >
          <TextAUnderline size={18} />
        </Button>
        <Button
          title="浅黄色高亮"
          aria-label="文字高亮：浅黄色"
          onClick={() => mark("highlight", "#eee4b7")}
        >
          <Highlighter size={18} />
        </Button>
        <Button
          aria-label={doc.text ? "✦ 改写选区" : "✦ 补写本页讲稿"}
          onClick={() => void choose()}
        >
          <Sparkle size={18} weight="fill" />
          {doc.text ? "AI 重写" : "AI 补写"}
        </Button>
        <Button onClick={() => void persist()}>保存</Button>
        <span>
          {doc.text.length} 字 · 约 {Math.ceil((doc.text.length / 220) * 60)} 秒
        </span>
      </div>
      {conflict && (
        <p role="alert">
          服务器讲稿已有更新。此处保留本机草稿；请复制草稿后刷新，核对最新内容。
        </p>
      )}
      <RichText
        document={doc}
        onRange={(r) => {
          selection.current = r;
        }}
        onChange={(text) => {
          selection.current = undefined;
          const next = editDocument(latest.current, text);
          latest.current = next;
          try {
            localStorage.setItem(
              storageKey,
              JSON.stringify({ ...next, revision: revision.current }),
            );
          } catch {
            onError("本机草稿空间不足，请及时保存");
          }
          setDoc(next);
        }}
        onBlur={() => {
          clearTimeout(timer.current);
          void persist();
        }}
      />
      <div className="annotation-row">
        <input
          aria-label="标注内容"
          placeholder="为选中文字添加讲述提醒"
          value={annotation}
          onChange={(e) => setAnnotation(e.target.value)}
        />
        <Button
          disabled={!annotation.trim()}
          onClick={() => {
            const r = range();
            if (!r) {
              onError("请先选中需要标注的讲稿文字");
              return;
            }
            setDoc({
              ...doc,
              annotations: [
                ...doc.annotations,
                {
                  ...r,
                  id: crypto.randomUUID(),
                  text: annotation,
                  author: "我",
                  createdAt: new Date().toISOString(),
                },
              ],
            });
            setAnnotation("");
          }}
        >
          添加标注
        </Button>
      </div>
      {doc.annotations.map((a) => (
        <p className="annotation" key={a.id}>
          ↳ {a.text}
          {a.invalid && <small>（原文已修改，请重新定位）</small>}
        </p>
      ))}
    </section>
  );
}
