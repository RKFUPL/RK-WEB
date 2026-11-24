export const searchTokens = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
export function matchesSearch(value: string, query: string): boolean {
  if (!query.trim()) return true;
  const terms = searchTokens(query);
  const haystack = searchTokens(value).join(' ');
  return terms.length > 0 && terms.every((token) => haystack.includes(token));
}
