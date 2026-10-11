export const sizeGuideSizes = ["XS", "S", "M", "L", "XL"] as const;

export const sizeGuideMeasurements = [
  { label: "Bust", inches: ["32", "34", "36", "38", "40"] },
  { label: "Waist", inches: ["24", "26", "28", "30", "32"] },
  { label: "Hip", inches: ["34", "36", "38", "40", "42"] },
  { label: "Shoulder", inches: ["13.5", "14", "14.5", "15", "15.5"] },
] as const;

export function inchesToCentimetres(value: string | number | null | undefined) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const inches = Number(value);
  if (!Number.isFinite(inches)) return null;
  return (inches * 2.54).toFixed(1).replace(/\.0$/, "");
}

export function pairedMeasurement(value: string | number | null | undefined) {
  const inches = value === null || value === undefined ? "" : String(value).trim();
  const centimetres = inchesToCentimetres(value);
  return inches && centimetres ? { inches, centimetres } : null;
}
