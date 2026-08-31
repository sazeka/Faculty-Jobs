export function peopleSoftJobDetailUrl(startUrl, jobId) {
  const id = String(jobId || "").trim();
  if (!id) return null;

  let parsed;
  try {
    parsed = new URL(String(startUrl || ""));
  } catch {
    return null;
  }

  let siteId = "1";
  for (const [key, value] of parsed.searchParams.entries()) {
    if (key.toLowerCase() === "siteid" && value) {
      siteId = value;
      break;
    }
  }

  parsed.search = "";
  parsed.hash = "";
  parsed.searchParams.set("Page", "HRS_APP_JBPST_FL");
  parsed.searchParams.set("Action", "U");
  parsed.searchParams.set("FOCUS", "Applicant");
  parsed.searchParams.set("SiteId", siteId);
  parsed.searchParams.set("JobOpeningId", id);
  parsed.searchParams.set("PostingSeq", "1");
  return parsed.toString();
}
