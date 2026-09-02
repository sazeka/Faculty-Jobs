import { canonicalizeUrl } from "./url-normalization.js";

export function isCareerLinkQuarantineApplicable({
  candidateCareerUrl,
  quarantineCareerUrl,
  quarantineCheckedAt,
  manuallyVerifiedAt,
}) {
  const candidate = canonicalizeUrl(candidateCareerUrl);
  const quarantined = canonicalizeUrl(quarantineCareerUrl);
  if (!candidate || !quarantined || candidate !== quarantined) return false;

  const checkedAt = Date.parse(quarantineCheckedAt || "");
  const verifiedAt = Date.parse(manuallyVerifiedAt || "");
  if (Number.isFinite(verifiedAt) && (!Number.isFinite(checkedAt) || verifiedAt > checkedAt)) {
    return false;
  }

  return true;
}
