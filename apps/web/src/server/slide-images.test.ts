import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenXmlPptxProcessor } from "@deck-rehearsal/pptx";
import { makeFixture } from "@deck-rehearsal/pptx/testing";
import { ThumbnailRail } from "../features/review-workbench/slots.js";
import { SlideShape } from "../features/slide-rewrite/selection.js";

it("includes original images and drawing shapes in the left thumbnail rail", async () => {
  const { slides } = await new OpenXmlPptxProcessor().parse(
    await makeFixture(1, true),
    "v1",
  );
  const html = renderToStaticMarkup(
    createElement(ThumbnailRail, {
      projectId: "p1",
      slides,
      selectedId: slides[0]?.id,
      onSelect: () => undefined,
    }),
  );
  expect(html).toContain("<img");
  expect(html).toContain("/api/projects/p1/image/v1/");
  expect(html).toContain("<svg");
});
it("renders cover fill transparency without fading the photo or text", () => {
  const html = renderToStaticMarkup(
    createElement(SlideShape, {
      element: {
        id: "overlay",
        slideId: "s",
        kind: "body",
        editable: false,
        contentHash: "x",
        geometry: "rect",
        fill: "ffffff",
        fillOpacity: 0.55,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
    }),
  );
  expect(html).toContain('fill-opacity="0.55"');
});
