/**
 * Pattern names come from the backend's catalogue; until it has loaded (or when the
 * service is offline) ids are humanised, so "doubleBottom" reads "Double bottom".
 */
import type { CatalogOut } from "../api/schema";
import type { PatternId } from "../types/analysis";

let labels = new Map<string, string>();
let shorts = new Map<string, string>();

export function setCatalog(catalog: CatalogOut | null) {
  labels = new Map((catalog?.patterns ?? []).map((p) => [p.id, p.label]));
  shorts = new Map((catalog?.patterns ?? []).map((p) => [p.id, initials(p.label)]));
}

export function humanize(id: string): string {
  const words = id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function initials(label: string): string {
  return label
    .split(/[\s-]+/)
    .filter((w) => w && w !== "and")
    .map((w) => w[0].toUpperCase())
    .join("");
}

export function patternLabel(id: PatternId): string {
  return labels.get(id) ?? humanize(id);
}

/** Short tag for chart labels, e.g. "IHAS" for inverse head and shoulders. */
export function patternShort(id: PatternId): string {
  return shorts.get(id) ?? initials(humanize(id));
}
