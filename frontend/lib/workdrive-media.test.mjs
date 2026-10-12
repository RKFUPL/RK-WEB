import assert from "node:assert/strict";
import test from "node:test";

import { hasUnsavedGalleryChanges, isPersistedMediaRelationshipId, prepareWorkDriveGallerySave, workDriveGalleryMatches } from "./workdrive-media.ts";

test("pending batch text is included when colour gallery is saved without previewing", () => {
  const result = prepareWorkDriveGallerySave(
    [],
    "Red front.jpg - https://workdrive.zoho.in/file/red-front Red back.jpg - https://workdrive.zoho.in/file/red-back",
    "colour:red",
    123,
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(
    result.entries.map(({ permalink, alt_text, variantId, primary, hover }) => ({ permalink, alt_text, variantId, primary, hover })),
    [
      { permalink: "https://workdrive.zoho.in/file/red-front", alt_text: "Red front.jpg", variantId: "colour:red", primary: true, hover: false },
      { permalink: "https://workdrive.zoho.in/file/red-back", alt_text: "Red back.jpg", variantId: "colour:red", primary: false, hover: false },
    ],
  );
});

test("invalid pending batch does not silently discard or submit it", () => {
  const result = prepareWorkDriveGallerySave([], "not a WorkDrive link", "colour:red", 123);

  assert.match(result.error || "", /No approved WorkDrive/);
  assert.deepEqual(result.entries, []);
});

test("repeated links are rejected instead of creating duplicate relationships", () => {
  const current = [{ id: "red-1", permalink: "https://workdrive.zoho.in/file/red-1", variantId: "colour:red", primary: true, hover: false }];
  const result = prepareWorkDriveGallerySave(current, "https://workdrive.zoho.in/file/red-1", "colour:red", 123);
  assert.match(result.error || "", /only once/);
  assert.deepEqual(result.entries, current);
});

test("post-save read-back must preserve identity, order, primary and hover state", () => {
  const expected = [
    { id: "red-1", permalink: "https://workdrive.zoho.in/file/red-1", variantId: "colour:red", primary: true, hover: false },
    { id: "red-2", permalink: "https://workdrive.zoho.in/file/red-2", variantId: "colour:red", primary: false, hover: true },
  ];
  assert.equal(workDriveGalleryMatches(expected, expected.map((item) => ({ ...item }))), true);
  assert.equal(workDriveGalleryMatches(expected, [...expected].reverse()), false);
  assert.equal(workDriveGalleryMatches(expected, expected.map((item, index) => index ? { ...item, hover: false } : item)), false);
});

test("a newly saved draft accepts the canonical relationship id returned by the server", () => {
  const submitted = [{ id: "colour:red:new:123:0", permalink: "https://workdrive.zoho.in/file/red-1", variantId: "colour:red", primary: true, hover: false }];
  const persisted = [{ ...submitted[0], id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", renderUrl: "/api/staff/products/product/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }];
  assert.equal(workDriveGalleryMatches(submitted, persisted), true);
  assert.equal(workDriveGalleryMatches(submitted, [{ ...persisted[0], permalink: "https://workdrive.zoho.in/file/other" }]), false);
});

test("pending or edited gallery state cannot be carried to another colour", () => {
  const baseline = [{ id: "red-1", permalink: "https://workdrive.zoho.in/file/red1", variantId: "colour:red", primary: true, hover: false }];
  assert.equal(hasUnsavedGalleryChanges(baseline, baseline, ""), false);
  assert.equal(hasUnsavedGalleryChanges(baseline, baseline, "https://workdrive.zoho.in/file/red2"), true);
  assert.equal(hasUnsavedGalleryChanges(baseline, [{ ...baseline[0], hover: true }], ""), true);
});

test("temporary draft IDs are never treated as persisted media relationships", () => {
  assert.equal(isPersistedMediaRelationshipId("colour:red:new:1791630798246:0"), false);
  assert.equal(isPersistedMediaRelationshipId("54810cc923b41e35020f31db18aec929"), true);
});
