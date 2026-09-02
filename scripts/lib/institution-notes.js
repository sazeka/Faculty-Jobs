import { clean } from "./url-normalization.js";

export function appendUniqueInstitutionNote(existing, addition) {
  const current = clean(existing) || null;
  const next = clean(addition) || null;
  if (!next || current?.includes(next)) return current;
  return clean(`${current || ""} ${next}`) || null;
}
