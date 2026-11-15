/** 9:00 AM America/New_York, `days` calendar days after `from` (DST-safe). */
export function nineAmEasternAfter(from: Date, days: number): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    })
      .formatToParts(from)
      .map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year);
  const m = Number(parts.month) - 1;
  const d = Number(parts.day) + days;
  // Try EST (UTC-5) first; if that lands at 10 AM ET it's EDT, so step back an hour.
  let guess = new Date(Date.UTC(y, m, d, 14, 0, 0));
  const hourEt = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(guess),
  );
  if (hourEt !== 9) guess = new Date(guess.getTime() - (hourEt - 9) * 3600_000);
  return guess;
}
