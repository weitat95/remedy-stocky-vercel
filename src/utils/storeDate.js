// Store-local (Asia/Kuala_Lumpur, fixed UTC+8) calendar days as 'YYYY-MM-DD', never the browser's timezone.
const OFFSET_MS = 8 * 60 * 60 * 1000;

export const todayStr = (now = Date.now()) => new Date(now + OFFSET_MS).toISOString().slice(0, 10);

export function addDays(s, n) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Monday = 0 .. Sunday = 6
export const weekdayMon0 = (s) => (new Date(`${s}T00:00:00Z`).getUTCDay() + 6) % 7;
export const weekStart = (s) => addDays(s, -weekdayMon0(s));

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// "Fri 20 Nov" (adds the year when it isn't the current one)
export function formatDay(s, today = todayStr()) {
  const d = new Date(`${s}T00:00:00Z`);
  const base = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
  return s.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${s.slice(0, 4)}`;
}

// "20 Nov, 9:42 am" for an ISO timestamp, in store time.
export function formatDateTime(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(iso));
}
