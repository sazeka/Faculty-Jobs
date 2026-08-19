export function extractRiceFacultyRows(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results
    .map((job) => {
      const id = String(job?.legacy_position_id || "").trim();
      const title = String(job?.name || "").trim();
      if (!id || !title) return null;
      return {
        title,
        url: `https://apply.interfolio.com/${encodeURIComponent(id)}`,
        location: String(job?.location || "").trim() || null,
        department: String(job?.unit_name || "").trim() || null,
        postedDate: String(job?.open_date || "").trim() || null,
      };
    })
    .filter(Boolean);
}
