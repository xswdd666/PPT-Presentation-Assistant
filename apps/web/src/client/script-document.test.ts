import { expect, it } from "vitest";
import { editDocument } from "./script-document.js";
it("preserves unrelated marks and moves annotations after a text edit", () => {
  const result = editDocument(
    {
      slideId: "s",
      revision: 0,
      updatedAt: "",
      text: "先讲结论，再说依据",
      marks: [
        { start: 0, end: 2, kind: "bold" },
        { start: 7, end: 9, kind: "underline" },
      ],
      annotations: [
        {
          id: "a",
          start: 7,
          end: 9,
          text: "来源",
          author: "我",
          createdAt: "",
        },
      ],
    },
    "先讲核心结论，再说依据",
  );
  expect(result.marks).toEqual([
    { start: 0, end: 2, kind: "bold" },
    { start: 9, end: 11, kind: "underline" },
  ]);
  expect(result.annotations[0]?.start).toBe(9);
});
