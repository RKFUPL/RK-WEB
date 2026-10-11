const WORKDRIVE_URL = /https:\/\/(?:workdrive\.zoho\.in|workdrive\.zohoexternal\.in)\/file\/[^\s?#<>"]+/gi;

export type ParsedWorkDriveMedia = {
  permalink: string;
  alt_text?: string;
};

export type WorkDriveGalleryDraft = ParsedWorkDriveMedia & {
  id: string;
  variantId: string;
  primary: boolean;
  hover: boolean;
};

export function isPersistedMediaRelationshipId(value: string) {
  return /^[a-f0-9]{24,64}$/i.test(String(value || "")) || /^[0-9a-f-]{36}$/i.test(String(value || ""));
}

function cleanLabel(value: string) {
  return value.replace(/\s*-\s*$/, "").replace(/^[\s-]+|[\s-]+$/g, "").trim();
}

export function parseWorkDriveBatch(input: string): { entries: ParsedWorkDriveMedia[]; error?: string } {
  const source = String(input || "");
  const matches = Array.from(source.matchAll(WORKDRIVE_URL));
  if (!matches.length) {
    return source.trim() ? { entries: [], error: "No approved WorkDrive /file/ links were found." } : { entries: [] };
  }

  const entries: ParsedWorkDriveMedia[] = [];
  let cursor = 0;
  for (const match of matches) {
    const url = match[0].replace(/[),.;:]+$/, "");
    const start = match.index ?? 0;
    const label = cleanLabel(source.slice(cursor, start));
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parsed.protocol !== "https:" || !["workdrive.zoho.in", "workdrive.zohoexternal.in"].includes(parsed.hostname.toLowerCase()) || parsed.username || parsed.password || parsed.hash || parts.length !== 2 || parts[0].toLowerCase() !== "file" || !parts[1]) {
        return { entries: [], error: `Invalid WorkDrive link: ${url}` };
      }
    } catch {
      return { entries: [], error: `Invalid WorkDrive link: ${url}` };
    }
    entries.push(label ? { permalink: url, alt_text: label } : { permalink: url });
    cursor = start + match[0].length;
  }

  const remainder = source.slice(cursor).trim();
  if (remainder && !/^[\s-]*$/.test(remainder)) {
    return { entries: [], error: `Unparsed text remains after the final WorkDrive link: ${remainder.slice(0, 80)}` };
  }
  return { entries };
}

export function prepareWorkDriveGallerySave(
  current: WorkDriveGalleryDraft[],
  pendingBatch: string,
  variantId: string,
  nonce = Date.now(),
): { entries: WorkDriveGalleryDraft[]; error?: string } {
  if (!pendingBatch.trim()) return { entries: current };
  const parsed = parseWorkDriveBatch(pendingBatch);
  if (parsed.error || !parsed.entries.length) {
    return { entries: current, error: parsed.error || "Paste at least one approved WorkDrive link." };
  }
  const seen = new Set(current.map((item) => item.permalink.toLowerCase()));
  const duplicate = parsed.entries.find((item) => {
    const key = item.permalink.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  if (duplicate) return { entries: current, error: "Each WorkDrive image may appear only once in a colour gallery." };
  return {
    entries: [
      ...current,
      ...parsed.entries.map((entry, index) => ({
        ...entry,
        id: `${variantId}:new:${nonce}:${index}`,
        variantId,
        primary: current.length === 0 && index === 0,
        hover: false,
      })),
    ],
  };
}

export function workDriveGalleryMatches(expected: WorkDriveGalleryDraft[], actual: WorkDriveGalleryDraft[]) {
  if (expected.length !== actual.length) return false;
  return expected.every((item, index) => {
    const saved = actual[index];
    return saved?.id === item.id
      && saved.permalink === item.permalink
      && saved.variantId === item.variantId
      && saved.primary === item.primary
      && saved.hover === item.hover;
  });
}

export function hasUnsavedGalleryChanges(
  baseline: WorkDriveGalleryDraft[],
  current: WorkDriveGalleryDraft[],
  pendingBatch: string,
) {
  return Boolean(pendingBatch.trim()) || !workDriveGalleryMatches(baseline, current);
}
