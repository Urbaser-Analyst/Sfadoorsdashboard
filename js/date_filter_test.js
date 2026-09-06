function inDateRange(date, from, to) {
  if (!date) return !from && !to;
  if (from && date < from) return false;
  if (to) {
    const end = new Date(to); end.setHours(23, 59, 59, 999);
    if (date > end) return false;
  }
  return true;
}
const orderAtStart = new Date(2026, 7, 1);
const inputStart = new Date("2026-08-01");
console.log(JSON.stringify({
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  orderAtStart: orderAtStart.toString(),
  inputStart: inputStart.toString(),
  included: inDateRange(orderAtStart, inputStart, null)
}));
