export const HEALTHY_STATUS = "healthy";
export const BOT_BLOCKED_STATUS = "bot_blocked";

export function hasBotChallengeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.has("challenge");
  } catch {
    return false;
  }
}

export function hasMeaningfulTimedOutPage(finalUrl, title, bodyText) {
  try {
    const parsed = new URL(finalUrl);
    if (!/^https?:$/.test(parsed.protocol)) return false;
  } catch {
    return false;
  }
  return `${title || ""} ${bodyText || ""}`.replace(/\s+/g, " ").trim().length >= 100;
}

export function isHardVerificationFailure(status) {
  return status !== HEALTHY_STATUS && status !== BOT_BLOCKED_STATUS;
}

export function nextConsecutiveFailures(previousFailures, status) {
  return isHardVerificationFailure(status) ? Number(previousFailures || 0) + 1 : 0;
}
