import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { elementStyle } from "../slide-rewrite/selection.js";
import type { ReactNode } from "react";
import type {
  ScriptDocument,
  Slide,
  TextSelection,
} from "@deck-rehearsal/contracts";
export interface WorkbenchSlotProps {
  projectId: string;
  slide: Slide;
  zoom: number;
  document: ScriptDocument;
  onSelection: (selection: TextSelection) => void;
}
export interface WorkbenchSlots {
  slideTextSelectionLayer?: (props: WorkbenchSlotProps) => ReactNode;
  presenterScriptEditor?: (props: WorkbenchSlotProps) => ReactNode;
}
export function ThumbnailRail({
  slides,
  selectedId,
  onSelect,
}: {
  slides: Slide[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(800);
  const row = 120;
  const start = Math.max(0, Math.floor(scroll / row) - 2);
  const end = Math.min(slides.length, Math.ceil((scroll + height) / row) + 2);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const button = document.getElementById(`thumb-${pendingFocus.current}`);
    if (button) {
      button.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, [start, end, selectedId]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    const index = slides.findIndex((s) => s.id === selectedId);
    if (!el || index < 0) return;
    if (index * row < el.scrollTop) el.scrollTop = index * row;
    else if ((index + 1) * row > el.scrollTop + el.clientHeight)
      el.scrollTop = (index + 1) * row - el.clientHeight;
    setScroll(el.scrollTop);
  }, [selectedId, slides]);
  return (
    <div
      className="thumbnails"
      ref={ref}
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      aria-label="演示文稿页面"
    >
      <div style={{ height: slides.length * row, position: "relative" }}>
        {slides.slice(start, end).map((s, offset) => (
          <button
            key={s.id}
            id={`thumb-${s.id}`}
            aria-label={`第 ${String(s.index)} 页`}
            aria-current={selectedId === s.id ? "page" : undefined}
            className={`thumbnail ${selectedId === s.id ? "selected" : ""}`}
            style={{
              position: "absolute",
              top: (start + offset) * row,
              height: row - 8,
            }}
            onClick={() => onSelect(s.id)}
            onKeyDown={(e) => {
              const index = slides.indexOf(s);
              const next =
                e.key === "ArrowDown"
                  ? index + 1
                  : e.key === "ArrowUp"
                    ? index - 1
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? slides.length - 1
                        : -1;
              if (next < 0 || !slides[next]) return;
              e.preventDefault();
              const id = slides[next].id;
              pendingFocus.current = id;
              onSelect(id);
            }}
          >
            <div className="mini-slide" aria-hidden="true">
              {s.elements
                .filter((e) => e.text)
                .map((e) => (
                  <span
                    key={e.id}
                    className="mini-element"
                    style={{
                      ...elementStyle(s, e),
                      color: "#153557",
                    }}
                  >
                    {e.text}
                  </span>
                ))}
            </div>
            <span className="thumb-caption">
              {String(s.index).padStart(2, "0")}
              {selectedId === s.id ? " · 当前页" : ""}
              {s.hidden ? " · 已隐藏" : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
