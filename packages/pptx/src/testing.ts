import PptxGenJS from "pptxgenjs";
export async function makeFixture(pages: number) {
  const Constructor = PptxGenJS as unknown as typeof PptxGenJS.default;
  const deck = new Constructor();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "Deck Rehearsal fixtures";
  deck.title = "增长复盘测试文稿";
  for (let index = 0; index < pages; index++) {
    const slide = deck.addSlide();
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
