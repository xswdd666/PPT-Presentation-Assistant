import { useState } from "react";
import type { CSSProperties } from "react";
import type {
  Slide,
  SlideElement,
  TextSelection,
} from "@deck-rehearsal/contracts";
export function elementStyle(slide: Slide, e: SlideElement): CSSProperties {
  const w = slide.width ?? 12192000,
    h = slide.height ?? 6858000;
  return {
    left: `${String((e.bounds.x / w) * 100)}%`,
    top: `${String((e.bounds.y / h) * 100)}%`,
    width: `${String((e.bounds.width / w) * 100)}%`,
    height: `${String((e.bounds.height / h) * 100)}%`,
    fontSize: `${String((((e.fontSize ?? 24) * 12700) / w) * 100)}cqw`,
    fontWeight: e.bold ? 700 : 400,
  };
}
export function readTextRange(node: HTMLElement) {
  const s = window.getSelection();
  if (!s?.rangeCount || s.isCollapsed) return;
  const r = s.getRangeAt(0);
  if (!node.contains(r.startContainer) || !node.contains(r.endContainer))
    return;
  const prefix = r.cloneRange();
  prefix.selectNodeContents(node);
  prefix.setEnd(r.startContainer, r.startOffset);
  return {
    start: prefix.toString().length,
    end: prefix.toString().length + r.toString().length,
  };
}
/** Uses exactly the canvas text geometry. Parent width/zoom changes scale both layers. */
export function SlideTextSelectionLayer({
  slide,
  onSelection,
  onClear,
}: {
  slide: Slide;
  onSelection: (s: TextSelection) => void;
  onClear?: () => void;
}) {
  const [active, setActive] = useState<string>();
  function select(e: SlideElement, node: HTMLElement, all = false) {
    if (all) {
      const r = document.createRange();
      r.selectNodeContents(node);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(r);
    }
    const range = readTextRange(node);
    if (!range || !e.text) {
      setActive(undefined);
      onClear?.();
      return;
    }
    setActive(e.id);
    onSelection({
      deckVersionId: slide.deckVersionId,
      slideId: slide.id,
      elementId: e.id,
      startOffset: range.start,
      endOffset: range.end,
      selectedText: e.text.slice(range.start, range.end),
    });
  }
  return (
    <div className="slide-selection-layer">
      {slide.elements
        .filter((e) => e.editable && e.text)
        .map((e) => (
          <div
            key={e.id}
            data-element-id={e.id}
            className={`slide-element selectable-text ${active === e.id ? "selection-active" : ""}`}
            style={elementStyle(slide, e)}
            tabIndex={0}
            aria-label={`选择文字：${String(e.text)}`}
            onMouseUp={(event) => select(e, event.currentTarget)}
            onKeyUp={(event) => {
              if (event.key === "Enter") select(e, event.currentTarget, true);
              else if (event.key.startsWith("Arrow"))
                select(e, event.currentTarget);
            }}
          >
            {e.text}
          </div>
        ))}
    </div>
  );
}
