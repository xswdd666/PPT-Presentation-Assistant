import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
export async function makeDrawingFixture() {
  const zip = await JSZip.loadAsync(await makeFixture(1));
  const source = zip.file("ppt/slides/slide1.xml");
  if (!source) throw new Error("Missing fixture slide");
  zip.file(
    "ppt/slides/slide1.xml",
    (await source.async("string")).replace(
      "</p:spTree>",
      '<p:sp><p:nvSpPr><p:cNvPr id="98" name="brace"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="7195837" y="706968"/><a:ext cx="962025" cy="5398556"/></a:xfrm><a:prstGeom prst="rightBrace"/></p:spPr><p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef></p:style></p:sp><p:cxnSp><p:nvCxnSpPr><p:cNvPr id="99" name="arrow"/></p:nvCxnSpPr><p:spPr><a:xfrm flipH="1"><a:off x="8020652" y="3409950"/><a:ext cx="1575217" cy="0"/></a:xfrm><a:prstGeom prst="straightConnector1"/><a:ln><a:tailEnd type="triangle"/></a:ln></p:spPr><p:style><a:lnRef idx="3"><a:schemeClr val="accent2"/></a:lnRef></p:style></p:cxnSp></p:spTree>',
    ),
  );
  return zip.generateAsync({ type: "uint8array" });
}
export async function makeFixture(pages: number, withImage = false) {
  const Constructor = PptxGenJS as unknown as typeof PptxGenJS.default;
  const deck = new Constructor();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "Deck Rehearsal fixtures";
  deck.title = "增长复盘测试文稿";
  for (let index = 0; index < pages; index++) {
    const slide = deck.addSlide();
    if (withImage)
      slide.addImage({
        data: "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4X8AAAAASUVORK5CYII=",
        x: 1,
        y: 3,
        w: 2,
        h: 2,
      });
    slide.addText(`第 ${String(index + 1)} 页：增长来自更清晰的产品价值`, {
      x: 0.8,
      y: 0.7,
      w: 11.7,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: "283F51",
    });
    slide.addText(
      [
        { text: "本季度", options: { bold: true } },
        { text: "转化率提升 20%", options: { color: "456C88" } },
        { text: "，下一阶段继续验证留存。" },
      ],
      { x: 0.8, y: 2, w: 11, h: 1.2, fontSize: 22 },
    );
    slide.addText("数据来源：内部测试样本；仅用于开发验证。", {
      x: 0.8,
      y: 5.8,
      w: 10,
      h: 0.4,
      fontSize: 12,
      color: "7D8B95",
    });
    slide.addNotes(
      `这一页说明第 ${String(index + 1)} 个要点，先讲结论，再解释依据。`,
    );
  }
  return new Uint8Array(
    (await deck.write({ outputType: "arraybuffer" })) as ArrayBuffer,
  );
}
