import { randomUUID } from "node:crypto";
import type {
  AiSnapshotReader,
  LocalRewriteRequest,
  ReviewAnalysisModel,
  TextSelection,
  VersionedRewrite,
} from "@deck-rehearsal/contracts";
import { checkSnapshot, hash } from "./pipeline.js";
import { fail, rewriteSchema } from "./schemas.js";
export function selectionMatches(selection: TextSelection, text: string) {
  return (
    Number.isInteger(selection.startOffset) &&
    Number.isInteger(selection.endOffset) &&
    selection.startOffset >= 0 &&
    selection.endOffset > selection.startOffset &&
    selection.endOffset <= text.length &&
    text.slice(selection.startOffset, selection.endOffset) ===
      selection.selectedText
  );
}
export function textDiff(
  original: string,
  replacement: string,
): VersionedRewrite["diff"] {
  const a = Array.from(original),
    b = Array.from(replacement);
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const diff: VersionedRewrite["diff"] = [];
  const push = (
    type: VersionedRewrite["diff"][number]["type"],
    text: string,
  ) => {
    if (text) diff.push({ type, text });
  };
  push("equal", a.slice(0, start).join(""));
  push("delete", a.slice(start, a.length - end).join(""));
  push("insert", b.slice(start, b.length - end).join(""));
  push("equal", a.slice(a.length - end).join(""));
  return diff;
}
export class LocalRewriteService {
  constructor(
    private readonly reader: AiSnapshotReader,
    private readonly model: Pick<
      ReviewAnalysisModel,
      "rewrite" | "rewriteScript"
    >,
  ) {}
  async suggest(request: LocalRewriteRequest): Promise<VersionedRewrite> {
    request = structuredClone(request);
    const snapshot = structuredClone(
      await this.reader.getSnapshot(request.projectId),
    );
    if (snapshot.context.projectId !== request.projectId)
      fail("not_found", "项目上下文不存在");
    const initialHash = hash(snapshot);
    checkSnapshot(snapshot, request.selection.deckVersionId);
    const slides = [...snapshot.slides].sort((a, b) => a.index - b.index);
    const index = slides.findIndex((s) => s.id === request.selection.slideId),
      currentSlide = slides[index];
    if (!currentSlide) fail("not_found", "选中页面不存在");
    const context = snapshot.context;
    let result;
    if (request.target === "ppt") {
      const element = currentSlide.elements.find(
        (e) => e.id === request.selection.elementId,
      );
      if (!element?.editable || element.text === undefined)
        fail("invalid_input", "选中文字不可编辑");
      if (!selectionMatches(request.selection, element.text))
        fail("version_conflict", "选中文字已变化");
      result = await this.model.rewrite({
        selection: request.selection,
        elementText: element.text,
        currentSlide,
        context,
        ...(slides[index - 1] ? { previousSlide: slides[index - 1] } : {}),
        ...(slides[index + 1] ? { nextSlide: slides[index + 1] } : {}),
      });
    } else {
      const currentScript = snapshot.documents[currentSlide.id];
      if (
        !currentScript ||
        currentScript.revision !== request.scriptRevision ||
        !selectionMatches(request.selection, currentScript.text)
      )
        fail("version_conflict", "讲稿或选区已变化");
      const previousScript = snapshot.documents[slides[index - 1]?.id ?? ""],
        nextScript = snapshot.documents[slides[index + 1]?.id ?? ""];
      result = await this.model.rewriteScript({
        selection: request.selection,
        scriptRevision: request.scriptRevision,
        context,
        currentSlide,
        currentScript,
        ...(previousScript ? { previousScript } : {}),
        ...(nextScript ? { nextScript } : {}),
      });
    }
    const parsed = rewriteSchema.safeParse(result);
    if (!parsed.success) fail("invalid_output", "改写结果无效");
    const latest = await this.reader.getSnapshot(request.projectId);
    checkSnapshot(latest, request.selection.deckVersionId);
    if (
      request.target === "script" &&
      latest.documents[currentSlide.id]?.revision !== request.scriptRevision
    )
      fail("version_conflict", "生成期间讲稿已变化");
    if (hash(latest) !== initialHash)
      fail("version_conflict", "生成期间汇报背景已变化");
    const output = parsed.data;
    const numbers = (s: string) => s.match(/\d+(?:[.,]\d+)*(?:%|％)?/g) ?? [];
    const factsPreserved =
      output.factsPreserved &&
      JSON.stringify(numbers(request.selection.selectedText)) ===
        JSON.stringify(numbers(output.replacementText));
    return {
      id: `suggestion_${randomUUID()}`,
      target: request.target,
      selection: request.selection,
      originalText: request.selection.selectedText,
      replacementText: output.replacementText,
      rationale: output.rationale,
      diff: textDiff(request.selection.selectedText, output.replacementText),
      basisVersionId: context.deckVersionId,
      basis: `基于第 ${String(currentSlide.index + 1)} 页与当前版本 ${context.deckVersionId}`,
      ...(request.target === "script"
        ? { scriptRevision: request.scriptRevision }
        : {}),
      factsPreserved,
      confidence: output.confidence,
    };
  }
}
