import { useLayoutEffect, useRef } from "react";
import type { ScriptDocument } from "@deck-rehearsal/contracts";
import { readTextRange } from "../slide-rewrite/selection.js";
export function restoreRange(node: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let offset = 0;
  const range = document.createRange();
  let found = false;
  while (walker.nextNode()) {
    const text = walker.currentNode;
    const length = text.textContent?.length ?? 0;
    if (!found && start <= offset + length) {
      range.setStart(text, Math.max(0, start - offset));
      found = true;
    }
    if (found && end <= offset + length) {
      range.setEnd(text, Math.max(0, end - offset));
      break;
    }
    offset += length;
  }
  if (found) {
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }
}
export function RichText({
  document: doc,
  onChange,
  onRange,
  onBlur,
}: {
  document: ScriptDocument;
  onChange: (text: string) => void;
  onRange: (range: { start: number; end: number }) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || composing.current) return;
    const selection = window.getSelection();
    let caret: { start: number; end: number } | undefined;
    if (selection?.rangeCount && node.contains(selection.anchorNode)) {
      const r = selection.getRangeAt(0),
        prefix = r.cloneRange();
      prefix.selectNodeContents(node);
      prefix.setEnd(r.startContainer, r.startOffset);
      caret = {
        start: prefix.toString().length,
        end: prefix.toString().length + r.toString().length,
      };
    }
    node.replaceChildren();
    const boundaries = [
      ...new Set([
        0,
        doc.text.length,
        ...doc.marks.flatMap((m) => [m.start, m.end]),
      ]),
    ].sort((a, b) => a - b);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i] ?? 0,
        end = boundaries[i + 1] ?? doc.text.length;
      const span = window.document.createElement("span");
      span.textContent = doc.text.slice(start, end);
      for (const mark of doc.marks.filter(
        (m) => m.start <= start && m.end >= end,
      )) {
        if (mark.kind === "bold") span.style.fontWeight = "700";
        if (mark.kind === "underline") span.style.textDecoration = "underline";
        if (mark.kind === "color") span.style.color = mark.value ?? "";
        if (mark.kind === "highlight")
          span.style.backgroundColor = mark.value ?? "";
      }
      node.append(span);
    }
    if (caret)
      restoreRange(
        node,
        Math.min(caret.start, doc.text.length),
        Math.min(caret.end, doc.text.length),
      );
  }, [doc.text, doc.marks]);
  const select = () => {
    if (ref.current) {
      const r = readTextRange(ref.current);
      if (r) onRange(r);
    }
  };
  function replaceSelection(text: string) {
    const node = ref.current,
      s = window.getSelection();
    if (!node || !s?.rangeCount || !node.contains(s.anchorNode)) return;
    const r = s.getRangeAt(0);
    r.deleteContents();
    const t = window.document.createTextNode(text);
    r.insertNode(t);
    r.setStartAfter(t);
    r.collapse(true);
    s.removeAllRanges();
    s.addRange(r);
    onChange(node.textContent);
  }
  return (
    <div
      ref={ref}
      role="textbox"
      aria-label="本页汇报稿正文"
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      className="script-text rich-text"
      data-placeholder="从这一页最想让听众记住的一句话开始…"
      onInput={(e) => {
        if (!composing.current) onChange(e.currentTarget.textContent);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        onChange(e.currentTarget.textContent);
      }}
      onMouseUp={select}
      onKeyUp={select}
      onBlur={onBlur}
      onPaste={(e) => {
        e.preventDefault();
        replaceSelection(e.clipboardData.getData("text/plain"));
      }}
      onDrop={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          replaceSelection("\n");
        }
      }}
    />
  );
}
