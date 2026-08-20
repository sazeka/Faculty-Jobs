export function latestPriorWeek(history = [], currentWeekEnd) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.weekEnd && history[i].weekEnd !== currentWeekEnd) return history[i];
  }
  return null;
}
