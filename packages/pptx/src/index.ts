import { createHash } from "node:crypto";
import { posix } from "node:path";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document, Element } from "@xmldom/xmldom";
import type {
  ChangeOperation,
  LayoutWarning,
  PptxProcessor,
  Slide,
  SlideElement,
} from "@deck-rehearsal/contracts";

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const all = (node: Element | Document, ns: string, tag: string): Element[] =>
  Array.from(node.getElementsByTagNameNS(ns, tag));
const first = (node: Element | Document, ns: string, tag: string) =>
  all(node, ns, tag)[0];
const num = (node: Element | undefined, name: string, fallback = 0) =>
  Number(node?.getAttribute(name) ?? fallback);
const xml = (source: string): Document => {
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error("不支持含外部实体的文件");
  return new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") throw new Error(`XML 解析失败：${message}`);
    },
  }).parseFromString(source, "application/xml");
};
async function read(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) throw new Error(`PPTX 文件缺少必要部件：${path}`);
  return xml(await file.async("string"));
}
function targetPath(source: string, target: string) {
  const path = target.startsWith("/")
    ? target.slice(1)
    : posix.normalize(posix.join(posix.dirname(source), target));
  if (path.startsWith("../")) throw new Error("文件关系路径无效");
  return path;
}
function relPath(source: string) {
  return posix.join(
    posix.dirname(source),
    "_rels",
    `${posix.basename(source)}.rels`,
  );
}
async function relationships(zip: JSZip, source: string) {
  if (!zip.file(relPath(source))) return [];
  return all(await read(zip, relPath(source)), "*", "Relationship").filter(
    (e) => e.getAttribute("TargetMode") !== "External",
  );
}
async function open(file: Uint8Array) {
  if (!file.length || file.length > 50 * 1024 * 1024)
    throw new Error("文件必须在 1 字节到 50 MB 之间");
  // Inspect declared uncompressed sizes before decompressing XML (ZIP bomb guard).
  const bytes = Buffer.from(file);
  let total = 0;
  let entries = 0;
  for (let i = 0; i <= bytes.length - 46; i++) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
    const size = bytes.readUInt32LE(i + 24);
    total += size;
    entries++;
    if (size > 64 * 1024 * 1024 || total > 256 * 1024 * 1024 || entries > 10000)
      throw new Error("PPTX 解压后过大");
    i +=
      45 +
      bytes.readUInt16LE(i + 28) +
      bytes.readUInt16LE(i + 30) +
      bytes.readUInt16LE(i + 32);
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("文件损坏、已加密或不是有效的 PPTX");
  }
  const presentation = await read(zip, "ppt/presentation.xml");
  const rels = await relationships(zip, "ppt/presentation.xml");
  const ids = all(presentation, P, "sldId");
  if (!ids.length || ids.length > 60)
    throw new Error("仅支持 1–60 页 PPTX，请拆分后上传");
  const paths = ids.map((id) => {
    const rel = rels.find(
      (r) => r.getAttribute("Id") === id.getAttributeNS(R, "id"),
    );
    if (!rel) throw new Error("页面引用损坏");
    return targetPath("ppt/presentation.xml", rel.getAttribute("Target") ?? "");
  });
  return { zip, presentation, ids, paths };
}
function paragraphs(shape: Element): Element[] {
  return all(shape, A, "p");
}
function shapeText(shape: Element) {
  return paragraphs(shape)
    .map((p) =>
      all(p, A, "t")
        .map((t) => t.textContent ?? "")
        .join(""),
    )
    .join("\n");
}
function stableId(path: string) {
  return `slide_${hash(path).slice(0, 16)}`;
}
function elementId(slideId: string, shape: Element) {
  return `${slideId}_${first(shape, P, "cNvPr")?.getAttribute("id") ?? "unknown"}`;
}
function isEditable(shape: Element) {
  return (
    shape.localName === "sp" &&
    Boolean(first(shape, P, "txBody")) &&
    !all(shape, A, "fld").length &&
    !all(shape, A, "br").length &&
    shape.parentNode?.localName === "spTree"
  );
}
export class OpenXmlPptxProcessor implements PptxProcessor {
  async parse(file: Uint8Array, versionId: string) {
    const { zip, presentation, paths } = await open(file);
    const size = first(presentation, P, "sldSz");
    const width = num(size, "cx", 12192000);
    const height = num(size, "cy", 6858000);
    const slides: Slide[] = [];
    for (const [index, path] of paths.entries()) {
      const doc = await read(zip, path);
      const id = stableId(path);
      const shapes = ["sp", "pic", "graphicFrame", "cxnSp"].flatMap((tag) =>
        all(doc, P, tag),
      );
      const elements: SlideElement[] = shapes.map((shape) => {
        const xfrm = first(shape, A, "xfrm") ?? first(shape, P, "xfrm");
        const off = xfrm && first(xfrm, A, "off");
        const ext = xfrm && first(xfrm, A, "ext");
        const text = shapeText(shape);
        const props = first(shape, A, "rPr") ?? first(shape, A, "defRPr");
        const placeholder = first(shape, P, "ph")?.getAttribute("type");
        const editable = isEditable(shape) && Boolean(xfrm);
        return {
          id: elementId(id, shape),
          slideId: id,
          kind:
            shape.localName === "pic"
              ? "image"
              : shape.localName === "graphicFrame"
                ? "other"
                : placeholder === "title" || placeholder === "ctrTitle"
                  ? "title"
                  : "body",
          bounds: {
            x: num(off, "x"),
            y: num(off, "y"),
            width: num(ext, "cx"),
            height: num(ext, "cy"),
          },
          ...(text ? { text } : {}),
          editable,
          contentHash: hash(new XMLSerializer().serializeToString(shape)),
          fontSize: num(props, "sz", 2400) / 100,
          bold: props?.getAttribute("b") === "1",
          color: first(shape, A, "srgbClr")?.getAttribute("val") ?? "263341",
          ...(!editable
            ? { readOnlyReason: "组合、图表、继承布局或特殊文字仅支持只读预览" }
            : {}),
        };
      });
      const rels = await relationships(zip, path);
      const notesRel = rels.find((r) =>
        r.getAttribute("Type")?.endsWith("/notesSlide"),
      );
      let notes = "";
      if (notesRel) {
        const notesDoc = await read(
          zip,
          targetPath(path, notesRel.getAttribute("Target") ?? ""),
        );
        notes = all(notesDoc, P, "sp")
          .filter((s) => first(s, P, "ph")?.getAttribute("type") === "body")
          .map(shapeText)
          .join("\n");
      }
      slides.push({
        id,
        deckVersionId: versionId,
        sourceStableId: path,
        index: index + 1,
        hidden: doc.documentElement?.getAttribute("show") === "0",
        width,
        height,
        notes,
        elements,
        contentHash: hash(new XMLSerializer().serializeToString(doc)),
      });
    }
    return { slides, pageCount: slides.length };
  }
  async applyChanges(file: Uint8Array, changes: ChangeOperation[]) {
    const { zip, presentation, ids, paths } = await open(file);
    for (const change of changes) {
      if (change.type === "reorder_slides") {
        if (
          change.slideIds.length !== paths.length ||
          new Set(change.slideIds).size !== paths.length ||
          change.slideIds.some((id) => !paths.some((p) => stableId(p) === id))
        )
          throw new Error("排序必须包含全部页面，且不能重复");
        const list = first(presentation, P, "sldIdLst");
        if (!list) throw new Error("缺少页面列表");
        for (const id of change.slideIds) {
          const node = ids[paths.findIndex((p) => stableId(p) === id)];
          if (node) list.appendChild(node);
        }
        zip.file(
          "ppt/presentation.xml",
          new XMLSerializer().serializeToString(presentation),
        );
        continue;
      }
      const slideId =
        change.type === "replace_text"
          ? change.selection.slideId
          : change.slideId;
      const path = paths.find((p) => stableId(p) === slideId);
      if (!path) throw new Error("目标页面不存在");
      const doc = await read(zip, path);
      if (change.type === "set_slide_hidden")
        doc.documentElement?.setAttribute("show", change.hidden ? "0" : "1");
      else if (change.type === "replace_text") {
        const shape = all(doc, P, "sp").find(
          (s) => elementId(slideId, s) === change.selection.elementId,
        );
        if (!shape || !isEditable(shape) || !first(shape, A, "xfrm"))
          throw new Error("此文字元素不能安全编辑");
        const {
          startOffset: start,
          endOffset: end,
          selectedText,
        } = change.selection;
        const text = shapeText(shape);
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 0 ||
          end <= start ||
          end > text.length ||
          text.slice(start, end) !== selectedText
        )
          throw new Error("原文已变化，请重新选择文字");
        if (
          selectedText.includes("\n") ||
          change.replacementText.includes("\n")
        )
          throw new Error("请在同一段落内选择文字，改写不能增加段落");
        let offset = 0;
        let inserted = false;
        for (const p of paragraphs(shape)) {
          for (const node of all(p, A, "t")) {
            const original = node.textContent ?? "";
            const nodeEnd = offset + original.length;
            if (offset < end && nodeEnd > start) {
              const left = Math.max(0, start - offset);
              const right = Math.min(original.length, end - offset);
              node.textContent =
                original.slice(0, left) +
                (inserted ? "" : change.replacementText) +
                original.slice(right);
              node.setAttribute("xml:space", "preserve");
              inserted = true;
            }
            offset = nodeEnd;
          }
          offset++;
        }
      } else {
        const rel = (await relationships(zip, path)).find((r) =>
          r.getAttribute("Type")?.endsWith("/notesSlide"),
        );
        if (!rel)
          throw new Error(
            "该页没有原生备注部件，请先在 PowerPoint 创建备注；本页汇报稿可独立保存",
          );
        const notesPath = targetPath(path, rel.getAttribute("Target") ?? "");
        const notesDoc = await read(zip, notesPath);
        const body = all(notesDoc, P, "sp").find(
          (s) => first(s, P, "ph")?.getAttribute("type") === "body",
        );
        const tx = body && first(body, P, "txBody");
        if (!tx) throw new Error("未找到备注正文");
        for (const p of all(tx, A, "p")) tx.removeChild(p);
        for (const line of change.notes.split("\n")) {
          const p = notesDoc.createElementNS(A, "a:p");
          const r = notesDoc.createElementNS(A, "a:r");
          const t = notesDoc.createElementNS(A, "a:t");
          t.textContent = line;
          r.appendChild(t);
          p.appendChild(r);
          tx.appendChild(p);
        }
        zip.file(notesPath, new XMLSerializer().serializeToString(notesDoc));
      }
      zip.file(path, new XMLSerializer().serializeToString(doc));
    }
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
}
export function inspectLayout(
  slides: Slide[],
  before: Slide[] = [],
): LayoutWarning[] {
  return slides.flatMap((slide) =>
    slide.elements.flatMap((element) => {
      const warnings: LayoutWarning[] = [];
      const b = element.bounds;
      const base = {
        slideId: slide.id,
        elementId: element.id,
        pageIndex: slide.index,
        severity: "medium" as const,
      };
      if (
        b.x < 0 ||
        b.y < 0 ||
        b.x + b.width > (slide.width ?? Infinity) ||
        b.y + b.height > (slide.height ?? Infinity)
      )
        warnings.push({
          ...base,
          kind: "overflow",
          message: "元素超出页面边界，请在 PowerPoint 中检查。",
        });
      const previous = before
        .find((s) => s.id === slide.id)
        ?.elements.find((e) => e.id === element.id);
      if (previous && previous.text !== element.text)
        warnings.push({
          ...base,
          kind: "layout_shift",
          message: "文字已修改，换行与字体需在 PowerPoint 中复查。",
        });
      return warnings;
    }),
  );
}
