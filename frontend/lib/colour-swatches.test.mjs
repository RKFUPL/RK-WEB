import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const swatches = readFileSync(new URL("./colour-swatches.ts", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/collections/variant-media-editor.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("../components/collections/collection-product-card.tsx", import.meta.url), "utf8");

test("colour swatches use custom values before presets and neutral fallback otherwise", () => {
  assert.match(swatches, /customValue = custom\[name\]/);
  assert.match(swatches, /customValue.*PRESET_COLOUR_SWATCHES\[name\]/s);
  assert.match(swatches, /#\[0-9A-Fa-f\]\{6\}/);
  assert.match(card, /colourSwatchValue\(variant\.colour, colourSwatches\) \|\| '#b7aa99'/);
});

test("colour editor validates, previews, edits, and persists mappings without replacing variants", () => {
  assert.match(editor, /New colour hex code/);
  assert.match(editor, /Edit colour hex code/);
  assert.match(editor, /isHexColour\(newColourHex\)/);
  assert.match(editor, /saveColourHex\(colour, newColourHex\.trim\(\)\)/);
  assert.match(editor, /method: "PUT"/);
  assert.match(editor, /colourSwatches: \{ \[normalizeColourSwatchName\(colour\)\]: hex\.toUpperCase\(\) \}/);
  assert.match(editor, /aria-label="New colour swatch"/);
  assert.match(editor, /aria-label=\{`Edit \$\{variant\.colour\} hex code`\}/);
});
