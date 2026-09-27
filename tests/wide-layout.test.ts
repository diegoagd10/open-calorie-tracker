import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

import { WIDE_LAYOUT_MIN_WIDTH_PX } from "../app/routes/wide-layout";

test("the nutrient layout switches at the same breakpoint in CSS and TypeScript", () => {
  const css = readFileSync(path.resolve("app/food-log.module.css"), "utf8");
  const wideBlocks = css
    .split(`@media (min-width: ${WIDE_LAYOUT_MIN_WIDTH_PX}px)`)
    .slice(1)
    .join("\n");

  expect(wideBlocks).toMatch(/\.nutrientTrack \{[^}]*flex-direction: column/u);
  expect(wideBlocks).toMatch(/\.carouselControls \{[^}]*display: none/u);
  expect(css).not.toMatch(/@media \(min-width: (?!1120px)\d+px\)[^{]*\{[^@]*\.nutrientTrack/u);
});
