function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected fixture value");
  return value;
}
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { OpenXmlPptxProcessor } from "./index.js";
import { makeFixture } from "./testing.js";
const engine = new OpenXmlPptxProcessor();
describe("real PPTX contract", () => {
  it.each([1, 15, 30, 60])(
    "parses %i pages with stable identifiers and notes",
    async (count) => {
      const file = await makeFixture(count);
      const a = await engine.parse(file, "v1");
      const b = await engine.parse(file, "v2");
      expect(a.pageCount).toBe(count);
      expect(a.slides.map((s) => s.id)).toEqual(b.slides.map((s) => s.id));
      expect(a.slides[0]?.notes).toContain("先讲结论");
      expect(a.slides[0]?.elements.filter((e) => e.editable).length).toBe(3);
    },
  );
  it("rejects over-limit and corrupt files", async () => {
    await expect(engine.parse(await makeFixture(61), "v1")).rejects.toThrow(
      "1–60",
    );
    await expect(engine.parse(new Uint8Array([1, 2, 3]), "v1")).rejects.toThrow(
      "损坏",
    );
  });
  it("replaces across text runs, preserves other parts, reorders, hides and restores", async () => {
    const file = await makeFixture(3);
    const original = file.slice();
    const parsed = await engine.parse(file, "v1");
    const slide = present(parsed.slides[0]);
    const element = present(
      slide.elements.find((e) => e.text?.includes("本季度")),
    );
    const selection = {
      deckVersionId: "v1",
      slideId: slide.id,
      elementId: element.id,
      startOffset: 0,
      endOffset: 6,
      selectedText: present(element.text).slice(0, 6),
    };
    const modified = await engine.applyChanges(file, [
      { type: "replace_text", selection, replacementText: "本期转化率" },
      {
        type: "reorder_slides",
        slideIds: parsed.slides.map((s) => s.id).reverse(),
      },
      { type: "set_slide_hidden", slideId: slide.id, hidden: true },
    ]);
    expect(file).toEqual(original);
    const result = await engine.parse(modified, "v2");
    expect(result.slides[2]?.id).toBe(slide.id);
    expect(result.slides[2]?.hidden).toBe(true);
    expect(
      result.slides[2]?.elements.find((e) => e.id === element.id)?.text,
    ).toBe("本期转化率" + present(element.text).slice(6));
    const before = await JSZip.loadAsync(file);
    const after = await JSZip.loadAsync(modified);
    expect(await before.file("ppt/slides/slide2.xml")?.async("string")).toEqual(
      await after.file("ppt/slides/slide2.xml")?.async("string"),
    );
    await expect(
      engine.applyChanges(modified, [
        { type: "replace_text", selection, replacementText: "过期" },
      ]),
    ).rejects.toThrow("原文已变化");
    const restored = await engine.parse(
      await engine.applyChanges(modified, [
        { type: "set_slide_hidden", slideId: slide.id, hidden: false },
        { type: "update_notes", slideId: slide.id, notes: "更新的备注" },
      ]),
      "v3",
    );
    expect(restored.slides[2]?.hidden).toBe(false);
    expect(restored.slides[2]?.notes).toBe("更新的备注");
  });
});
