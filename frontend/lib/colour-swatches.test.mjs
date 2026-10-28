import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const swatches = readFileSync(new URL("./colour-swatches.ts", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/collections/variant-media-editor.tsx", import.meta.url), "utf8");
const createEditor = readFileSync(new URL("../components/collections/create-product-media-editor.tsx", import.meta.url), "utf8");
const management = readFileSync(new URL("../components/collections/collection-management-detail.tsx", import.meta.url), "utf8");
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
  assert.match(editor, /aria-label=\{`Edit \$\{variant\.colour\} colour`\}/);
});

test("new-colour editors expose synchronized hex input and protect failed persistence", () => {
  assert.match(createEditor, /New colour hex code/);
  assert.match(createEditor, /New colour swatch/);
  assert.match(createEditor, /isHexColour\(newColourHex\)/);
  assert.match(createEditor, /if \(addingColour\) return/);
  assert.match(createEditor, /onRemoveColour\(addedId\)/);
  assert.match(createEditor, /new colour was not kept/);
  assert.match(createEditor, /disabled=\{addingColour\}/);
});

test("editing a saved colour waits for the authoritative variant refresh before selecting it", () => {
  assert.match(editor, /const \[pendingVariantId, setPendingVariantId\] = useState\(""\)/);
  assert.match(editor, /pendingVariantId && visibleVariants\.some/);
  assert.match(editor, /setPendingVariantId\(""\)/);
  assert.match(editor, /setPendingVariantId\(created\.id\)/);
  assert.match(editor, /await onSaved\?\.\(\)/);
});

test("colour removal uses the existing server-side remove status and refreshes state", () => {
  assert.match(editor, /Remove the \$\{variant\.colour \|\| "selected"\} colour/);
  assert.match(editor, /Its saved gallery media will be preserved/);
  assert.match(editor, /body: JSON\.stringify\(\{ status: "remove" \}\)/);
  assert.match(editor, /await onSaved\?\.\(\)/);
  assert.match(editor, /aria-label=\{`Delete \$\{variant\.colour\} colour`\}/);
  assert.match(editor, /visibleVariants = useMemo/);
});

test("colour actions stay compact and reveal on hover, focus, and touch", () => {
  assert.match(editor, /className="group flex items-stretch"/);
  assert.match(editor, /w-14 shrink-0/);
  assert.match(editor, /group-hover:opacity-100/);
  assert.match(editor, /group-focus-within:opacity-100/);
  assert.match(editor, /\[@media\(pointer:coarse\)\]:opacity-100/);
  assert.match(editor, /title=\{`Edit \$\{variant\.colour\} colour`\}/);
  assert.match(editor, /title=\{`Delete \$\{variant\.colour\} colour`\}/);
});

test("opening a newly created colour refreshes the product before mounting the detail panel", () => {
  assert.match(management, /const openExistingVariant = async/);
  assert.match(management, /const openExistingVariant = async[\s\S]*?await load\(true\)/);
  assert.match(management, /onOpenVariant: \(productId: string, variantId\?: string\) => Promise<void>/);
});
