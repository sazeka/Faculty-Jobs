export function interfolioApplicationId(record) {
  const publicId = String(record?.legacy_position_id || "").trim();
  if (publicId) return publicId;

  // Older Interfolio feeds exposed only `id`, and for those records it is
  // still the public application ID. Newer feeds expose both fields; `id`
  // is then an internal search-row ID that can resolve to another school's
  // posting when placed in apply.interfolio.com/<id>.
  return String(record?.id || "").trim() || null;
}

export function interfolioApplicationUrl(record) {
  const id = interfolioApplicationId(record);
  return id ? `https://apply.interfolio.com/${encodeURIComponent(id)}` : null;
}
