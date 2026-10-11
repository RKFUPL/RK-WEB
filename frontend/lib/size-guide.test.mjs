import assert from "node:assert/strict";
import test from "node:test";

import { inchesToCentimetres, pairedMeasurement, sizeGuideMeasurements, sizeGuideSizes } from "./size-guide.ts";
import { storefrontSocialLinks } from "./storefront-social.ts";

test("size guide preserves labels and converts inches to centimetres", () => {
  assert.deepEqual([...sizeGuideSizes], ["XS", "S", "M", "L", "XL"]);
  assert.deepEqual(sizeGuideMeasurements.map((row) => row.label), ["Bust", "Waist", "Hip", "Shoulder"]);
  assert.equal(inchesToCentimetres("32"), "81.3");
  assert.equal(inchesToCentimetres("13.5"), "34.3");
  assert.deepEqual(pairedMeasurement("14"), { inches: "14", centimetres: "35.6" });
});

test("size guide never guesses missing or invalid measurements", () => {
  assert.equal(inchesToCentimetres(""), null);
  assert.equal(inchesToCentimetres(undefined), null);
  assert.equal(inchesToCentimetres("unknown"), null);
  assert.equal(pairedMeasurement(null), null);
});

test("storefront social configuration contains only the existing Instagram and LinkedIn profiles", () => {
  assert.deepEqual(Object.keys(storefrontSocialLinks).sort(), ["instagram", "linkedin"]);
  assert.match(storefrontSocialLinks.instagram, /^https:\/\/www\.instagram\.com\//);
  assert.match(storefrontSocialLinks.linkedin, /^https:\/\/www\.linkedin\.com\//);
});
