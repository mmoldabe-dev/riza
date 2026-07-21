const TIMEZONE = process.env.TIMEZONE || "Asia/Almaty";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar date (YYYY-MM-DD) in the configured timezone — this is the "day" an order belongs to. */
export function todayDateKey(d: Date = new Date()): string {
  return fmt.format(d); // en-CA gives YYYY-MM-DD directly
}

/** Parses "21.07.2026" or "21.07" (current year) or "2026-07-21" into a YYYY-MM-DD key. Returns null if invalid. */
export function parseDateInput(text: string): string | null {
  const t = text.trim();

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = t.match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?$/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    let year = dmy[3] ?? String(new Date().getFullYear());
    if (year.length === 2) year = `20${year}`;
    if (Number(month) < 1 || Number(month) > 12) return null;
    if (Number(day) < 1 || Number(day) > 31) return null;
    return `${year}-${month}-${day}`;
  }

  return null;
}

export function formatDateKeyRu(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}.${m}.${y}`;
}
