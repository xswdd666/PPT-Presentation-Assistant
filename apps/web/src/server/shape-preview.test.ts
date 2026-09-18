import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenXmlPptxProcessor } from "@deck-rehearsal/pptx";
import { makeDrawingFixture } from "@deck-rehearsal/pptx/testing";
import {
  elementStyle,
  SlideShape,
} from "../features/slide-rewrite/selection.js";

it("renders a theme-stroked brace and flipped horizontal arrow from real PPTX XML", async () => {
  const slide = (
    await new OpenXmlPptxProcessor().parse(await makeDrawingFixture(), "v1")
  ).slides[0];
  if (!slide) throw new Error("Missing slide");
  const brace = slide.elements.find((e) => e.geometry === "rightBrace");
  const arrow = slide.elements.find((e) => e.geometry === "straightConnector1");
  if (!brace || !arrow) throw new Error("Missing shapes");
  expect(brace.stroke).toMatch(/^[0-9A-F]{6}$/i);
  expect(arrow).toMatchObject({ flipH: true, tailEnd: "triangle" });
  expect(
    Number.parseFloat(String(elementStyle(slide, arrow).height)),
  ).toBeGreaterThan(0);
  expect(elementStyle(slide, arrow).overflow).toBe("visible");
  const braceHtml = renderToStaticMarkup(
    createElement(SlideShape, { element: brace }),
  );
  const arrowHtml = renderToStaticMarkup(
    createElement(SlideShape, { element: arrow }),
  );
  expect(braceHtml).toContain("<path");
  expect(arrowHtml).toContain('marker-end="url(');
  expect(arrowHtml).toContain("scale(-1 1)");
});
