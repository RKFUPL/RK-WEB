import { useEffect, useState } from 'react';

export const PRESET_COLOUR_SWATCHES: Record<string, string> = {
  IVORY: '#FFFFF0', RED: '#B4232F', BLUE: '#235A9F', NAVY: '#172A46', BLACK: '#171717', WHITE: '#FFFFFF',
  BEIGE: '#D8C5A5', BROWN: '#714B35', GOLD: '#B69252', GREEN: '#37624A', PINK: '#D98CA3', 'HOT PINK': '#D93384',
  MAROON: '#6E2639', GREY: '#858585', GRAY: '#858585',
};

export function normalizeColourSwatchName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function isHexColour(value: unknown): value is string {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value ?? '').trim());
}

export function colourSwatchValue(value: unknown, custom: Record<string, string> = {}): string | undefined {
  const name = normalizeColourSwatchName(value);
  const customValue = custom[name];
  return isHexColour(customValue) ? customValue.toUpperCase() : PRESET_COLOUR_SWATCHES[name];
}

let publicSwatches: Record<string, string> = {};
let publicSwatchesRequest: Promise<Record<string, string>> | null = null;

async function loadPublicSwatches(): Promise<Record<string, string>> {
  if (publicSwatchesRequest) return publicSwatchesRequest;
  publicSwatchesRequest = fetch('/api/storefront-settings', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return {};
      const payload = await response.json() as { settings?: { colourSwatches?: Record<string, string> } };
      return payload.settings?.colourSwatches || {};
    })
    .catch(() => ({}));
  publicSwatches = await publicSwatchesRequest;
  return publicSwatches;
}

export function useColourSwatches(): Record<string, string> {
  const [custom, setCustom] = useState(publicSwatches);
  useEffect(() => { void loadPublicSwatches().then(setCustom); }, []);
  return custom;
}
