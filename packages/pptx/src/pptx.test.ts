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
  it("preserves the transparent cover overlay so the original photo stays visible", async () => {
    const zip = await JSZip.loadAsync(await makeFixture(1, true));
    const path = "ppt/slides/slide1.xml";
    zip.file(
      path,
      (await present(zip.file(path) ?? undefined).async("string")).replace(
        "</p:spTree>",
        '<p:sp><p:nvSpPr><p:cNvPr id="99"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="bg2"><a:alpha val="55000"/></a:schemeClr></a:solidFill></p:spPr></p:sp></p:spTree>',
      ),
    );
    const file = await zip.generateAsync({ type: "uint8array" });
    const slide = present((await engine.parse(file, "v1")).slides[0]);
    const photo = present(slide.elements.find((e) => e.kind === "image"));
    expect((await engine.image(file, slide.id, photo.id)).type).toBe(
      "image/png",
    );
    expect(slide.elements.at(-1)).toMatchObject({ fillOpacity: 0.55 });
  });
  it("resolves grouped coordinates, theme black, inherited font size and explicit line breaks", async () => {
    const zip = await JSZip.loadAsync(await makeFixture(1));
    const path = "ppt/slides/slide1.xml";
    zip.file(
      path,
      (await present(zip.file(path) ?? undefined).async("string")).replace(
        "</p:spTree>",
        '<p:grpSp><p:grpSpPr><a:xfrm><a:off x="1000" y="2000"/><a:ext cx="200" cy="200"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="98"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm><a:prstGeom prst="ellipse"/><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr b="1"/><a:t>标题</a:t></a:r><a:br/><a:r><a:t>正文</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp></p:spTree>',
      ),
    );
    const slide = present(
      (
        await engine.parse(
          await zip.generateAsync({ type: "uint8array" }),
          "v1",
        )
      ).slides[0],
    );
    expect(slide.elements.at(-1)).toMatchObject({
      fill: "000000",
      bounds: { x: 1020, y: 2040, width: 60, height: 80 },
      text: "标题\n正文",
      paragraphs: [
        {
          runs: [{ bold: true }, { text: "\n" }, { text: "正文", bold: false }],
        },
      ],
    });
  });
  it("preserves mixed text runs and solid ellipse geometry in drawing order", async () => {
    const zip = await JSZip.loadAsync(await makeFixture(1));
    const path = "ppt/slides/slide1.xml";
    const source = await present(zip.file(path) ?? undefined).async("string");
    zip.file(
      path,
      source.replace(
        "</p:spTree>",
        '<p:sp><p:nvSpPr><p:cNvPr id="99" name="black circle"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="300"/></a:xfrm><a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr></p:sp></p:spTree>',
      ),
    );
    const slide = present(
      (
        await engine.parse(
          await zip.generateAsync({ type: "uint8array" }),
          "v1",
        )
      ).slides[0],
    );
    expect(slide.elements.at(-1)).toMatchObject({
      geometry: "ellipse",
      fill: "000000",
    });
    const mixed = present(
      slide.elements.find((e) => e.text?.startsWith("本季度")),
    );
    expect(mixed).toMatchObject({
      paragraphs: [
        {
          runs: [
            { text: "本季度", bold: true },
            { text: "转化率提升 20%", bold: false },
            { text: "，下一阶段继续验证留存。", bold: false },
          ],
        },
      ],
    });
  });
  it("extracts original embedded PNG by stable slide and image identifiers", async () => {
    const file = await makeFixture(1, true);
    const slide = present((await engine.parse(file, "v1")).slides[0]);
    const picture = present(slide.elements.find((e) => e.kind === "image"));
    const media = await engine.image(file, slide.id, picture.id);
    expect(media.type).toBe("image/png");
    expect([...media.content.slice(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    await expect(engine.image(file, slide.id, "missing")).rejects.toThrow();
  });
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
