import { useId, useState } from "react";
import type { CSSProperties } from "react";
import type {
  Slide,
  SlideElement,
  TextSelection,
} from "@deck-rehearsal/contracts";
export const supportedGeometry = new Set([
  "ellipse",
  "rect",
  "roundRect",
  "triangle",
  "diamond",
  "line",
  "straightConnector1",
  "rightBrace",
  "leftBrace",
]);
const isLine = (element: SlideElement) =>
  element.geometry === "line" || element.geometry === "straightConnector1";
export function elementStyle(slide: Slide, e: SlideElement): CSSProperties {
  const w = slide.width ?? 12192000,
    h = slide.height ?? 6858000;
  return {
    left: `${String((e.bounds.x / w) * 100)}%`,
    top: `${String((e.bounds.y / h) * 100)}%`,
    width: `${String(((isLine(e) ? Math.max(e.bounds.width, 12700) : e.bounds.width) / w) * 100)}%`,
    height: `${String(((isLine(e) ? Math.max(e.bounds.height, 12700) : e.bounds.height) / h) * 100)}%`,
    overflow:
      e.geometry && !e.text && supportedGeometry.has(e.geometry)
        ? "visible"
        : undefined,
    fontSize: `${String((((e.fontSize ?? 24) * 12700) / w) * 100)}cqw`,
    fontWeight: e.bold ? 700 : 400,
    boxSizing: "border-box",
    padding: e.textInsets
      ? [
          e.textInsets.top,
          e.textInsets.right,
          e.textInsets.bottom,
          e.textInsets.left,
        ]
          .map((v) => `${String((v / w) * 100)}cqw`)
          .join(" ")
      : undefined,
    transform: e.rotation ? `rotate(${String(e.rotation)}deg)` : undefined,
    display: e.text ? "flex" : undefined,
    flexDirection: "column",
    justifyContent:
      e.verticalAlign === "ctr"
        ? "center"
        : e.verticalAlign === "b"
          ? "flex-end"
          : "flex-start",
  };
}
export function SlideText({
  slide,
  element: e,
  transparent = false,
}: {
  slide: Slide;
  element: SlideElement;
  transparent?: boolean;
}) {
  if (
    !e.paragraphs ||
    e.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n") !==
      e.text
  )
    return <>{e.text}</>;
  return (
    <span style={{ display: "block", flexShrink: 0 }}>
      {e.paragraphs.map((p, i) => (
        <span
          key={i}
          style={{
            display: "block",
            fontSize: `${String(((Math.max(...p.runs.map((r) => r.fontSize), 1) * 12700) / (slide.width ?? 12192000)) * 100)}cqw`,
            lineHeight: 1.2,
            textAlign:
              p.align === "ctr"
                ? "center"
                : p.align === "r"
                  ? "right"
                  : p.align === "just"
                    ? "justify"
                    : "left",
          }}
        >
          {i > 0 && (
            <span style={{ position: "absolute", fontSize: 0, lineHeight: 0 }}>
              {"\n"}
            </span>
          )}
          {p.runs.map((r, j) => (
            <span
              key={j}
              style={{
                fontSize: `${String(((r.fontSize * 12700) / (slide.width ?? 12192000)) * 100)}cqw`,
                fontWeight: r.bold ? 700 : 400,
                fontStyle: r.italic ? "italic" : "normal",
                color: transparent
                  ? "transparent"
                  : `#${/^[\da-f]{6}$/i.test(r.color) ? r.color : "000000"}`,
                fontFamily:
                  r.fontFamily && !r.fontFamily.startsWith("+")
                    ? `"${r.fontFamily}", "Microsoft YaHei", sans-serif`
                    : '"Microsoft YaHei", Arial, sans-serif',
              }}
            >
              {r.text}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}
export function SlideShape({ element: e }: { element: SlideElement }) {
  const markerId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!e.geometry) return null;
  const fill = /^[\da-f]{6}$/i.test(e.fill ?? "")
    ? `#${String(e.fill)}`
    : "none";
  const stroke = /^[\da-f]{6}$/i.test(e.stroke ?? "")
    ? `#${String(e.stroke)}`
    : "none";
  const width = Math.max(isLine(e) ? 12700 : 1, e.bounds.width),
    height = Math.max(isLine(e) ? 12700 : 1, e.bounds.height);
  const r = Math.min(width / 4, height / 10);
  const brace = [
    "M",
    0,
    0,
    "C",
    width / 4,
    0,
    width * 0.75,
    0,
    width * 0.75,
    r,
    "L",
    width * 0.75,
    height / 2 - r,
    "C",
    width * 0.75,
    height / 2,
    width,
    height / 2,
    width,
    height / 2,
    "C",
    width,
    height / 2,
    width * 0.75,
    height / 2,
    width * 0.75,
    height / 2 + r,
    "L",
    width * 0.75,
    height - r,
    "C",
    width * 0.75,
    height,
    width / 4,
    height,
    0,
    height,
  ].join(" ");
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
      }}
      fill={fill}
      fillOpacity={e.fillOpacity ?? 1}
      stroke={stroke}
      strokeWidth={e.strokeWidth || 12700}
    >
      <defs>
        {[e.headEnd, e.tailEnd].map((type, i) =>
          type && type !== "none" ? (
            <marker
              key={i}
              id={`${markerId}-${String(i)}`}
              markerWidth="6"
              markerHeight="6"
              refX="6"
              refY="3"
              orient="auto-start-reverse"
              markerUnits="strokeWidth"
              viewBox="0 0 6 6"
            >
              <path
                d={
                  type === "diamond"
                    ? "M0 3 L3 0 L6 3 L3 6 Z"
                    : type === "arrow"
                      ? "M0 0 L6 3 L0 6"
                      : "M0 0 L6 3 L0 6 Z"
                }
                fill={type === "arrow" ? "none" : stroke}
                stroke={stroke}
                strokeWidth="0.6"
              />
            </marker>
          ) : null,
        )}
      </defs>
      <g
        transform={`translate(${String(e.flipH ? width : 0)} ${String(e.flipV ? height : 0)}) scale(${e.flipH ? "-1" : "1"} ${e.flipV ? "-1" : "1"})`}
      >
        {e.geometry === "ellipse" ? (
          <ellipse
            cx={width / 2}
            cy={height / 2}
            rx={width / 2}
            ry={height / 2}
          />
        ) : e.geometry === "triangle" ? (
          <polygon
            points={`${String(width / 2)},0 ${String(width)},${String(height)} 0,${String(height)}`}
          />
        ) : e.geometry === "diamond" ? (
          <polygon
            points={`${String(width / 2)},0 ${String(width)},${String(height / 2)} ${String(width / 2)},${String(height)} 0,${String(height / 2)}`}
          />
        ) : isLine(e) ? (
          <line
            x1="0"
            y1="0"
            x2={e.bounds.width}
            y2={e.bounds.height}
            markerStart={
              e.headEnd && e.headEnd !== "none"
                ? `url(#${markerId}-0)`
                : undefined
            }
            markerEnd={
              e.tailEnd && e.tailEnd !== "none"
                ? `url(#${markerId}-1)`
                : undefined
            }
          />
        ) : e.geometry === "rightBrace" || e.geometry === "leftBrace" ? (
          <path
            d={brace}
            fill="none"
            transform={
              e.geometry === "leftBrace"
                ? `translate(${String(width)} 0) scale(-1 1)`
                : undefined
            }
          />
        ) : ["rect", "roundRect"].includes(e.geometry) ? (
          <rect
            width={width}
            height={height}
            rx={e.geometry === "roundRect" ? Math.min(width, height) * 0.15 : 0}
          />
        ) : null}
      </g>
    </svg>
  );
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
            <SlideText slide={slide} element={e} transparent />
          </div>
        ))}
    </div>
  );
}
