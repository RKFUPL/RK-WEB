export const searchTokens = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
export function matchesSearch(value: string, query: string): boolean {
  if (!query.trim()) return true;
  const terms = searchTokens(query);
  const haystack = searchTokens(value).join(' ');
  if (terms.join('').length === 1) return haystack.startsWith(terms[0]);
  return terms.length > 0 && terms.every((token) => haystack.includes(token));
}


export function searchRelevance(value: string, query: string) {
  const title = searchTokens(value).join(' '), wanted = searchTokens(query).join(' ');
  return title === wanted ? 3 : title.startsWith(wanted) ? 2 : matchesSearch(title, wanted) ? 1 : 0;
}

export function uniqueSuggestions(values: string[], query: string) {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = searchTokens(value).join(' ');
    if (!key || seen.has(key) || !matchesSearch(value, query)) return false;
    seen.add(key); return true;
  }).slice(0, 8);
}

export function searchRequestKey(value: string) {
  return searchTokens(value).join(' ') || value.trim();
}
