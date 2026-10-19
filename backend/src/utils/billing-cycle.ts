// Billing-cycle helper shared by the image providers and the AI autocomplete
// quota. Both bill by "cycle day of month" (the day each month a fresh
// allowance starts), so the start date of the current cycle is computed the
// same way in both places.

// Day clamped to the last day of the month, so a cycle set on the 31st still
// starts in February (the 28th/29th).
function cycleDay(date: Date, day: number): number {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return Math.min(day, lastDay);
}

// Start date (YYYY-MM-DD) of the current billing cycle for a provider with the
// given billing day of month. When the day has not arrived yet in the current
// month, the cycle started the previous month.
export function cycleStartForDayOfMonth(billingDay: number, now: Date = new Date()): string {
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const day = cycleDay(now, billingDay);
  const currentStart = new Date(year, monthIndex, day);
  if (now.getTime() >= currentStart.getTime()) {
    return currentStart.toISOString().slice(0, 10);
  }
  const previous = new Date(year, monthIndex - 1, day);
  return previous.toISOString().slice(0, 10);
}
