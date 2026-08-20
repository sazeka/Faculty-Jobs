import { isSuspiciousSyntheticCareerUrl } from "./institution-audit.js";

export function isRejectedCareerPage(url, bodyText = "") {
  const value = String(url || "").trim();
  if (isSuspiciousSyntheticCareerUrl(value)) return true;

  try {
    const parsed = new URL(value);
    if (/\/(?:404|404-not-found|not-found)(?:\/|$)/i.test(parsed.pathname)) return true;
  } catch {
    return true;
  }

  const title = String(bodyText || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return /(?:\b404\b|page not found|not found)/i.test(title);
}

