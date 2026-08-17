import type { IntelligentSearchPlan } from "@stickmotion/shared";

import type { SearchResult } from "@/search-bridge";

function containsExcludedTerm(item: SearchResult, terms: string[]) {
  const haystack = `${item.title} ${item.author} ${item.summary}`.toLocaleLowerCase(
    "zh-CN",
  );
  return terms.some((term) =>
    haystack.includes(term.toLocaleLowerCase("zh-CN")),
  );
}

export function mergeSearchResults(groups: SearchResult[][]) {
  const seen = new Set<string>();
  return groups.flatMap((group) =>
    group.filter((item) => {
      const key = item.url || `${item.title}\u0000${item.author}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

export function applyIntelligentSearchPlan(
  results: SearchResult[],
  plan: IntelligentSearchPlan,
) {
  const filtered = results.filter((item) => {
    if (
      plan.maxAgeHours !== null &&
      (item.ageHours === undefined || item.ageHours > plan.maxAgeHours)
    ) {
      return false;
    }
    if (plan.minMetric !== null && item.metric < plan.minMetric) return false;
    if (
      plan.minPrice !== null &&
      (item.price === undefined || item.price < plan.minPrice)
    ) {
      return false;
    }
    if (plan.wantedOnly && item.metric <= 0) return false;
    if (containsExcludedTerm(item, plan.excludeTerms)) return false;
    return true;
  });

  switch (plan.sort) {
    case "metric_desc":
      return filtered.toSorted((left, right) => right.metric - left.metric);
    case "date_desc":
      return filtered.toSorted(
        (left, right) =>
          (left.ageHours ?? Number.MAX_SAFE_INTEGER) -
          (right.ageHours ?? Number.MAX_SAFE_INTEGER),
      );
    case "price_asc":
      return filtered.toSorted(
        (left, right) =>
          (left.price ?? Number.MAX_SAFE_INTEGER) -
          (right.price ?? Number.MAX_SAFE_INTEGER),
      );
    case "relevance":
      return filtered;
  }
}
