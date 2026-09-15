import { expect, it } from "vitest";
import { textDiff } from "./diff.js";
import { elementStyle } from "./selection.js";
import { replaceDocumentRange } from "../../client/script-document.js";
import type { Slide, ScriptDocument } from "@deck-rehearsal/contracts";
it("diff reconstructs both texts including emoji and unchanged words", () => {
  const a = "本季度收入增长20%，继续验证😀",
    b = "本季度营收增长20%，持续验证😀";
  const diff = textDiff(a, b);
  expect(
    diff
      .filter((p) => p.type !== "insert")
      .map((p) => p.text)
      .join(""),
  ).toBe(a);
  expect(
    diff
      .filter((p) => p.type !== "delete")
      .map((p) => p.text)
      .join(""),
  ).toBe(b);
  expect(diff.some((p) => p.type === "equal")).toBe(true);
});
it("geometry uses container-relative bounds at every zoom", () => {
  const slide = { width: 1000, height: 500 } as Slide;
  const element = {
    bounds: { x: 100, y: 50, width: 300, height: 100 },
    fontSize: 20,
  } as Slide["elements"][number];
  expect(elementStyle(slide, element)).toMatchObject({
    left: "10%",
    top: "10%",
    width: "30%",
    height: "20%",
  });
});
it("replacement preserves intersecting formatting outside the selected range and invalidates overlapping notes", () => {
  const doc: ScriptDocument = {
    slideId: "s",
    revision: 0,
    updatedAt: "",
    text: "abcdefghij",
    marks: [
      { start: 0, end: 5, kind: "bold" },
      { start: 4, end: 10, kind: "underline" },
      { start: 0, end: 10, kind: "color", value: "#426581" },
    ],
    annotations: [
      { id: "a", start: 4, end: 5, text: "note", author: "me", createdAt: "" },
    ],
  };
  const result = replaceDocumentRange(doc, 3, 7, "XY");
  expect(result.text).toBe("abcXYhij");
  expect(result.marks).toEqual([
    { start: 0, end: 3, kind: "bold" },
    { start: 5, end: 8, kind: "underline" },
    { start: 0, end: 8, kind: "color", value: "#426581" },
  ]);
  expect(result.annotations[0]?.invalid).toBe(true);
});
