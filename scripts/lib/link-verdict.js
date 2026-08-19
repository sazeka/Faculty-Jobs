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

export function isHardVerificationFailure(status) {
  return status !== HEALTHY_STATUS && status !== BOT_BLOCKED_STATUS;
}

export function nextConsecutiveFailures(previousFailures, status) {
  return isHardVerificationFailure(status) ? Number(previousFailures || 0) + 1 : 0;
}
